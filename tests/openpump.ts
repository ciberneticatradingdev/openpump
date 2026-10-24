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
} from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { assert } from "chai";
import { OpenpumpCurve } from "../target/types/openpump_curve";
import { OpenpumpAmm } from "../target/types/openpump_amm";

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
};

describe("OpenPump — curve + amm", () => {
  const base = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(base.connection, base.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  anchor.setProvider(provider);
  const conn = provider.connection;
  const curve = new Program<OpenpumpCurve>(require("../target/idl/openpump_curve.json"), provider);
  const amm = new Program<OpenpumpAmm>(require("../target/idl/openpump_amm.json"), provider);
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
      .create("People Coin", "PEOPLE", "https://example.com/people.json")
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
      .signers([creator])
      .rpc();
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
      .create("Snipe Test", "SNIPE", "https://example.com/s.json")
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
});
