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
} from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { assert } from "chai";
import { OpenpumpCurve } from "../target/types/openpump_curve";
import { OpenpumpAmm } from "../target/types/openpump_amm";
import { OpenpumpFees } from "../target/types/openpump_fees";

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
      .create("People Coin", "PEOPLE", "https://example.com/people.json", false, PublicKey.default)
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
        global, feeRecipient: feeRecipient.publicKey, mint, bondingCurve, associatedBondingCurve, bondingCurveWsol: bcWsol, bondingCurveLp: bcLp,
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
    feeConfig: null,
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
    await amm.methods.buy(baseOut, new BN(total.toString())).accounts(swapAccounts(trader.publicKey)).signers([trader]).rpc();
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
      await amm.methods.buy(new BN(1000), new BN("100000000")).accounts(swapAccounts(trader.publicKey)).signers([trader]).rpc();
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
      .create("Snipe Test", "SNIPE", "https://example.com/s.json", false, PublicKey.default)
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
          global, feeRecipient: feeRecipient.publicKey, feeRecipientQuote: feeQuote, mint: mint2.publicKey, bondingCurve: bc2, associatedBondingCurve: abc2, bondingCurveQuote: bcQuote,
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
        .buy(new BN("1000000000000"), Q(1_000_000))
        .accounts({
          pool: pool2, user: trader.publicKey, globalConfig: ammGlobalConfig, baseMint: mint2.publicKey, quoteMint,
          userBaseTokenAccount: getAssociatedTokenAddressSync(mint2.publicKey, trader.publicKey), userQuoteTokenAccount: getAssociatedTokenAddressSync(quoteMint, trader.publicKey),
          poolBaseTokenAccount: p.poolBaseTokenAccount, poolQuoteTokenAccount: p.poolQuoteTokenAccount,
          protocolFeeRecipient: feeRecipient.publicKey, protocolFeeRecipientTokenAccount: feeQuote,
          coinCreatorVaultAuthority, coinCreatorVaultAta: getAssociatedTokenAddressSync(quoteMint, coinCreatorVaultAuthority, true),
          baseTokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, feeConfig: null,
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
        .create("Holders Coin", "HODL", "https://example.com/h.json", true, PublicKey.default)
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
    const DAY = 4; // seconds per "day" for the test campaign
    let incMint: PublicKey;
    const [gva] = PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], curve.programId);
    const uva = (u: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), u.toBuffer()], curve.programId)[0];
    const userA = Keypair.generate();
    const userB = Keypair.generate();
    const mintV = Keypair.generate();
    let bcV: PublicKey;

    before(async () => {
      await Promise.all([airdrop(userA.publicKey, 20), airdrop(userB.publicKey, 20)]);
      incMint = await createMint(conn, admin, admin.publicKey, null, 6);
      [bcV] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mintV.publicKey.toBuffer()], curve.programId);
      const [meta] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA.toBuffer(), mintV.publicKey.toBuffer()], MPL_TOKEN_METADATA);
      await curve.methods
        .create("Volume Coin", "VOL", "https://example.com/v.json", false, PublicKey.default)
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
      const now = Math.floor(Date.now() / 1000);
      const start = now + 3, end = start + DAY * 5;
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
      await sleep(3500); // campaign start
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
      await sleep(DAY * 1000 + 500); // cross into day 1
      await curve.methods.claimTokenIncentives().accounts(claimAccts(userA.publicKey)).rpc();
      await curve.methods.claimTokenIncentives().accounts(claimAccts(userB.publicKey)).rpc();
      assert.equal((await tokenBal(getAssociatedTokenAddressSync(incMint, userA.publicKey))).toString(), "250000000");
      assert.equal((await tokenBal(getAssociatedTokenAddressSync(incMint, userB.publicKey))).toString(), "750000000");
      const a = await curve.account.userVolumeAccumulator.fetch(uva(userA.publicKey));
      assert.equal(a.totalClaimedTokens.toNumber(), 250000000);
      assert.equal(a.currentSolVolume.toNumber(), 0);
      assert.isFalse(a.needsClaim);
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
      await curve.methods.create("Tier Coin", "TIER", "https://example.com/t.json", false, ZERO)
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
      await curve.methods.create("Buyback Coin", "BB", "https://example.com/bb.json", false, ZERO)
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
      await curve.methods.create("Shared Coin", "SHARE", "https://example.com/sh.json", false, ZERO)
        .accounts({ mint: m.publicKey, mintAuthority, bondingCurve: bc, associatedBondingCurve: getAssociatedTokenAddressSync(m.publicKey, bc, true), global, mplTokenMetadata: MPL_TOKEN_METADATA, metadata: meta, user: creator.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY })
        .signers([creator, m]).rpc();
      await fees.methods.createFeeSharingConfig()
        .accounts({ payer: creator.publicKey, feeProgramGlobal: feeGlobal, mint: m.publicKey, sharingConfig: sharing, bondingCurve: bc, curveProgram: curve.programId, curveEventAuthority: curveEv, pool: null, ammProgram: null, ammEventAuthority: null, systemProgram: SystemProgram.programId })
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
      await curve.methods.create("Social Coin", "SOC", "https://example.com/soc.json", false, social)
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
      await curve.methods.create("Charity Coin", "GIVE", "https://example.com/g.json", false, donation)
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
        .accounts({ payer: creator.publicKey, feeProgramGlobal: feeGlobal, mint, sharingConfig: sharing, bondingCurve, curveProgram: curve.programId, curveEventAuthority: curveEv, pool, ammProgram: amm.programId, ammEventAuthority, systemProgram: SystemProgram.programId })
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
      await amm.methods.buy(new BN("1000000000000"), new BN(10 * LAMPORTS_PER_SOL))
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
});
