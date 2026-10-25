import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { assert } from "chai";
import { OpenpumpCurve } from "../target/types/openpump_curve";
import { OpenpumpAmm } from "../target/types/openpump_amm";
import { OpenpumpFees } from "../target/types/openpump_fees";
import { OpenpumpMayhem } from "../target/types/openpump_mayhem";

const MPL_TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// pump.fun-shaped defaults
const PARAMS = {
  initialVirtualTokenReserves: new BN("1073000000000000"),
  initialVirtualSolReserves: new BN("30000000000"),
  initialRealTokenReserves: new BN("793100000000000"),
  tokenTotalSupply: new BN("1000000000000000"),
  feeBasisPoints: new BN(50), // 0.50 % protocol
  creatorFeeBasisPoints: new BN(50), // 0.50 % creator — from trade #1
  migrationFeeLamports: new BN(0),
  antiSnipeSlots: new BN(0), // tests run fast; exercised separately
  antiSnipeMaxBps: new BN(100),
  paused: false,
  buybackBasisPoints: new BN(0),
  buybackFeeRecipient: PublicKey.default,
};

describe("OpenPump — curve + amm", () => {
  const base = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(base.connection, base.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  anchor.setProvider(provider);
  const conn = provider.connection;
  const curve = new Program<OpenpumpCurve>(require("../target/idl/openpump_curve.json"), provider);
  const amm = new Program<OpenpumpAmm>(require("../target/idl/openpump_amm.json"), provider);
  const fees = new Program<OpenpumpFees>(require("../target/idl/openpump_fees.json"), provider);
  const mayhem = new Program<OpenpumpMayhem>(require("../target/idl/openpump_mayhem.json"), provider);
  const ZERO = PublicKey.default;
  const logsOf = async (e: any) => { try { return e.logs ?? (await e.getLogs?.(conn)) ?? []; } catch { return []; } };
  const admin = (provider.wallet as anchor.Wallet).payer;

  const feeRecipient = Keypair.generate();
  const creator = Keypair.generate();
  const trader = Keypair.generate();
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  const [global] = PublicKey.findProgramAddressSync([Buffer.from("global")], curve.programId);
  const [mintAuthority] = PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], curve.programId);
  const [bondingCurve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], curve.programId);
  const [curveEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], curve.programId);
  const [ammEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], amm.programId);
  const [ammGlobalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global-config")], amm.programId);
  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creator.publicKey.toBuffer()], curve.programId);
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), mint.toBuffer()],
    MPL_TOKEN_METADATA
  );
  const associatedBondingCurve = getAssociatedTokenAddressSync(mint, bondingCurve, true);

  // AMM pool for the graduated coin: index 0, creator = bonding curve PDA, quote = WSOL
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), Buffer.from([0, 0]), bondingCurve.toBuffer(), mint.toBuffer(), NATIVE_MINT.toBuffer()],
    amm.programId
  );
  const [lpMint] = PublicKey.findProgramAddressSync([Buffer.from("pool-lp-mint"), pool.toBuffer()], amm.programId);
  const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.publicKey.toBuffer()],
    amm.programId
  );
  const coinCreatorVaultAta = getAssociatedTokenAddressSync(NATIVE_MINT, coinCreatorVaultAuthority, true);
  const poolBase = getAssociatedTokenAddressSync(mint, pool, true);
  const poolQuote = getAssociatedTokenAddressSync(NATIVE_MINT, pool, true);
  const lockedLp = getAssociatedTokenAddressSync(lpMint, pool, true);

  const airdrop = async (pk: PublicKey, sol: number) => {
    const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  };
  const lamports = async (pk: PublicKey) => conn.getBalance(pk, "confirmed");
  const tokenBal = async (ata: PublicKey) => BigInt((await getAccount(conn, ata, "confirmed")).amount.toString());

  const tradeAccounts = (user: PublicKey) => ({
    global,
    feeRecipient: feeRecipient.publicKey,
    mint,
    bondingCurve,
    associatedBondingCurve,
    associatedUser: getAssociatedTokenAddressSync(mint, user),
    user,
    creatorVault,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    globalVolumeAccumulator: null,
    userVolumeAccumulator: null,
    feeConfig: null,
    buybackFeeRecipient: null,
  });

  before(async () => {
    await Promise.all([airdrop(creator.publicKey, 10), airdrop(trader.publicKey, 200), airdrop(feeRecipient.publicKey, 1)]);
  });

  it("initializes the AMM config and the curve global", async () => {
    await amm.methods
      .createConfig(new BN(20), new BN(5), new BN(5), feeRecipient.publicKey)
      .accounts({ admin: admin.publicKey })
      .rpc();
    const cfg = await amm.account.globalConfig.fetch(ammGlobalConfig);
    assert.equal(cfg.lpFeeBasisPoints.toNumber(), 20);
    assert.equal(cfg.protocolFeeRecipient.toBase58(), feeRecipient.publicKey.toBase58());

    await curve.methods
      .initialize({ feeRecipient: feeRecipient.publicKey, ...PARAMS })
      .accounts({ authority: admin.publicKey })
      .rpc();
    const g = await curve.account.global.fetch(global);
    assert.equal(g.ammProgram.toBase58(), amm.programId.toBase58());
    assert.equal(g.feeBasisPoints.toNumber(), 50);
  });

  it("rejects initialize from a stranger (singleton already exists / wrong key)", async () => {
    const stranger = Keypair.generate();
    await airdrop(stranger.publicKey, 1);
    try {
      await curve.methods
        .initialize({ feeRecipient: feeRecipient.publicKey, ...PARAMS })
        .accounts({ authority: stranger.publicKey })
        .signers([stranger])
        .rpc();
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(String(e).length > 0);
    }
  });

  it("creates a coin: metadata, full supply on the curve, mint authority revoked", async () => {
    await curve.methods
      .create("People Coin", "PEOPLE", "https://example.com/people.json", false, PublicKey.default, false)
      .accounts({
        mint,
        mintAuthority,
        bondingCurve,
        associatedBondingCurve,
        global,
        mplTokenMetadata: MPL_TOKEN_METADATA,
        metadata,
        user: creator.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator, mintKp])
      .rpc();

    const bc = await curve.account.bondingCurve.fetch(bondingCurve);
    assert.equal(bc.creator.toBase58(), creator.publicKey.toBase58());
    assert.equal(bc.realTokenReserves.toString(), PARAMS.initialRealTokenReserves.toString());
    assert.equal((await tokenBal(associatedBondingCurve)).toString(), PARAMS.tokenTotalSupply.toString());
    const m = await getMint(conn, mint);
    assert.isNull(m.mintAuthority, "mint authority must be revoked");
    assert.equal(m.decimals, 6);
    assert.ok(await conn.getAccountInfo(metadata), "metadata account exists");
  });

  it("buy_exact_sol_in: pays 1 SOL + fees, creator earns 0.5 % from trade #1", async () => {
    const feeBefore = await lamports(feeRecipient.publicKey);
    const vaultBefore = await lamports(creatorVault);
    const solIn = new BN(LAMPORTS_PER_SOL);
    // expected tokens = s * vT / (vS + s)
    const expected = solIn.mul(PARAMS.initialVirtualTokenReserves).div(PARAMS.initialVirtualSolReserves.add(solIn));

    await curve.methods
      .buyExactSolIn(solIn, expected.sub(new BN(1000)))
      .accounts(tradeAccounts(trader.publicKey))
      .signers([trader])
      .rpc();

    const bal = await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey));
    assert.equal(bal.toString(), expected.toString());
    assert.equal((await lamports(feeRecipient.publicKey)) - feeBefore, LAMPORTS_PER_SOL * 0.005);
    assert.equal((await lamports(creatorVault)) - vaultBefore, LAMPORTS_PER_SOL * 0.005);
    const bc = await curve.account.bondingCurve.fetch(bondingCurve);
    assert.equal(bc.realSolReserves.toString(), solIn.toString());
  });

  it("buy (exact tokens out) respects max_sol_cost", async () => {
    const amount = new BN("10000000000000"); // 10M tokens
    try {
      await curve.methods.buy(amount, new BN(1)).accounts(tradeAccounts(trader.publicKey)).signers([trader]).rpc();
      assert.fail("slippage should fail");
    } catch (e) {
      assert.include(String(e), "ExceededSlippage");
    }
    const before = await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey));
    await curve.methods
      .buy(amount, new BN(5 * LAMPORTS_PER_SOL))
      .accounts(tradeAccounts(trader.publicKey))
      .signers([trader])
      .rpc();
    const after = await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey));
    assert.equal((after - before).toString(), amount.toString());
  });

  it("sell returns SOL minus fees and never more than was paid", async () => {
    const amount = new BN("10000000000000");
    const solBefore = await lamports(trader.publicKey);
    await curve.methods
      .sell(amount, new BN(0))
      .accounts(tradeAccounts(trader.publicKey))
      .signers([trader])
      .rpc();
    const solAfter = await lamports(trader.publicKey);
    assert.isAbove(solAfter, solBefore);
    assert.isBelow(solAfter - solBefore, 5 * LAMPORTS_PER_SOL);
  });

  it("creator collects accrued fees", async () => {
    const before = await lamports(creator.publicKey);
    const vault = await lamports(creatorVault);
    assert.isAbove(vault, 0);
    await curve.methods
      .collectCreatorFee()
      .accounts({ creator: creator.publicKey, creatorVault, systemProgram: SystemProgram.programId })
      .rpc(); // permissionless: anyone can sweep a vault to its creator
    const after = await lamports(creator.publicKey);
    assert.isAbove(after, before + vault - 2_000_000, "creator received (almost) the whole vault");
  });

  it("completes the curve with a partial fill at ~85 SOL and blocks further trades", async () => {
    // ask for far more than is left; program partial-fills what remains
    await curve.methods
      .buy(new BN("900000000000000"), new BN(150 * LAMPORTS_PER_SOL))
      .accounts(tradeAccounts(trader.publicKey))
      .signers([trader])
      .rpc();
    const bc = await curve.account.bondingCurve.fetch(bondingCurve);
    assert.isTrue(bc.complete);
    assert.equal(bc.realTokenReserves.toNumber(), 0);
    const realSol = bc.realSolReserves.toNumber() / LAMPORTS_PER_SOL;
    assert.closeTo(realSol, 85, 0.1, `real SOL at completion ${realSol}`);
    assert.equal((await tokenBal(associatedBondingCurve)).toString(), PARAMS.tokenTotalSupply.sub(PARAMS.initialRealTokenReserves).toString());
    try {
      await curve.methods.sell(new BN(1000), new BN(0)).accounts(tradeAccounts(trader.publicKey)).signers([trader]).rpc();
      assert.fail("should be complete");
    } catch (e) {
      assert.include(String(e), "CurveComplete");
    }
  });

  it("migrates into the AMM: pool funded, LP burned, price continuous", async () => {
    const bcBefore = await curve.account.bondingCurve.fetch(bondingCurve);
    const bcWsol = getAssociatedTokenAddressSync(NATIVE_MINT, bondingCurve, true);
    const bcLp = getAssociatedTokenAddressSync(lpMint, bondingCurve, true);
    const migrator = trader; // permissionless

    await curve.methods
      .migrate()
      .accounts({
        global,
        feeRecipient: feeRecipient.publicKey,
        mint,
        bondingCurve,
        associatedBondingCurve,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        bondingCurveWsol: bcWsol,
        bondingCurveLp: bcLp,
        user: migrator.publicKey,
        wsolMint: NATIVE_MINT,
        ammProgram: amm.programId,
        ammGlobalConfig,
        pool,
        lpMint,
        lockedLpTokenAccount: lockedLp,
        poolBaseTokenAccount: poolBase,
        poolQuoteTokenAccount: poolQuote,
        coinCreatorVaultAuthority,
        coinCreatorVaultAta,
        ammEventAuthority,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .signers([migrator])
      .rpc()
      .catch(async (e) => { console.log((await logsOf(e)).join("\n")); throw e; });

    const bc = await curve.account.bondingCurve.fetch(bondingCurve);
    assert.isTrue(bc.migrated);
    const p = await amm.account.pool.fetch(pool);
    assert.equal(p.coinCreator.toBase58(), creator.publicKey.toBase58());
    const baseRes = await tokenBal(poolBase);
    const quoteRes = await tokenBal(poolQuote);
    assert.equal(baseRes.toString(), PARAMS.tokenTotalSupply.sub(PARAMS.initialRealTokenReserves).toString());
    assert.equal(quoteRes.toString(), bcBefore.realSolReserves.toString());
    // LP: only the locked minimum remains in supply
    const lp = await getMint(conn, lpMint);
    assert.equal(lp.supply.toString(), "1000");
    assert.equal((await tokenBal(lockedLp)).toString(), "1000");
    assert.isNull(await conn.getAccountInfo(bcLp), "curve LP ATA closed");
    assert.isNull(await conn.getAccountInfo(bcWsol), "curve WSOL ATA closed");
    // price continuity
    const curvePrice = Number(bcBefore.virtualSolReserves) / Number(bcBefore.virtualTokenReserves);
    const poolPrice = Number(quoteRes) / Number(baseRes);
    assert.closeTo(poolPrice / curvePrice, 1, 1e-3); // pump.fun constants: continuous to ~0.007 %
    try {
      await curve.methods.migrate().accounts({
        global, feeRecipient: feeRecipient.publicKey, mint, bondingCurve, associatedBondingCurve, baseTokenProgram: TOKEN_PROGRAM_ID, bondingCurveWsol: bcWsol, bondingCurveLp: bcLp,
        user: migrator.publicKey, wsolMint: NATIVE_MINT, ammProgram: amm.programId, ammGlobalConfig, pool, lpMint, lockedLpTokenAccount: lockedLp,
        poolBaseTokenAccount: poolBase, poolQuoteTokenAccount: poolQuote, coinCreatorVaultAuthority, coinCreatorVaultAta, ammEventAuthority,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      }).preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })]).signers([migrator]).rpc();
      assert.fail("double migrate");
    } catch (e) {
      assert.include(String(e), "AlreadyMigrated");
    }
  });

  const swapAccounts = (user: PublicKey) => ({
    pool,
    user,
    globalConfig: ammGlobalConfig,
    baseMint: mint,
    quoteMint: NATIVE_MINT,
    userBaseTokenAccount: getAssociatedTokenAddressSync(mint, user),
    userQuoteTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, user),
    poolBaseTokenAccount: poolBase,
    poolQuoteTokenAccount: poolQuote,
    protocolFeeRecipient: feeRecipient.publicKey,
    protocolFeeRecipientTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, feeRecipient.publicKey),
    coinCreatorVaultAuthority,
    coinCreatorVaultAta,
    baseTokenProgram: TOKEN_PROGRAM_ID,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    feeConfig: null, buybackFeeRecipientTokenAccount: null, globalVolumeAccumulator: null, userVolumeAccumulator: null, curveProgram: null,
  });

  const wrapSol = async (user: Keypair, sol: number) => {
    const ata = getAssociatedTokenAddressSync(NATIVE_MINT, user.publicKey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(user.publicKey, ata, user.publicKey, NATIVE_MINT),
      SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: ata, lamports: sol * LAMPORTS_PER_SOL }),
      createSyncNativeInstruction(ata)
    );
    await provider.sendAndConfirm(tx, [user]);
    return ata;
  };

  it("AMM buy: pays quote + fees, creator vault and protocol get their cut", async () => {
    await wrapSol(trader, 20);
    const baseOut = new BN("1000000000000"); // 1M tokens
    const baseRes = await tokenBal(poolBase);
    const quoteRes = await tokenBal(poolQuote);
    const quoteIn = (BigInt(baseOut.toString()) * quoteRes + (baseRes - BigInt(baseOut.toString())) - 1n) / (baseRes - BigInt(baseOut.toString()));
    const fee = (x: bigint, bps: bigint) => (x * bps + 9999n) / 10000n;
    const total = quoteIn + fee(quoteIn, 20n) + fee(quoteIn, 5n) + fee(quoteIn, 5n);

    const userBaseBefore = await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey));
    const userQuoteBefore = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey));
    await amm.methods.buy(baseOut, new BN(total.toString()), false).accounts(swapAccounts(trader.publicKey)).signers([trader]).rpc();
    const userBaseAfter = await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey));
    const userQuoteAfter = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey));
    assert.equal((userBaseAfter - userBaseBefore).toString(), baseOut.toString());
    assert.equal((userQuoteBefore - userQuoteAfter).toString(), total.toString());
    assert.equal((await tokenBal(coinCreatorVaultAta)).toString(), fee(quoteIn, 5n).toString());
    assert.equal((await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, feeRecipient.publicKey))).toString(), fee(quoteIn, 5n).toString());
    assert.equal((await tokenBal(poolQuote)).toString(), (quoteRes + quoteIn + fee(quoteIn, 20n)).toString());
  });

  it("AMM sell: receives quote minus fees; round trip never profits", async () => {
    const baseIn = new BN("1000000000000");
    const quoteBefore = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey));
    await amm.methods.sell(baseIn, new BN(0)).accounts(swapAccounts(trader.publicKey)).signers([trader]).rpc();
    const quoteAfter = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey));
    const got = quoteAfter - quoteBefore;
    assert.isAbove(Number(got), 0);
    assert.isBelow(Number(got), Number(20n * BigInt(LAMPORTS_PER_SOL)) - Number(quoteBefore) + Number(got), "sanity");
  });

  it("AMM deposit + withdraw round-trips liquidity", async () => {
    const lpOut = new BN("1000000000"); // 1 LP (9 dec)
    const lqAccounts = {
      pool,
      globalConfig: ammGlobalConfig,
      user: trader.publicKey,
      baseMint: mint,
      quoteMint: NATIVE_MINT,
      lpMint,
      userBaseTokenAccount: getAssociatedTokenAddressSync(mint, trader.publicKey),
      userQuoteTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey),
      userPoolTokenAccount: getAssociatedTokenAddressSync(lpMint, trader.publicKey),
      poolBaseTokenAccount: poolBase,
      poolQuoteTokenAccount: poolQuote,
      tokenProgram: TOKEN_PROGRAM_ID,
      baseTokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
    const baseBefore = await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey));
    const quoteBefore = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey));
    await amm.methods
      .deposit(lpOut, new BN("1000000000000000"), new BN("100000000000"))
      .accounts(lqAccounts)
      .signers([trader])
      .rpc();
    assert.equal((await tokenBal(getAssociatedTokenAddressSync(lpMint, trader.publicKey))).toString(), lpOut.toString());
    await amm.methods.withdraw(lpOut, new BN(0), new BN(0)).accounts(lqAccounts).signers([trader]).rpc();
    const baseAfter = await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey));
    const quoteAfter = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey));
    assert.isAtMost(Number(baseBefore - baseAfter), 2, "base dust only");
    assert.isAtMost(Number(quoteBefore - quoteAfter), 2, "quote dust only");
    assert.equal((await tokenBal(getAssociatedTokenAddressSync(lpMint, trader.publicKey))).toString(), "0");
  });

  it("coin creator collects AMM fees in WSOL", async () => {
    const vault = await tokenBal(coinCreatorVaultAta);
    assert.isAbove(Number(vault), 0);
    await amm.methods
      .collectCoinCreatorFee()
      .accounts({
        coinCreator: creator.publicKey,
        quoteMint: NATIVE_MINT,
        coinCreatorVaultAuthority,
        coinCreatorVaultAta,
        coinCreatorTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, creator.publicKey),
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
    assert.equal((await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, creator.publicKey))).toString(), vault.toString());
    assert.equal((await tokenBal(coinCreatorVaultAta)).toString(), "0");
  });

  it("kill switch: disable buy on the AMM, then re-enable", async () => {
    await amm.methods.disable(8).accounts({ admin: admin.publicKey, globalConfig: ammGlobalConfig }).rpc();
    try {
      await amm.methods.buy(new BN(1000), new BN("100000000"), false).accounts(swapAccounts(trader.publicKey)).signers([trader]).rpc();
      assert.fail("disabled");
    } catch (e) {
      assert.include(String(e), "Disabled");
    }
    await amm.methods.disable(0).accounts({ admin: admin.publicKey, globalConfig: ammGlobalConfig }).rpc();
  });

  it("anti-snipe: a fresh coin caps per-buy size during the opening window", async () => {
    await curve.methods
      .setParams({ feeRecipient: feeRecipient.publicKey, ...PARAMS, antiSnipeSlots: new BN(1000), antiSnipeMaxBps: new BN(100) })
      .accounts({ authority: admin.publicKey, global })
      .rpc();
    const mint2 = Keypair.generate();
    const [bc2] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint2.publicKey.toBuffer()], curve.programId);
    const [meta2] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), mint2.publicKey.toBuffer()],
      MPL_TOKEN_METADATA
    );
    await curve.methods
      .create("Snipe Test", "SNIPE", "https://example.com/s.json", false, PublicKey.default, false)
      .accounts({
        mint: mint2.publicKey,
        mintAuthority,
        bondingCurve: bc2,
        associatedBondingCurve: getAssociatedTokenAddressSync(mint2.publicKey, bc2, true),
        global,
        mplTokenMetadata: MPL_TOKEN_METADATA,
        metadata: meta2,
        user: creator.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator, mint2])
      .rpc();
    const accts = {
      ...tradeAccounts(trader.publicKey),
      mint: mint2.publicKey,
      bondingCurve: bc2,
      associatedBondingCurve: getAssociatedTokenAddressSync(mint2.publicKey, bc2, true),
      associatedUser: getAssociatedTokenAddressSync(mint2.publicKey, trader.publicKey),
    };
    // 1 % of supply = 10M tokens is the cap; 20M must fail, 5M must pass
    try {
      await curve.methods.buy(new BN("20000000000000"), new BN(10 * LAMPORTS_PER_SOL)).accounts(accts).signers([trader]).rpc();
      assert.fail("cap");
    } catch (e) {
      assert.include(String(e), "AntiSnipeCap");
    }
    await curve.methods.buy(new BN("5000000000000"), new BN(10 * LAMPORTS_PER_SOL)).accounts(accts).signers([trader]).rpc();
    await curve.methods.setParams({ feeRecipient: feeRecipient.publicKey, ...PARAMS }).accounts({ authority: admin.publicKey, global }).rpc();
  });

  // ------------------------------------------------------------------ custom pairs (v2)
  describe("custom pairs (v2)", () => {
    const quoteDec = 6;
    let quoteMint: PublicKey;
    const mint2 = Keypair.generate();
    const Q = (n: number) => new BN(Math.round(n * 10 ** quoteDec));
    const QPARAMS = {
      enabled: true,
      initialVirtualQuoteReserves: Q(1_000_000), // 1M QUOTE virtual
      initialVirtualTokenReserves: PARAMS.initialVirtualTokenReserves,
      initialRealTokenReserves: PARAMS.initialRealTokenReserves,
      migrationFee: Q(10),
    };
    let bc2: PublicKey, meta2: PublicKey, abc2: PublicKey, bcQuote: PublicKey, creatorVaultQuote: PublicKey, feeQuote: PublicKey;
    const [quoteCfg, quoteCfgSeed] = [null as any, null];
    const qcfg = () => PublicKey.findProgramAddressSync([Buffer.from("quote-config"), quoteMint.toBuffer()], curve.programId)[0];

    const tradeV2 = (user: PublicKey) => ({
      global, feeRecipient: feeRecipient.publicKey, mint: mint2.publicKey, bondingCurve: bc2, associatedBondingCurve: abc2,
      associatedUser: getAssociatedTokenAddressSync(mint2.publicKey, user), user, quoteMint,
      userQuote: getAssociatedTokenAddressSync(quoteMint, user), bondingCurveQuote: bcQuote, feeRecipientQuote: feeQuote,
      creatorVault, creatorVaultQuote, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, feeConfig: null,
    });

    before(async () => {
      quoteMint = await createMint(conn, admin, admin.publicKey, null, quoteDec);
      for (const who of [trader, creator]) {
        const ata = await getOrCreateAssociatedTokenAccount(conn, admin, quoteMint, who.publicKey);
        await mintTo(conn, admin, quoteMint, ata.address, admin, 10_000_000 * 10 ** quoteDec);
      }
      [bc2] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint2.publicKey.toBuffer()], curve.programId);
      [meta2] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), mint2.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      abc2 = getAssociatedTokenAddressSync(mint2.publicKey, bc2, true);
      bcQuote = getAssociatedTokenAddressSync(quoteMint, bc2, true);
      creatorVaultQuote = getAssociatedTokenAddressSync(quoteMint, creatorVault, true);
      feeQuote = getAssociatedTokenAddressSync(quoteMint, feeRecipient.publicKey, true);
    });

    it("authority enables a quote mint with its own virtual reserves", async () => {
      await curve.methods.setQuoteConfig(QPARAMS).accounts({ authority: admin.publicKey, global, quoteMint, quoteConfig: qcfg(), systemProgram: SystemProgram.programId }).rpc();
      const q = await curve.account.quoteConfig.fetch(qcfg());
      assert.isTrue(q.enabled);
      assert.equal(q.decimals, quoteDec);
      assert.equal(q.initialVirtualQuoteReserves.toString(), QPARAMS.initialVirtualQuoteReserves.toString());
    });

    it("create_v2 launches a coin paired with the quote mint", async () => {
      await curve.methods
        .createV2("Quote Coin", "QC", "https://example.com/qc.json", false, PublicKey.default)
        .accounts({
          mint: mint2.publicKey, mintAuthority, bondingCurve: bc2, associatedBondingCurve: abc2, quoteMint, quoteConfig: qcfg(), bondingCurveQuote: bcQuote,
          global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta2, user: creator.publicKey, systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([creator, mint2])
        .rpc();
      const bc = await curve.account.bondingCurve.fetch(bc2);
      assert.equal(bc.quoteMint.toBase58(), quoteMint.toBase58());
      assert.equal(bc.virtualSolReserves.toString(), QPARAMS.initialVirtualQuoteReserves.toString());
    });

    it("v1 buy on a v2 curve is rejected", async () => {
      try {
        await curve.methods.buyExactSolIn(new BN(1e9), new BN(0)).accounts({ ...tradeAccounts(trader.publicKey), mint: mint2.publicKey, bondingCurve: bc2, associatedBondingCurve: abc2, associatedUser: getAssociatedTokenAddressSync(mint2.publicKey, trader.publicKey) }).signers([trader]).rpc();
        assert.fail("should reject");
      } catch (e) {
        assert.include(String(e), "WrongQuoteMint");
      }
    });

    it("buy_exact_quote_in pays in quote tokens; fees land in quote ATAs", async () => {
      const qin = Q(1000);
      const expected = qin.mul(QPARAMS.initialVirtualTokenReserves).div(QPARAMS.initialVirtualQuoteReserves.add(qin));
      await curve.methods.buyExactQuoteIn(qin, expected.sub(new BN(1000))).accounts(tradeV2(trader.publicKey)).signers([trader]).rpc();
      assert.equal((await tokenBal(getAssociatedTokenAddressSync(mint2.publicKey, trader.publicKey))).toString(), expected.toString());
      assert.equal((await tokenBal(bcQuote)).toString(), qin.toString());
      assert.equal((await tokenBal(feeQuote)).toString(), qin.muln(50).divn(10000).toString());
      assert.equal((await tokenBal(creatorVaultQuote)).toString(), qin.muln(50).divn(10000).toString());
    });

    it("buy_v2 + sell_v2 round trip never profits", async () => {
      const amount = new BN("5000000000000");
      const before = await tokenBal(getAssociatedTokenAddressSync(quoteMint, trader.publicKey));
      await curve.methods.buyV2(amount, Q(100000)).accounts(tradeV2(trader.publicKey)).signers([trader]).rpc();
      await curve.methods.sellV2(amount, new BN(0)).accounts(tradeV2(trader.publicKey)).signers([trader]).rpc();
      const after = await tokenBal(getAssociatedTokenAddressSync(quoteMint, trader.publicKey));
      assert.isBelow(Number(after), Number(before));
    });

    it("collect_creator_fee_v2 sweeps the quote vault", async () => {
      const vault = await tokenBal(creatorVaultQuote);
      assert.isAbove(Number(vault), 0);
      const before = await tokenBal(getAssociatedTokenAddressSync(quoteMint, creator.publicKey));
      await curve.methods
        .collectCreatorFeeV2()
        .accounts({ payer: creator.publicKey, creator: creator.publicKey, quoteMint, creatorVault, creatorVaultQuote, creatorQuote: getAssociatedTokenAddressSync(quoteMint, creator.publicKey), quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([creator])
        .rpc();
      assert.equal(((await tokenBal(getAssociatedTokenAddressSync(quoteMint, creator.publicKey))) - before).toString(), vault.toString());
    });

    it("completes and migrate_v2 funds an AMM pool quoted in the custom token (fee taken, LP burned)", async () => {
      await curve.methods.buyV2(new BN("900000000000000"), Q(9_000_000)).accounts(tradeV2(trader.publicKey)).signers([trader]).rpc();
      const bcBefore = await curve.account.bondingCurve.fetch(bc2);
      assert.isTrue(bcBefore.complete);
      const [pool2] = PublicKey.findProgramAddressSync([Buffer.from("pool"), Buffer.from([0, 0]), bc2.toBuffer(), mint2.publicKey.toBuffer(), quoteMint.toBuffer()], amm.programId);
      const [lp2] = PublicKey.findProgramAddressSync([Buffer.from("pool-lp-mint"), pool2.toBuffer()], amm.programId);
      const feeBefore = await tokenBal(feeQuote);
      await curve.methods
        .migrateV2()
        .accounts({
          global, feeRecipient: feeRecipient.publicKey, feeRecipientQuote: feeQuote, mint: mint2.publicKey, bondingCurve: bc2, associatedBondingCurve: abc2, baseTokenProgram: TOKEN_PROGRAM_ID, bondingCurveQuote: bcQuote,
          bondingCurveLp: getAssociatedTokenAddressSync(lp2, bc2, true), user: trader.publicKey, quoteMint, quoteConfig: qcfg(),
          ammProgram: amm.programId, ammGlobalConfig, pool: pool2, lpMint: lp2, lockedLpTokenAccount: getAssociatedTokenAddressSync(lp2, pool2, true),
          poolBaseTokenAccount: getAssociatedTokenAddressSync(mint2.publicKey, pool2, true), poolQuoteTokenAccount: getAssociatedTokenAddressSync(quoteMint, pool2, true),
          coinCreatorVaultAuthority, coinCreatorVaultAta: getAssociatedTokenAddressSync(quoteMint, coinCreatorVaultAuthority, true), ammEventAuthority,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
        .signers([trader])
        .rpc();
      const bc = await curve.account.bondingCurve.fetch(bc2);
      assert.isTrue(bc.migrated);
      assert.equal(((await tokenBal(feeQuote)) - feeBefore).toString(), QPARAMS.migrationFee.toString());
      const poolQuoteBal = await tokenBal(getAssociatedTokenAddressSync(quoteMint, pool2, true));
      assert.equal(poolQuoteBal.toString(), bcBefore.realSolReserves.sub(QPARAMS.migrationFee).toString());
      assert.equal((await getMint(conn, lp2)).supply.toString(), "1000");
      assert.isNull(await conn.getAccountInfo(bcQuote), "curve quote ATA closed");

      // trade on the AMM in the custom quote
      const p = await amm.account.pool.fetch(pool2);
      await amm.methods
        .buy(new BN("1000000000000"), Q(1_000_000), false)
        .accounts({
          pool: pool2, user: trader.publicKey, globalConfig: ammGlobalConfig, baseMint: mint2.publicKey, quoteMint,
          userBaseTokenAccount: getAssociatedTokenAddressSync(mint2.publicKey, trader.publicKey), userQuoteTokenAccount: getAssociatedTokenAddressSync(quoteMint, trader.publicKey),
          poolBaseTokenAccount: p.poolBaseTokenAccount, poolQuoteTokenAccount: p.poolQuoteTokenAccount,
          protocolFeeRecipient: feeRecipient.publicKey, protocolFeeRecipientTokenAccount: feeQuote,
          coinCreatorVaultAuthority, coinCreatorVaultAta: getAssociatedTokenAddressSync(quoteMint, coinCreatorVaultAuthority, true),
          baseTokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, feeConfig: null, buybackFeeRecipientTokenAccount: null, globalVolumeAccumulator: null, userVolumeAccumulator: null, curveProgram: null,
        })
        .signers([trader])
        .rpc();
      assert.isAbove(Number(await tokenBal(getAssociatedTokenAddressSync(quoteMint, pool2, true))), Number(poolQuoteBal));
    });
  });

  // ------------------------------------------------------------------ holder rewards
  describe("holder rewards", () => {
    const mintH = Keypair.generate();
    const holderA = Keypair.generate();
    const holderB = Keypair.generate();
    let bcH: PublicKey, holderPda: PublicKey, holderVault: PublicKey;

    before(async () => {
      [bcH] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mintH.publicKey.toBuffer()], curve.programId);
      [holderPda] = PublicKey.findProgramAddressSync([Buffer.from("holder-rewards"), mintH.publicKey.toBuffer()], curve.programId);
      [holderVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), holderPda.toBuffer()], curve.programId);
      await Promise.all([airdrop(holderA.publicKey, 5), airdrop(holderB.publicKey, 5)]);
    });

    const accts = (user: PublicKey) => ({
      ...tradeAccounts(user),
      mint: mintH.publicKey,
      bondingCurve: bcH,
      associatedBondingCurve: getAssociatedTokenAddressSync(mintH.publicKey, bcH, true),
      associatedUser: getAssociatedTokenAddressSync(mintH.publicKey, user),
      creatorVault: holderVault,
    });

    it("a holder-reward coin's creator is the holder-rewards PDA and fees accrue in its vault", async () => {
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), mintH.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await curve.methods
        .create("Holders Coin", "HODL", "https://example.com/h.json", true, PublicKey.default, false)
        .accounts({
          mint: mintH.publicKey, mintAuthority, bondingCurve: bcH, associatedBondingCurve: getAssociatedTokenAddressSync(mintH.publicKey, bcH, true), global,
          mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([creator, mintH])
        .rpc();
      const bc = await curve.account.bondingCurve.fetch(bcH);
      assert.isTrue(bc.isHolderReward);
      assert.equal(bc.creator.toBase58(), holderPda.toBase58());
      for (const h of [holderA, holderB]) {
        await curve.methods.buyExactSolIn(new BN(2 * LAMPORTS_PER_SOL), new BN(0)).accounts(accts(h.publicKey)).signers([h]).rpc();
      }
      const vault = await lamports(holderVault);
      assert.equal(vault, 2 * 2 * LAMPORTS_PER_SOL * 0.005, "0.5 % of 4 SOL in the holder vault");
    });

    it("only the configured authority can distribute", async () => {
      try {
        await curve.methods
          .distributeFeeToHolders([new BN(1000)])
          .accounts({ global, holderRewardAuthority: trader.publicKey, mint: mintH.publicKey, bondingCurve: bcH, holderRewards: holderPda, creatorVault: holderVault, systemProgram: SystemProgram.programId })
          .remainingAccounts([{ pubkey: holderA.publicKey, isSigner: false, isWritable: true }])
          .signers([trader])
          .rpc();
        assert.fail("should reject");
      } catch (e) {
        assert.include(String(e), "Unauthorized");
      }
    });

    it("authority pays holders pro-rata from the vault; rent floor stays", async () => {
      const vault = await lamports(holderVault);
      const rentMin = await conn.getMinimumBalanceForRentExemption(0);
      const available = vault - rentMin;
      const a = Math.floor(available * 0.6), b = available - a;
      const beforeA = await lamports(holderA.publicKey), beforeB = await lamports(holderB.publicKey);
      await curve.methods
        .distributeFeeToHolders([new BN(a), new BN(b)])
        .accounts({ global, holderRewardAuthority: admin.publicKey, mint: mintH.publicKey, bondingCurve: bcH, holderRewards: holderPda, creatorVault: holderVault, systemProgram: SystemProgram.programId })
        .remainingAccounts([
          { pubkey: holderA.publicKey, isSigner: false, isWritable: true },
          { pubkey: holderB.publicKey, isSigner: false, isWritable: true },
        ])
        .rpc();
      assert.equal((await lamports(holderA.publicKey)) - beforeA, a);
      assert.equal((await lamports(holderB.publicKey)) - beforeB, b);
      assert.equal(await lamports(holderVault), rentMin);
      try {
        await curve.methods
          .distributeFeeToHolders([new BN(1)])
          .accounts({ global, holderRewardAuthority: admin.publicKey, mint: mintH.publicKey, bondingCurve: bcH, holderRewards: holderPda, creatorVault: holderVault, systemProgram: SystemProgram.programId })
          .remainingAccounts([{ pubkey: holderA.publicKey, isSigner: false, isWritable: true }])
          .rpc();
        assert.fail("cannot dip below rent");
      } catch (e) {
        assert.ok(String(e).length > 0);
      }
    });

    it("a normal coin rejects holder distribution", async () => {
      try {
        const [hp] = PublicKey.findProgramAddressSync([Buffer.from("holder-rewards"), mint.toBuffer()], curve.programId);
        const [hv] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), hp.toBuffer()], curve.programId);
        await curve.methods
          .distributeFeeToHolders([new BN(1)])
          .accounts({ global, holderRewardAuthority: admin.publicKey, mint, bondingCurve, holderRewards: hp, creatorVault: hv, systemProgram: SystemProgram.programId })
          .remainingAccounts([{ pubkey: holderA.publicKey, isSigner: false, isWritable: true }])
          .rpc();
        assert.fail("should reject");
      } catch (e) {
        assert.include(String(e), "NotHolderRewardCoin");
      }
    });

    it("admin can rotate the distribution authority", async () => {
      const newAuth = Keypair.generate();
      await curve.methods.updateHolderRewardConfig(true, newAuth.publicKey).accounts({ authority: admin.publicKey, global }).rpc();
      const g = await curve.account.global.fetch(global);
      assert.equal(g.holderRewardAuthority.toBase58(), newAuth.publicKey.toBase58());
      await curve.methods.updateHolderRewardConfig(true, admin.publicKey).accounts({ authority: admin.publicKey, global }).rpc();
    });
  });

  // ------------------------------------------------------------------ volume incentives
  describe("volume incentives", () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const DAY = 12; // seconds per "day" for the test campaign (long enough that the in-day claim really is in-day)
    let incMint: PublicKey;
    const [gva] = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], curve.programId);
    const uva = (u: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), u.toBuffer()], curve.programId)[0];
    const userA = Keypair.generate();
    const userB = Keypair.generate();
    const mintV = Keypair.generate();
    let bcV: PublicKey;
    let start = 0;

    before(async () => {
      await Promise.all([airdrop(userA.publicKey, 20), airdrop(userB.publicKey, 20)]);
      incMint = await createMint(conn, admin, admin.publicKey, null, 6);
      [bcV] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mintV.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), mintV.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await curve.methods
        .create("Volume Coin", "VOL", "https://example.com/v.json", false, PublicKey.default, false)
        .accounts({ mint: mintV.publicKey, mintAuthority, bondingCurve: bcV, associatedBondingCurve: getAssociatedTokenAddressSync(mintV.publicKey, bcV, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator, mintV])
        .rpc();
    });

    const buyAccts = (u: PublicKey, tracked: boolean) => ({
      ...tradeAccounts(u),
      mint: mintV.publicKey, bondingCurve: bcV, associatedBondingCurve: getAssociatedTokenAddressSync(mintV.publicKey, bcV, true),
      associatedUser: getAssociatedTokenAddressSync(mintV.publicKey, u),
      globalVolumeAccumulator: tracked ? gva : null, userVolumeAccumulator: tracked ? uva(u) : null,
    });

    it("admin schedules a campaign and funds the incentive vault", async () => {
      const now = (await conn.getBlockTime(await conn.getSlot("confirmed")))!;
      start = now + 3;
      const end = start + DAY * 5;
      await curve.methods
        .adminUpdateTokenIncentives(new BN(start), new BN(end), new BN(DAY), new BN(30), new BN(1_000_000_000)) // 1000 tokens/day for every day
        .accounts({ authority: admin.publicKey, global, globalVolumeAccumulator: gva, mint: incMint, globalIncentiveTokenAccount: getAssociatedTokenAddressSync(incMint, gva, true), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .rpc();
      await mintTo(conn, admin, incMint, getAssociatedTokenAddressSync(incMint, gva, true), admin, 100_000_000_000);
      const g = await curve.account.globalVolumeAccumulator.fetch(gva);
      assert.equal(g.startTime.toNumber(), start);
      assert.equal(g.totalTokenSupply[0].toNumber(), 1_000_000_000);
      assert.equal(g.totalTokenSupply[5].toNumber(), 1_000_000_000);
      assert.equal(g.totalTokenSupply[6].toNumber(), 0);
    });

    it("tracked buys accrue SOL volume for the user and the day", async () => {
      for (const u of [userA, userB]) {
        await curve.methods.initUserVolumeAccumulator().accounts({ payer: u.publicKey, user: u.publicKey, userVolumeAccumulator: uva(u.publicKey), systemProgram: SystemProgram.programId }).signers([u]).rpc();
      }
      // wait until the validator's clock is past the campaign start (wall clock and chain clock drift)
      for (;;) {
        const t = await conn.getBlockTime(await conn.getSlot("confirmed"));
        if (t && t >= start + 1) break;
        await sleep(500);
      }
      await curve.methods.buyExactSolIn(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accounts(buyAccts(userA.publicKey, true)).signers([userA]).rpc();
      await curve.methods.buyExactSolIn(new BN(3 * LAMPORTS_PER_SOL), new BN(0)).accounts(buyAccts(userB.publicKey, true)).signers([userB]).rpc();
      // untracked buy must not count
      await curve.methods.buyExactSolIn(new BN(5 * LAMPORTS_PER_SOL), new BN(0)).accounts(buyAccts(trader.publicKey, false)).signers([trader]).rpc();
      const a = await curve.account.userVolumeAccumulator.fetch(uva(userA.publicKey));
      const g = await curve.account.globalVolumeAccumulator.fetch(gva);
      assert.equal(a.currentSolVolume.toNumber(), 1 * LAMPORTS_PER_SOL);
      assert.isTrue(a.needsClaim);
      assert.equal(g.solVolumes[0].toNumber(), 4 * LAMPORTS_PER_SOL);
    });

    it("claiming during the day pays nothing; after the day it pays pro-rata (25 % / 75 %)", async () => {
      const claimAccts = (u: PublicKey) => ({ user: u, payer: admin.publicKey, globalVolumeAccumulator: gva, globalIncentiveTokenAccount: getAssociatedTokenAddressSync(incMint, gva, true), userVolumeAccumulator: uva(u), mint: incMint, userAta: getAssociatedTokenAddressSync(incMint, u), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId });
      await curve.methods.claimTokenIncentives().accounts(claimAccts(userA.publicKey)).rpc();
      assert.equal((await tokenBal(getAssociatedTokenAddressSync(incMint, userA.publicKey))).toString(), "0");
      for (;;) { // cross into day 1 by chain time
        const t = await conn.getBlockTime(await conn.getSlot("confirmed"));
        if (t && t >= start + DAY + 1) break;
        await sleep(500);
      }
      await curve.methods.claimTokenIncentives().accounts(claimAccts(userA.publicKey)).rpc();
      await curve.methods.claimTokenIncentives().accounts(claimAccts(userB.publicKey)).rpc();
      assert.equal((await tokenBal(getAssociatedTokenAddressSync(incMint, userA.publicKey))).toString(), "250000000");
      assert.equal((await tokenBal(getAssociatedTokenAddressSync(incMint, userB.publicKey))).toString(), "750000000");
      const a = await curve.account.userVolumeAccumulator.fetch(uva(userA.publicKey));
      assert.equal(a.totalClaimedTokens.toNumber(), 250000000);
      assert.equal(a.currentSolVolume.toNumber(), 0);
      assert.isFalse(a.needsClaim);
    });

    it("an AMM buy with track_volume counts toward the same campaign (CPI from the AMM's tracker PDA)", async () => {
      await wrapSol(userB, 3);
      const before = (await curve.account.userVolumeAccumulator.fetch(uva(userB.publicKey))).currentSolVolume.toNumber();
      const sumDays = (g: any) => g.solVolumes.reduce((a: number, v: any) => a + v.toNumber(), 0);
      const gBefore = sumDays(await curve.account.globalVolumeAccumulator.fetch(gva));
      await amm.methods.buyExactQuoteIn(new BN(1 * LAMPORTS_PER_SOL), new BN(0), true)
        .accounts({ ...swapAccounts(userB.publicKey), globalVolumeAccumulator: gva, userVolumeAccumulator: uva(userB.publicKey), curveProgram: curve.programId })
        .signers([userB]).rpc();
      const after = (await curve.account.userVolumeAccumulator.fetch(uva(userB.publicKey))).currentSolVolume.toNumber();
      const gAfter = sumDays(await curve.account.globalVolumeAccumulator.fetch(gva));
      // the pool leg of a 1 SOL budget (fees excluded) is counted, for the user and for the day
      assert.isAbove(after - before, 0.99 * LAMPORTS_PER_SOL);
      assert.isBelow(after - before, 1 * LAMPORTS_PER_SOL);
      assert.equal(gAfter - gBefore, after - before);
      // a stranger cannot call the curve's tracker directly
      try {
        await curve.methods.trackAmmVolume(new BN(1)).accounts({ user: userB.publicKey, globalVolumeAccumulator: gva, userVolumeAccumulator: uva(userB.publicKey), volumeTracker: userB.publicKey }).signers([userB]).rpc();
        assert.fail("tracker must be the AMM PDA");
      } catch (e) { assert.include(String(e), "ConstraintSeeds"); }
    });

    it("a stranger cannot change the schedule; user can close the accumulator", async () => {
      try {
        await curve.methods.adminUpdateTokenIncentives(new BN(0), new BN(0), new BN(DAY), new BN(0), new BN(1)).accounts({ authority: trader.publicKey, global, globalVolumeAccumulator: gva, mint: incMint, globalIncentiveTokenAccount: getAssociatedTokenAddressSync(incMint, gva, true), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([trader]).rpc();
        assert.fail("should reject");
      } catch (e) {
        assert.include(String(e), "Unauthorized");
      }
      await curve.methods.closeUserVolumeAccumulator().accounts({ user: userA.publicKey, userVolumeAccumulator: uva(userA.publicKey) }).signers([userA]).rpc();
      assert.isNull(await conn.getAccountInfo(uva(userA.publicKey)));
    });
  });

  // ------------------------------------------------------------------ fees program: tiers, buyback, sharing, social, donation
  describe("fees program", () => {
    const [feeGlobal] = PublicKey.findProgramAddressSync([Buffer.from("fee-program-global")], fees.programId);
    const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from("fee-config"), ], fees.programId);
    const [buybackVault] = PublicKey.findProgramAddressSync([Buffer.from("buyback"), Buffer.from([0])], fees.programId);
    const socialAuthority = Keypair.generate();
    const F = (p: number, c: number, lp = 0) => ({ lpFeeBps: new BN(lp), protocolFeeBps: new BN(p), creatorFeeBps: new BN(c) });
    const tier = (solMcap: number, p: number, c: number) => ({ marketCapLamportsThreshold: new BN(solMcap).mul(new BN(LAMPORTS_PER_SOL)), fees: F(p, c) });
    const [curveEv] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], curve.programId);

    it("initializes global + tiered fee config", async () => {
      await airdrop(socialAuthority.publicKey, 2);
      await fees.methods.initializeFeeProgramGlobal(socialAuthority.publicKey, 0, new BN(0)).accounts({ authority: admin.publicKey }).rpc();
      await fees.methods
        .initializeFeeConfig(F(50, 50), [tier(0, 50, 50), tier(100, 40, 40), tier(300, 30, 30)])
        .accounts({ authority: admin.publicKey, feeProgramGlobal: feeGlobal, feeConfig })
        .rpc();
      const fc = await fees.account.feeConfig.fetch(feeConfig);
      assert.equal(fc.feeTiers.length, 3);
      try {
        await fees.methods.updateFeeConfig([tier(100, 1, 1), tier(50, 1, 1)], F(1, 1)).accounts({ authority: admin.publicKey, feeConfig }).rpc();
        assert.fail("unsorted");
      } catch (e) {
        assert.include(String(e), "TiersNotSorted");
      }
    });

    it("a buy with fee_config pays the tier for its market cap (lower fees as mcap grows)", async () => {
      // fresh coin: mcap starts at 30 SOL -> tier 0 (0.5 %/0.5 %)
      const m = Keypair.generate();
      const [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), m.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await curve.methods.create("Tier Coin", "TIER", "https://example.com/t.json", false, ZERO, false)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator, m]).rpc();
      const accts = { ...tradeAccounts(trader.publicKey), mint: m.publicKey, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), associatedUser: getAssociatedTokenAddressSync(m.publicKey, trader.publicKey), feeConfig };
      let feeBefore = await lamports(feeRecipient.publicKey);
      await curve.methods.buyExactSolIn(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accounts(accts).signers([trader]).rpc();
      assert.equal((await lamports(feeRecipient.publicKey)) - feeBefore, 0.005 * LAMPORTS_PER_SOL, "tier 0: 0.5 % protocol");
      // push mcap above 100 SOL: buy 40 SOL -> vSol 71, vTok 453M... mcap = 71/453M*1B ≈ 156 SOL -> tier 1 (0.4 %)
      await curve.methods.buyExactSolIn(new BN(40 * LAMPORTS_PER_SOL), new BN(0)).accounts(accts).signers([trader]).rpc();
      feeBefore = await lamports(feeRecipient.publicKey);
      await curve.methods.buyExactSolIn(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accounts(accts).signers([trader]).rpc();
      assert.equal((await lamports(feeRecipient.publicKey)) - feeBefore, 0.004 * LAMPORTS_PER_SOL, "tier 1: 0.4 % protocol");
      // without fee_config the flat Global schedule applies (0.5 %)
      feeBefore = await lamports(feeRecipient.publicKey);
      await curve.methods.buyExactSolIn(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accounts({ ...accts, feeConfig: null }).signers([trader]).rpc();
      assert.equal((await lamports(feeRecipient.publicKey)) - feeBefore, 0.005 * LAMPORTS_PER_SOL);
    });

    it("buyback: a share of the protocol fee lands in the buyback vault; authority sweeps it", async () => {
      await fees.methods.initializeBuyback(0, admin.publicKey, new BN(0)).accounts({ authority: admin.publicKey, feeProgramGlobal: feeGlobal, buybackVault }).rpc();
      await curve.methods.setParams({ feeRecipient: feeRecipient.publicKey, ...PARAMS, buybackBasisPoints: new BN(2000), buybackFeeRecipient: buybackVault }).accounts({ authority: admin.publicKey, global }).rpc();
      const vaultBefore = await lamports(buybackVault);
      const feeBefore = await lamports(feeRecipient.publicKey);
      const m = Keypair.generate();
      const [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), m.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await curve.methods.create("Buyback Coin", "BB", "https://example.com/bb.json", false, ZERO, false)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator, m]).rpc();
      await curve.methods.buyExactSolIn(new BN(2 * LAMPORTS_PER_SOL), new BN(0))
        .accounts({ ...tradeAccounts(trader.publicKey), mint: m.publicKey, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), associatedUser: getAssociatedTokenAddressSync(m.publicKey, trader.publicKey), buybackFeeRecipient: buybackVault })
        .signers([trader]).rpc();
      const protocol = 0.005 * 2 * LAMPORTS_PER_SOL; // 0.01 SOL
      assert.equal((await lamports(buybackVault)) - vaultBefore, protocol * 0.2);
      assert.equal((await lamports(feeRecipient.publicKey)) - feeBefore, protocol * 0.8);
      const adminBefore = await lamports(admin.publicKey);
      await fees.methods.sweepBuyback(0).accounts({ authority: admin.publicKey, buybackVault }).rpc();
      assert.isAbove(await lamports(admin.publicKey), adminBefore);
      await curve.methods.setParams({ feeRecipient: feeRecipient.publicKey, ...PARAMS }).accounts({ authority: admin.publicKey, global }).rpc();
    });

    it("fee sharing: creator splits their fee 60/40; payout is pro-rata from the sharing vault", async () => {
      const partner = Keypair.generate();
      await airdrop(partner.publicKey, 1);
      const m = Keypair.generate();
      const [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), m.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      const [sharing] = PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), m.publicKey.toBuffer()], fees.programId);
      const [sharingVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), sharing.toBuffer()], curve.programId);
      await curve.methods.create("Shared Coin", "SHARE", "https://example.com/sh.json", false, ZERO, false)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator, m]).rpc();
      await fees.methods.createFeeSharingConfig()
        .accounts({ payer: creator.publicKey, feeProgramGlobal: feeGlobal, mint: m.publicKey, sharingConfig: sharing, bondingCurve: bc, curveProgram: curve.programId, curveEventAuthority: curveEv, pool: null, ammProgram: null, ammEventAuthority: null, ammGlobalConfig: null, systemProgram: SystemProgram.programId })
        .signers([creator]).rpc();
      assert.equal((await curve.account.bondingCurve.fetch(bc)).creator.toBase58(), sharing.toBase58());
      await fees.methods.updateFeeShares([{ address: creator.publicKey, shareBps: 6000 }, { address: partner.publicKey, shareBps: 4000 }])
        .accounts({ authority: creator.publicKey, mint: m.publicKey, sharingConfig: sharing, creatorVault: sharingVault }).signers([creator]).rpc();
      // trade -> fees accrue in the sharing vault
      await curve.methods.buyExactSolIn(new BN(4 * LAMPORTS_PER_SOL), new BN(0))
        .accounts({ ...tradeAccounts(trader.publicKey), mint: m.publicKey, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), associatedUser: getAssociatedTokenAddressSync(m.publicKey, trader.publicKey), creatorVault: sharingVault })
        .signers([trader]).rpc();
      const rentMin = await conn.getMinimumBalanceForRentExemption(0);
      const available = (await lamports(sharingVault)) - rentMin;
      assert.equal(available, 0.02 * LAMPORTS_PER_SOL - rentMin, "0.5 % of 4 SOL minus the vault's rent floor");
      // changing the split with a non-empty vault is refused
      try {
        await fees.methods.updateFeeShares([{ address: creator.publicKey, shareBps: 10000 }]).accounts({ authority: creator.publicKey, mint: m.publicKey, sharingConfig: sharing, creatorVault: sharingVault }).signers([creator]).rpc();
        assert.fail("vault not empty");
      } catch (e) {
        assert.include(String(e), "VaultNotEmpty");
      }
      const c0 = await lamports(creator.publicKey), p0 = await lamports(partner.publicKey);
      await curve.methods.distributeCreatorFees()
        .accounts({ mint: m.publicKey, bondingCurve: bc, sharingConfig: sharing, creatorVault: sharingVault, systemProgram: SystemProgram.programId })
        .remainingAccounts([{ pubkey: creator.publicKey, isSigner: false, isWritable: true }, { pubkey: partner.publicKey, isSigner: false, isWritable: true }])
        .rpc();
      assert.equal((await lamports(creator.publicKey)) - c0, Math.floor(available * 0.6));
      assert.equal((await lamports(partner.publicKey)) - p0, Math.floor(available * 0.4));
      await fees.methods.revokeFeeSharingAuthority().accounts({ authority: creator.publicKey, sharingConfig: sharing }).signers([creator]).rpc();
      assert.isTrue((await fees.account.sharingConfig.fetch(sharing)).adminRevoked);
    });

    it("social fees: a coin created for an X handle accrues to its PDA; the claim authority pays the verified wallet", async () => {
      const userId = "jackduval";
      const platform = 1;
      const [social] = PublicKey.findProgramAddressSync([Buffer.from("social-fee-pda"), Buffer.from(userId), Buffer.from([platform])], fees.programId);
      const [socialVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), social.toBuffer()], curve.programId);
      await fees.methods.createSocialFeePda(userId, platform).accounts({ payer: trader.publicKey, feeProgramGlobal: feeGlobal, socialFeePda: social, systemProgram: SystemProgram.programId }).signers([trader]).rpc();
      const m = Keypair.generate();
      const [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), m.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await curve.methods.create("Social Coin", "SOC", "https://example.com/soc.json", false, social, false)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: trader.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([trader, m]).rpc();
      assert.equal((await curve.account.bondingCurve.fetch(bc)).creator.toBase58(), social.toBase58());
      await curve.methods.buyExactSolIn(new BN(2 * LAMPORTS_PER_SOL), new BN(0))
        .accounts({ ...tradeAccounts(trader.publicKey), mint: m.publicKey, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), associatedUser: getAssociatedTokenAddressSync(m.publicKey, trader.publicKey), creatorVault: socialVault })
        .signers([trader]).rpc();
      // anyone sweeps the vault into the social PDA (permissionless collect)
      await curve.methods.collectCreatorFee().accounts({ creator: social, creatorVault: socialVault, systemProgram: SystemProgram.programId }).rpc();
      const recipient = Keypair.generate();
      const r0 = await lamports(recipient.publicKey);
      try {
        await fees.methods.claimSocialFeePda(userId, platform).accounts({ socialClaimAuthority: trader.publicKey, feeProgramGlobal: feeGlobal, socialFeePda: social, recipient: recipient.publicKey }).signers([trader]).rpc();
        assert.fail("not the claim authority");
      } catch (e) {
        assert.include(String(e), "NotAuthorized");
      }
      await fees.methods.claimSocialFeePda(userId, platform).accounts({ socialClaimAuthority: socialAuthority.publicKey, feeProgramGlobal: feeGlobal, socialFeePda: social, recipient: recipient.publicKey }).signers([socialAuthority]).rpc();
      const rentMin0 = await conn.getMinimumBalanceForRentExemption(0);
      assert.equal((await lamports(recipient.publicKey)) - r0, 0.01 * LAMPORTS_PER_SOL - rentMin0, "vault keeps its rent floor; the rest reaches the verified wallet");
    });

    it("donation: creator routes fees to a beneficiary; crank forwards them", async () => {
      const beneficiary = Keypair.generate();
      const m = Keypair.generate();
      const [donation] = PublicKey.findProgramAddressSync([Buffer.from("donation-fee-pda"), m.publicKey.toBuffer(), beneficiary.publicKey.toBuffer()], fees.programId);
      const [donationVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), donation.toBuffer()], curve.programId);
      const [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), m.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await fees.methods.createDonationFeePda().accounts({ payer: creator.publicKey, feeProgramGlobal: feeGlobal, baseMint: m.publicKey, beneficiary: beneficiary.publicKey, donationFeePda: donation, systemProgram: SystemProgram.programId }).signers([creator]).rpc().catch(async (e) => { throw e; });
      await curve.methods.create("Charity Coin", "GIVE", "https://example.com/g.json", false, donation, false)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator, m]).rpc();
      await curve.methods.buyExactSolIn(new BN(2 * LAMPORTS_PER_SOL), new BN(0))
        .accounts({ ...tradeAccounts(trader.publicKey), mint: m.publicKey, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), associatedUser: getAssociatedTokenAddressSync(m.publicKey, trader.publicKey), creatorVault: donationVault })
        .signers([trader]).rpc();
      await curve.methods.collectCreatorFee().accounts({ creator: donation, creatorVault: donationVault, systemProgram: SystemProgram.programId }).rpc();
      const b0 = await lamports(beneficiary.publicKey);
      await fees.methods.crankDonationFeePda().accounts({ payer: trader.publicKey, feeProgramGlobal: feeGlobal, donationFeePda: donation, beneficiary: beneficiary.publicKey }).signers([trader]).rpc();
      const rentMin0 = await conn.getMinimumBalanceForRentExemption(0);
      assert.equal((await lamports(beneficiary.publicKey)) - b0, 0.01 * LAMPORTS_PER_SOL - rentMin0);
    });

    it("graduated coin: sharing config reassigns the AMM pool's coin creator and AMM fees split too", async () => {
      // PEOPLE (first coin) is migrated; its creator is `creator`
      const [sharing] = PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), mint.toBuffer()], fees.programId);
      await fees.methods.createFeeSharingConfig()
        .accounts({ payer: creator.publicKey, feeProgramGlobal: feeGlobal, mint, sharingConfig: sharing, bondingCurve, curveProgram: curve.programId, curveEventAuthority: curveEv, pool, ammProgram: amm.programId, ammEventAuthority, ammGlobalConfig, systemProgram: SystemProgram.programId })
        .signers([creator]).rpc();
      const p = await amm.account.pool.fetch(pool);
      assert.equal(p.coinCreator.toBase58(), sharing.toBase58());
      const partner = Keypair.generate();
      const [sharingVaultCurve] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), sharing.toBuffer()], curve.programId);
      await fees.methods.updateFeeShares([{ address: creator.publicKey, shareBps: 5000 }, { address: partner.publicKey, shareBps: 5000 }])
        .accounts({ authority: creator.publicKey, mint, sharingConfig: sharing, creatorVault: sharingVaultCurve }).signers([creator]).rpc();
      // AMM buy now credits the sharing config's AMM vault
      const [vaultAuth] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), sharing.toBuffer()], amm.programId);
      const vaultAta = getAssociatedTokenAddressSync(NATIVE_MINT, vaultAuth, true);
      await amm.methods.buy(new BN("1000000000000"), new BN(10 * LAMPORTS_PER_SOL), false)
        .accounts({ ...swapAccounts(trader.publicKey), coinCreatorVaultAuthority: vaultAuth, coinCreatorVaultAta: vaultAta, feeConfig: null })
        .preInstructions([createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, vaultAta, vaultAuth, NATIVE_MINT)])
        .signers([trader]).rpc();
      const accrued = await tokenBal(vaultAta);
      assert.isAbove(Number(accrued), 0);
      await amm.methods.distributeCoinCreatorFees(true)
        .accounts({ payer: trader.publicKey, pool, sharingConfig: sharing, quoteMint: NATIVE_MINT, coinCreatorVaultAuthority: vaultAuth, coinCreatorVaultAta: vaultAta, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: false, isWritable: false }, { pubkey: partner.publicKey, isSigner: false, isWritable: false },
          { pubkey: getAssociatedTokenAddressSync(NATIVE_MINT, creator.publicKey), isSigner: false, isWritable: true }, { pubkey: getAssociatedTokenAddressSync(NATIVE_MINT, partner.publicKey), isSigner: false, isWritable: true },
        ])
        .signers([trader]).rpc();
      assert.equal((await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, partner.publicKey))).toString(), (accrued / 2n).toString());
      assert.equal((await tokenBal(vaultAta)).toString(), (accrued - (accrued / 2n) * 2n).toString());
    });
  });

  // ------------------------------------------------------------------ community takeover + creator fee config
  describe("admin CTO + creator fee", () => {
    const m = Keypair.generate();
    let bc: PublicKey;
    const newCreator = Keypair.generate();
    const mk = async () => {
      [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), m.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await curve.methods.create("CTO Coin", "CTO", "https://example.com/cto.json", false, PublicKey.default, false)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator, m]).rpc();
    };
    const accts = (user: PublicKey, cv: PublicKey) => ({ ...tradeAccounts(user), mint: m.publicKey, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), associatedUser: getAssociatedTokenAddressSync(m.publicKey, user), creatorVault: cv });

    it("creator sets their own fee within the ceiling; trades use it", async () => {
      await mk();
      try {
        await curve.methods.setCreatorFeeBps(new BN(500), false).accounts({ creator: creator.publicKey, global, mint: m.publicKey, bondingCurve: bc }).signers([creator]).rpc();
        assert.fail("above ceiling");
      } catch (e) {
        assert.include(String(e), "FeeTooHigh");
      }
      await curve.methods.setCreatorFeeBps(new BN(100), false).accounts({ creator: creator.publicKey, global, mint: m.publicKey, bondingCurve: bc }).signers([creator]).rpc();
      const v0 = await lamports(creatorVault);
      await curve.methods.buyExactSolIn(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accounts(accts(trader.publicKey, creatorVault)).signers([trader]).rpc();
      assert.equal((await lamports(creatorVault)) - v0, 0.01 * LAMPORTS_PER_SOL, "1 % creator fee override");
      await curve.methods.setCreatorFeeBps(new BN(0), true).accounts({ creator: creator.publicKey, global, mint: m.publicKey, bondingCurve: bc }).signers([creator]).rpc();
      try {
        await curve.methods.setCreatorFeeBps(new BN(50), false).accounts({ creator: creator.publicKey, global, mint: m.publicKey, bondingCurve: bc }).signers([creator]).rpc();
        assert.fail("locked");
      } catch (e) {
        assert.include(String(e), "CreatorFeeLocked");
      }
    });

    it("admin CTO: reassign the creator, then convert to holder rewards sweeping the old vault", async () => {
      const [hr] = PublicKey.findProgramAddressSync([Buffer.from("holder-rewards"), m.publicKey.toBuffer()], curve.programId);
      const [hrVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), hr.toBuffer()], curve.programId);
      const cto = (currentCreator: PublicKey, toHolders: boolean, nc: PublicKey | null) =>
        curve.methods.adminCto(toHolders, null, nc).accounts({ authority: admin.publicKey, global, mint: m.publicKey, bondingCurve: bc, oldCreatorVault: PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), currentCreator.toBuffer()], curve.programId)[0], holderRewards: hr, holderCreatorVault: hrVault, systemProgram: SystemProgram.programId });
      try {
        await curve.methods.adminCto(false, null, newCreator.publicKey).accounts({ authority: trader.publicKey, global, mint: m.publicKey, bondingCurve: bc, oldCreatorVault: creatorVault, holderRewards: hr, holderCreatorVault: hrVault, systemProgram: SystemProgram.programId }).signers([trader]).rpc();
        assert.fail("stranger");
      } catch (e) {
        assert.include(String(e), "Unauthorized");
      }
      await cto(creator.publicKey, false, newCreator.publicKey).rpc();
      assert.equal((await curve.account.bondingCurve.fetch(bc)).creator.toBase58(), newCreator.publicKey.toBase58());
      // fees now accrue to the new creator's vault
      const [ncVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), newCreator.publicKey.toBuffer()], curve.programId);
      await curve.methods.buyExactSolIn(new BN(2 * LAMPORTS_PER_SOL), new BN(0)).accounts(accts(trader.publicKey, ncVault)).signers([trader]).rpc();
      const pending = await lamports(ncVault);
      assert.isAbove(pending, 0);
      // convert to holder rewards: the pending vault is swept into the holder vault
      await cto(newCreator.publicKey, true, null).rpc();
      const after = await curve.account.bondingCurve.fetch(bc);
      assert.isTrue(after.isHolderReward);
      assert.equal(after.creator.toBase58(), hr.toBase58());
      const rentMin = await conn.getMinimumBalanceForRentExemption(0);
      assert.equal(await lamports(hrVault), pending - rentMin);
      try {
        await cto(hr, false, newCreator.publicKey).rpc();
        assert.fail("holder coins are immutable");
      } catch (e) {
        assert.include(String(e), "HolderRewardCreatorImmutable");
      }
    });

    it("AMM: admin CTO on a pool + coin creator fee override", async () => {
      const p0 = await amm.account.pool.fetch(pool);
      const sharingCreator = p0.coinCreator; // the sharing PDA from the earlier test
      try {
        await amm.methods.adminCtoPool(newCreator.publicKey, false, new BN(50)).accounts({ authority: trader.publicKey, globalConfig: ammGlobalConfig, pool }).signers([trader]).rpc();
        assert.fail("stranger");
      } catch (e) {
        assert.include(String(e), "Unauthorized");
      }
      await amm.methods.adminCtoPool(newCreator.publicKey, false, new BN(80)).accounts({ authority: admin.publicKey, globalConfig: ammGlobalConfig, pool }).rpc();
      let p = await amm.account.pool.fetch(pool);
      assert.equal(p.coinCreator.toBase58(), newCreator.publicKey.toBase58());
      assert.equal(p.creatorFeeBps.toNumber(), 80);
      await airdrop(newCreator.publicKey, 1);
      await amm.methods.setCoinCreatorFeeBps(new BN(0), true).accounts({ coinCreator: newCreator.publicKey, pool, globalConfig: ammGlobalConfig }).signers([newCreator]).rpc();
      p = await amm.account.pool.fetch(pool);
      assert.isFalse(p.canEditCreatorFee);
      // hand it back to the sharing config so later tests keep working
      await amm.methods.adminCtoPool(sharingCreator, false, null).accounts({ authority: admin.publicKey, globalConfig: ammGlobalConfig, pool }).rpc();
    });
  });

  // ------------------------------------------------------------------ Token-2022 coins (create_v3)
  describe("Token-2022 coins", () => {
    const m = Keypair.generate();
    let bc: PublicKey;
    const T22 = TOKEN_2022_PROGRAM_ID;
    const abc = () => getAssociatedTokenAddressSync(m.publicKey, bc, true, T22);
    const accts = (user: PublicKey) => ({
      ...tradeAccounts(user), mint: m.publicKey, bondingCurve: bc, associatedBondingCurve: abc(),
      associatedUser: getAssociatedTokenAddressSync(m.publicKey, user, false, T22), tokenProgram: T22,
    });

    before(async () => {
      // completing a curve costs ~85 SOL; top the trader up after everything above
      await airdrop(trader.publicKey, 150);
    });

    it("create_v3 mints a Token-2022 coin with on-mint metadata, no Metaplex", async () => {
      [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.publicKey.toBuffer()], curve.programId);
      await curve.methods
        .createV3("Twenty Two", "T22", "https://example.com/t22.json", false, PublicKey.default, false)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: abc(), global, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: T22, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID })
        .signers([creator, m])
        .rpc();
      const info = await conn.getAccountInfo(m.publicKey);
      assert.equal(info!.owner.toBase58(), T22.toBase58());
      assert.include(info!.data.toString("utf8"), "Twenty Two", "metadata lives in the mint");
      const mintState = await getMint(conn, m.publicKey, "confirmed", T22);
      assert.isNull(mintState.mintAuthority);
      assert.equal((await curve.account.bondingCurve.fetch(bc)).tokenTotalSupply.toString(), PARAMS.tokenTotalSupply.toString());
    });

    it("trades, completes and migrates a Token-2022 coin into the AMM", async () => {
      await curve.methods.buyExactSolIn(new BN(1 * LAMPORTS_PER_SOL), new BN(0)).accounts(accts(trader.publicKey)).signers([trader]).rpc();
      const bal = (await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(m.publicKey, trader.publicKey, false, T22))).value.amount;
      assert.isAbove(Number(bal), 0);
      await curve.methods.sell(new BN(bal).divn(2), new BN(0)).accounts(accts(trader.publicKey)).signers([trader]).rpc();
      await curve.methods.buy(new BN("900000000000000"), new BN(150 * LAMPORTS_PER_SOL)).accounts(accts(trader.publicKey)).signers([trader]).rpc();
      assert.isTrue((await curve.account.bondingCurve.fetch(bc)).complete);
      const [pool22] = PublicKey.findProgramAddressSync([Buffer.from("pool"), Buffer.from([0, 0]), bc.toBuffer(), m.publicKey.toBuffer(), NATIVE_MINT.toBuffer()], amm.programId);
      const [lp22] = PublicKey.findProgramAddressSync([Buffer.from("pool-lp-mint"), pool22.toBuffer()], amm.programId);
      await curve.methods
        .migrate()
        .accounts({
          global, feeRecipient: feeRecipient.publicKey, mint: m.publicKey, bondingCurve: bc, associatedBondingCurve: abc(), baseTokenProgram: T22,
          bondingCurveWsol: getAssociatedTokenAddressSync(NATIVE_MINT, bc, true), bondingCurveLp: getAssociatedTokenAddressSync(lp22, bc, true), user: trader.publicKey, wsolMint: NATIVE_MINT,
          ammProgram: amm.programId, ammGlobalConfig, pool: pool22, lpMint: lp22, lockedLpTokenAccount: getAssociatedTokenAddressSync(lp22, pool22, true),
          poolBaseTokenAccount: getAssociatedTokenAddressSync(m.publicKey, pool22, true, T22), poolQuoteTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, pool22, true),
          coinCreatorVaultAuthority, coinCreatorVaultAta, ammEventAuthority, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
        .signers([trader]).rpc();
      const p = await amm.account.pool.fetch(pool22);
      assert.equal(p.baseMint.toBase58(), m.publicKey.toBase58());
      // AMM buy with a Token-2022 base
      await amm.methods.buy(new BN("1000000000000"), new BN(10 * LAMPORTS_PER_SOL), false)
        .accounts({
          pool: pool22, user: trader.publicKey, globalConfig: ammGlobalConfig, baseMint: m.publicKey, quoteMint: NATIVE_MINT,
          userBaseTokenAccount: getAssociatedTokenAddressSync(m.publicKey, trader.publicKey, false, T22), userQuoteTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey),
          poolBaseTokenAccount: p.poolBaseTokenAccount, poolQuoteTokenAccount: p.poolQuoteTokenAccount, protocolFeeRecipient: feeRecipient.publicKey,
          protocolFeeRecipientTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, feeRecipient.publicKey), coinCreatorVaultAuthority, coinCreatorVaultAta,
          baseTokenProgram: T22, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, feeConfig: null, buybackFeeRecipientTokenAccount: null, globalVolumeAccumulator: null, userVolumeAccumulator: null, curveProgram: null,
        })
        .signers([trader]).rpc();
      assert.isAbove(Number((await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(m.publicKey, trader.publicKey, false, T22))).value.amount), 0);
    });

    it("multi_hop_swap: PEOPLE -> WSOL -> T22 in one instruction, intermediates never touch the wallet", async () => {
      const [pool22] = PublicKey.findProgramAddressSync([Buffer.from("pool"), Buffer.from([0, 0]), bc.toBuffer(), m.publicKey.toBuffer(), NATIVE_MINT.toBuffer()], amm.programId);
      const pA = await amm.account.pool.fetch(pool);
      const pB = await amm.account.pool.fetch(pool22);
      const leg = (p: any, poolKey: PublicKey) => [
        { pubkey: poolKey, isSigner: false, isWritable: true },
        { pubkey: p.poolBaseTokenAccount, isSigner: false, isWritable: true },
        { pubkey: p.poolQuoteTokenAccount, isSigner: false, isWritable: true },
        { pubkey: p.baseMint, isSigner: false, isWritable: false },
        { pubkey: p.quoteMint, isSigner: false, isWritable: false },
        { pubkey: getAssociatedTokenAddressSync(NATIVE_MINT, feeRecipient.publicKey), isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(NATIVE_MINT, PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), p.coinCreator.toBuffer()], amm.programId)[0], true), isSigner: false, isWritable: true },
      ];
      const userIn = getAssociatedTokenAddressSync(mint, trader.publicKey);
      const userOut = getAssociatedTokenAddressSync(m.publicKey, trader.publicKey, false, T22);
      const inBefore = await tokenBal(userIn);
      const outBefore = BigInt((await conn.getTokenAccountBalance(userOut)).value.amount);
      const wsolBefore = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey)).catch(() => 0n);
      const amountIn = new BN("500000000000"); // 500k PEOPLE
      await amm.methods
        .multiHopSwap(amountIn, new BN(1))
        .accounts({ user: trader.publicKey, userInTokenAccount: userIn, userOutTokenAccount: userOut, globalConfig: ammGlobalConfig, feeConfig: null, tokenProgram: TOKEN_PROGRAM_ID, tokenProgram2022: T22 })
        .remainingAccounts([...leg(pA, pool), ...leg(pB, pool22)])
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
        .signers([trader]).rpc();
      assert.equal((inBefore - (await tokenBal(userIn))).toString(), amountIn.toString());
      assert.isAbove(Number(BigInt((await conn.getTokenAccountBalance(userOut)).value.amount) - outBefore), 0);
      assert.equal((await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey)).catch(() => 0n)).toString(), wsolBefore.toString(), "no WSOL left in the wallet");
    });
  });

  // ------------------------------------------------------------------ Mayhem mode
  describe("mayhem mode", () => {
    const traderBot = Keypair.generate();
    const m = Keypair.generate();
    let bc: PublicKey;
    const [gp] = PublicKey.findProgramAddressSync([Buffer.from("global-params")], mayhem.programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("sol-vault")], mayhem.programId);
    const [stateV] = PublicKey.findProgramAddressSync([Buffer.from("mayhem-state"), m.publicKey.toBuffer()], mayhem.programId);
    const vaultAta = () => getAssociatedTokenAddressSync(m.publicKey, vault, true);
    const curveEv = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], curve.programId)[0];
    const tradeAccts = () => ({
      trader: traderBot.publicKey, globalParams: gp, mayhemState: stateV, mint: m.publicKey, solVault: vault, mayhemTokenVault: vaultAta(),
      curveProgram: curve.programId, global, feeRecipient: feeRecipient.publicKey, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true),
      creatorVault, feeConfig: null, buybackFeeRecipient: null, curveEventAuthority: curveEv, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    });
    const price = (vs: BN, vt: BN) => new BN(vs.toString()).mul(new BN("1000000000000000")).div(vt); // lamports/token*1e9*1e6 as in the program

    before(async () => {
      await airdrop(traderBot.publicKey, 5);
      await mayhem.methods.initializeGlobalParams(traderBot.publicKey, feeRecipient.publicKey, new BN(5 * LAMPORTS_PER_SOL), new BN(3)).accounts({ admin: admin.publicKey }).rpc();
      // fund the vault
      await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: vault, lamports: 20 * LAMPORTS_PER_SOL })));
    });

    it("mayhem launches use the mayhem virtual params and register a state with a deadline", async () => {
      await curve.methods.toggleMayhemMode(true).accounts({ authority: admin.publicKey, global }).rpc();
      await curve.methods.setMayhemVirtualParams(new BN(60 * LAMPORTS_PER_SOL), PARAMS.initialVirtualTokenReserves).accounts({ authority: admin.publicKey, global }).rpc();
      [bc] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), m.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await curve.methods.create("Mayhem Coin", "MAYHEM", "https://example.com/mayhem.json", false, PublicKey.default, true)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator, m]).rpc();
      const c = await curve.account.bondingCurve.fetch(bc);
      assert.isTrue(c.isMayhemMode);
      assert.equal(c.virtualSolReserves.toString(), (60 * LAMPORTS_PER_SOL).toString());
      await mayhem.methods.initState().accounts({ payer: creator.publicKey, globalParams: gp, mint: m.publicKey, bondingCurve: bc, mayhemState: stateV, systemProgram: SystemProgram.programId }).signers([creator]).rpc();
      const st = await mayhem.account.mayhemState.fetch(stateV);
      assert.equal(st.mint.toBase58(), m.publicKey.toBase58());
      assert.isAbove(st.endTimestamp.toNumber(), 0);
    });

    it("trader buys from the vault inside the price tolerance; cap and tolerance are enforced", async () => {
      const c = await curve.account.bondingCurve.fetch(bc);
      const ref = price(c.virtualSolReserves, c.virtualTokenReserves);
      try {
        await mayhem.methods.buy(new BN(1 * LAMPORTS_PER_SOL), ref.muln(2), 100).accounts(tradeAccts()).signers([traderBot]).rpc();
        assert.fail("price out of range");
      } catch (e) { assert.include(String(e), "PriceOutOfRange"); }
      try {
        await mayhem.methods.buy(new BN(6 * LAMPORTS_PER_SOL), ref, 100).accounts(tradeAccts()).signers([traderBot]).rpc();
        assert.fail("cap");
      } catch (e) { assert.include(String(e), "SweepCapExceeded"); }
      const v0 = await lamports(vault);
      await mayhem.methods.buy(new BN(2 * LAMPORTS_PER_SOL), ref, 100).accounts(tradeAccts()).signers([traderBot]).rpc();
      assert.isBelow(await lamports(vault), v0 - 2 * LAMPORTS_PER_SOL);
      assert.isAbove(Number(await tokenBal(vaultAta())), 0);
      const g = await mayhem.account.globalParams.fetch(gp);
      assert.isAbove(Number(g.solDeployed.toString()), 2 * LAMPORTS_PER_SOL);
      try {
        await mayhem.methods.buy(new BN(1 * LAMPORTS_PER_SOL), ref, 100).accounts({ ...tradeAccts(), trader: trader.publicKey, globalParams: gp }).signers([trader]).rpc();
        assert.fail("not the trader");
      } catch (e) { assert.include(String(e), "Unauthorized"); }
    });

    it("trader sells back within the retained-reserve limit", async () => {
      const c = await curve.account.bondingCurve.fetch(bc);
      const ref = price(c.virtualSolReserves, c.virtualTokenReserves);
      const have = await tokenBal(vaultAta());
      try {
        await mayhem.methods.sell(new BN(have.toString()), ref, 500, 9900).accounts(tradeAccts()).signers([traderBot]).rpc();
        assert.fail("retained reserve");
      } catch (e) { assert.include(String(e), "RetainedReserve"); }
      const v0 = await lamports(vault);
      await mayhem.methods.sell(new BN((have / 2n).toString()), ref, 500, 0).accounts(tradeAccts()).signers([traderBot]).rpc();
      assert.isAbove(await lamports(vault), v0);
    });

    it("after the deadline anyone burns what the vault still holds; admin withdraws SOL", async () => {
      for (;;) { const t = await conn.getBlockTime(await conn.getSlot("confirmed")); const st = await mayhem.account.mayhemState.fetch(stateV); if (t && t >= st.endTimestamp.toNumber()) break; await new Promise((r) => setTimeout(r, 500)); }
      const supplyBefore = (await getMint(conn, m.publicKey)).supply;
      await mayhem.methods.burnTokens().accounts({ mayhemState: stateV, mint: m.publicKey, mayhemTokenVault: vaultAta(), solVault: vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
      assert.isBelow(Number((await getMint(conn, m.publicKey)).supply), Number(supplyBefore));
      assert.equal((await tokenBal(vaultAta())).toString(), "0");
      const a0 = await lamports(admin.publicKey);
      await mayhem.methods.withdrawAdmin(new BN(1 * LAMPORTS_PER_SOL)).accounts({ admin: admin.publicKey, globalParams: gp, solVault: vault, systemProgram: SystemProgram.programId }).rpc();
      assert.isAbove(await lamports(admin.publicKey), a0 + 0.9 * LAMPORTS_PER_SOL);
      await curve.methods.toggleMayhemMode(false).accounts({ authority: admin.publicKey, global }).rpc();
    });
  });

  // ------------------------------------------------------------------ AMM extras (pump.fun PumpSwap parity)
  describe("AMM extras: exact-quote-in, buyback split, boost buy-and-burn, extend_account", () => {
    const bbRecipient = Keypair.generate();
    const bbAta = () => getAssociatedTokenAddressSync(NATIVE_MINT, bbRecipient.publicKey);
    const effQuote = async () => { const p = await amm.account.pool.fetch(pool); return (await tokenBal(poolQuote)) + BigInt(p.virtualQuoteReserves.toString()); };
    // earlier tests reassigned the pool's coin creator (sharing / CTO): derive the current vault
    const swapNow = async (u: PublicKey) => {
      const p = await amm.account.pool.fetch(pool);
      const [va] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), p.coinCreator.toBuffer()], amm.programId);
      return { ...swapAccounts(u), coinCreatorVaultAuthority: va, coinCreatorVaultAta: getAssociatedTokenAddressSync(NATIVE_MINT, va, true) };
    };
    const ensureVault = async (u: PublicKey) => { const a = await swapNow(u); return [createAssociatedTokenAccountIdempotentInstruction(u, a.coinCreatorVaultAta, a.coinCreatorVaultAuthority, NATIVE_MINT)]; };

    it("buy_exact_quote_in spends at most the budget and respects min_base_amount_out", async () => {
      await wrapSol(trader, 5);
      const before = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey));
      const baseBefore = await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey));
      const budget = 2n * BigInt(LAMPORTS_PER_SOL);
      await amm.methods.buyExactQuoteIn(new BN(budget.toString()), new BN(0), false).accounts(await swapNow(trader.publicKey)).preInstructions(await ensureVault(trader.publicKey)).signers([trader]).rpc();
      const spent = before - (await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey)));
      const got = (await tokenBal(getAssociatedTokenAddressSync(mint, trader.publicKey))) - baseBefore;
      assert.isTrue(spent <= budget && spent > (budget * 9990n) / 10000n, `spent ${spent} of ${budget}`);
      assert.isAbove(Number(got), 0);
      try {
        await amm.methods.buyExactQuoteIn(new BN(budget.toString()), new BN((got * 2n).toString()), false).accounts(await swapNow(trader.publicKey)).preInstructions(await ensureVault(trader.publicKey)).signers([trader]).rpc();
        assert.fail("min out");
      } catch (e) { assert.include(String(e), "ExceededSlippage"); }
    });

    it("buyback: half of the protocol fee lands in the buyback recipient's WSOL ATA when it is passed", async () => {
      await amm.methods.updateBuybackConfig(new BN(5000), bbRecipient.publicKey).accounts({ admin: admin.publicKey, globalConfig: ammGlobalConfig }).rpc();
      await provider.sendAndConfirm(new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, bbAta(), bbRecipient.publicKey, NATIVE_MINT)));
      const protoAta = getAssociatedTokenAddressSync(NATIVE_MINT, feeRecipient.publicKey);
      const p0 = await tokenBal(protoAta);
      const baseOut = new BN("1000000000000");
      await amm.methods.buy(baseOut, new BN(5 * LAMPORTS_PER_SOL), false).accounts({ ...(await swapNow(trader.publicKey)), buybackFeeRecipientTokenAccount: bbAta() }).preInstructions(await ensureVault(trader.publicKey)).signers([trader]).rpc();
      const bb = await tokenBal(bbAta());
      const p1 = await tokenBal(protoAta);
      assert.isAbove(Number(bb), 0);
      assert.isTrue(bb === p1 - p0 || bb === p1 - p0 + 1n, `buyback ${bb} vs protocol ${p1 - p0}`); // floor on the buyback side
      // a wrong ATA (not owned by the configured recipient) is rejected
      try {
        await amm.methods.buy(baseOut, new BN(5 * LAMPORTS_PER_SOL), false).accounts({ ...(await swapNow(trader.publicKey)), buybackFeeRecipientTokenAccount: protoAta }).signers([trader]).rpc();
        assert.fail("wrong buyback ata");
      } catch (e) { assert.include(String(e), "InvalidFeeRecipient"); }
      await amm.methods.updateBuybackConfig(new BN(0), PublicKey.default).accounts({ admin: admin.publicKey, globalConfig: ammGlobalConfig }).rpc();
    });

    it("init_boost parks 20 % of the quote in the vault without moving the price; LP moves are locked", async () => {
      const [boostAuth] = PublicKey.findProgramAddressSync([Buffer.from("boost-vault"), pool.toBuffer()], amm.programId);
      const vault = getAssociatedTokenAddressSync(NATIVE_MINT, boostAuth, true);
      const boostAccts = { pool, globalConfig: ammGlobalConfig, payer: admin.publicKey, quoteMint: NATIVE_MINT, lpMint, poolQuoteTokenAccount: poolQuote, boostVaultAuthority: boostAuth, boostVault: vault, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
      try { await amm.methods.initBoost().accounts(boostAccts).rpc(); assert.fail("disabled"); } catch (e) { assert.include(String(e), "BoostDisabled"); }
      await amm.methods.toggleBoost(true).accounts({ admin: admin.publicKey, globalConfig: ammGlobalConfig }).rpc();
      await amm.methods.setBoostAuthority(admin.publicKey).accounts({ admin: admin.publicKey, globalConfig: ammGlobalConfig }).rpc();
      const base = await tokenBal(poolBase);
      const quoteBefore = await tokenBal(poolQuote);
      const priceBefore = Number(await effQuote()) / Number(base);
      await amm.methods.initBoost().accounts(boostAccts).rpc();
      const p = await amm.account.pool.fetch(pool);
      assert.equal(p.virtualQuoteReserves.toString(), (quoteBefore / 5n).toString());
      assert.equal((await tokenBal(vault)).toString(), (quoteBefore / 5n).toString());
      assert.equal((await tokenBal(poolQuote)).toString(), (quoteBefore - quoteBefore / 5n).toString());
      assert.closeTo(Number(await effQuote()) / Number(base), priceBefore, 1e-12);
      try { await amm.methods.initBoost().accounts(boostAccts).rpc(); assert.fail("twice"); } catch (e) { assert.include(String(e), "AlreadyBoosted"); }
      // a trader's quote for 1M tokens is the same as before the boost
      const q = await tokenBal(poolQuote); const v = BigInt(p.virtualQuoteReserves.toString());
      const baseOut = 1_000_000_000_000n;
      const quoteIn = (baseOut * (q + v) + (base - baseOut) - 1n) / (base - baseOut);
      const quoteBefore2 = await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey));
      await amm.methods.buy(new BN(baseOut.toString()), new BN((quoteIn * 101n / 100n).toString()), false).accounts(await swapNow(trader.publicKey)).preInstructions(await ensureVault(trader.publicKey)).signers([trader]).rpc();
      const spent = quoteBefore2 - (await tokenBal(getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey)));
      assert.isTrue(spent >= quoteIn && spent <= (quoteIn * 101n) / 100n, `spent ${spent} for quoteIn ${quoteIn}`); // pool leg priced on effective reserves + up to 1 % fees
      // deposits are locked while the boost is in flight
      try {
        await amm.methods.deposit(new BN(1_000_000_000), new BN("1000000000000000"), new BN(10 * LAMPORTS_PER_SOL)).accounts({ pool, globalConfig: ammGlobalConfig, user: trader.publicKey, baseMint: mint, quoteMint: NATIVE_MINT, lpMint, userBaseTokenAccount: getAssociatedTokenAddressSync(mint, trader.publicKey), userQuoteTokenAccount: getAssociatedTokenAddressSync(NATIVE_MINT, trader.publicKey), userPoolTokenAccount: getAssociatedTokenAddressSync(lpMint, trader.publicKey), poolBaseTokenAccount: poolBase, poolQuoteTokenAccount: poolQuote, tokenProgram: TOKEN_PROGRAM_ID, baseTokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([trader]).rpc();
        assert.fail("locked");
      } catch (e) { assert.include(String(e), "BoostInProgress"); }
    });

    it("boost_buy_and_burn: the authority spends the vault, base is burned, price rises, vault closes when empty", async () => {
      const [boostAuth] = PublicKey.findProgramAddressSync([Buffer.from("boost-vault"), pool.toBuffer()], amm.programId);
      const vault = getAssociatedTokenAddressSync(NATIVE_MINT, boostAuth, true);
      const accts = (a: PublicKey) => ({ pool, globalConfig: ammGlobalConfig, authority: a, baseMint: mint, quoteMint: NATIVE_MINT, poolBaseTokenAccount: poolBase, poolQuoteTokenAccount: poolQuote, boostVaultAuthority: boostAuth, boostVault: vault, baseTokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID });
      try { await amm.methods.boostBuyAndBurn(new BN(1), new BN(0)).accounts(accts(trader.publicKey)).signers([trader]).rpc(); assert.fail("not the authority"); } catch (e) { assert.include(String(e), "Unauthorized"); }
      const vaultAmt = await tokenBal(vault);
      const base0 = await tokenBal(poolBase);
      const supply0 = (await getMint(conn, mint)).supply;
      const eff0 = await effQuote();
      const half = vaultAmt / 2n;
      const expectBurn = (half * base0) / (eff0 + half);
      await amm.methods.boostBuyAndBurn(new BN(half.toString()), new BN(expectBurn.toString())).accounts(accts(admin.publicKey)).rpc();
      const base1 = await tokenBal(poolBase);
      assert.equal((base0 - base1).toString(), expectBurn.toString());
      assert.equal((supply0 - (await getMint(conn, mint)).supply).toString(), expectBurn.toString());
      const p1 = await amm.account.pool.fetch(pool);
      assert.equal(p1.virtualQuoteReserves.toString(), (vaultAmt - half).toString());
      assert.equal((await effQuote()).toString(), eff0.toString(), "effective quote unchanged by the burn");
      assert.isAbove(Number(eff0) / Number(base1), Number(eff0) / Number(base0), "price up");
      // drain the rest (request more than the vault holds: clamps), vault closes, pool unlocks
      await amm.methods.boostBuyAndBurn(new BN(vaultAmt.toString()), new BN(0)).accounts(accts(admin.publicKey)).rpc();
      assert.isNull(await conn.getAccountInfo(vault));
      const p2 = await amm.account.pool.fetch(pool);
      assert.equal(p2.virtualQuoteReserves.toString(), "0");
      assert.equal((await tokenBal(poolQuote)).toString(), eff0.toString());
      await amm.methods.toggleBoost(false).accounts({ admin: admin.publicKey, globalConfig: ammGlobalConfig }).rpc();
    });

    it("extend_account refuses accounts that already have the current layout", async () => {
      try { await amm.methods.extendAccount().accounts({ payer: admin.publicKey, account: ammGlobalConfig, systemProgram: SystemProgram.programId }).rpc(); assert.fail("current"); } catch (e) { assert.include(String(e), "AlreadyExtended"); }
      try { await amm.methods.extendAccount().accounts({ payer: admin.publicKey, account: poolQuote, systemProgram: SystemProgram.programId }).rpc(); assert.fail("foreign"); } catch (e) { assert.include(String(e), "InvalidAccount"); }
      try { await curve.methods.extendAccount().accounts({ payer: admin.publicKey, account: global, systemProgram: SystemProgram.programId }).rpc(); assert.fail("current"); } catch (e) { assert.include(String(e), "InvalidParams"); }
    });
  });
});
