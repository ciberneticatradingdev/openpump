import { AnchorProvider, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { AMM_IDL, AMM_PROGRAM_ID, CURVE_IDL, CURVE_PROGRAM_ID, FEES_IDL, FEES_PROGRAM_ID, MAYHEM_IDL, MAYHEM_PROGRAM_ID, MPL_TOKEN_METADATA_PROGRAM_ID, WSOL_MINT } from "./ids";
import type { OpenpumpMayhem } from "./openpump_mayhem";
import type { OpenpumpFees } from "./openpump_fees";
import { pda } from "./pda";
import type { OpenpumpAmm } from "./openpump_amm";
import type { OpenpumpCurve } from "./openpump_curve";
import type { CurveState } from "./math";

const bn = (v: bigint | number) => new BN(v.toString());
const big = (v: BN) => BigInt(v.toString());

export interface GlobalState {
  authority: PublicKey;
  feeRecipient: PublicKey;
  ammProgram: PublicKey;
  initialVirtualTokenReserves: bigint;
  initialVirtualSolReserves: bigint;
  initialRealTokenReserves: bigint;
  tokenTotalSupply: bigint;
  feeBasisPoints: bigint;
  creatorFeeBasisPoints: bigint;
  migrationFeeLamports: bigint;
  antiSnipeSlots: bigint;
  antiSnipeMaxBps: bigint;
  paused: boolean;
  buybackBasisPoints: bigint;
  buybackFeeRecipient: PublicKey;
  holderRewardAuthority: PublicKey;
  mayhemModeEnabled: boolean;
}

export interface BondingCurveState extends CurveState {
  mint: PublicKey;
  creator: PublicKey;
  migrated: boolean;
  createdSlot: bigint;
  creatorFeesTotal: bigint;
  protocolFeesTotal: bigint;
  quoteMint: PublicKey;
  isHolderReward: boolean;
}

export interface PoolState {
  address: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  lpMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  lpSupply: bigint;
  coinCreator: PublicKey;
  protocolFees: bigint;
  creatorFees: bigint;
}

export interface AmmConfigState {
  admin: PublicKey;
  lpFeeBasisPoints: bigint;
  protocolFeeBasisPoints: bigint;
  coinCreatorFeeBasisPoints: bigint;
  protocolFeeRecipient: PublicKey;
  disableFlags: number;
}

/** Read-only provider: instruction building and account fetching never need a real signer. */
export function readOnlyProvider(connection: Connection) {
  // Anchor's `Wallet` is Node-only; a throwaway keypair wallet keeps this browser-safe.
  const kp = Keypair.generate();
  const wallet = { publicKey: kp.publicKey, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t };
  return new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
}

export class OpenpumpClient {
  readonly curve: Program<OpenpumpCurve>;
  readonly amm: Program<OpenpumpAmm>;
  readonly fees: Program<OpenpumpFees>;
  readonly mayhem: Program<OpenpumpMayhem>;
  /** Set once the fees program is initialised; trade builders then pass the tiered schedule. */
  feeConfigEnabled = false;
  /** Set to Global.buyback_fee_recipient when buybacks are on; buys/sells then route the share. */
  buybackRecipient: PublicKey | null = null;

  constructor(readonly connection: Connection, provider: AnchorProvider = readOnlyProvider(connection)) {
    this.curve = new Program<OpenpumpCurve>(CURVE_IDL, provider);
    this.amm = new Program<OpenpumpAmm>(AMM_IDL, provider);
    this.fees = new Program<OpenpumpFees>(FEES_IDL, provider);
    this.mayhem = new Program<OpenpumpMayhem>(MAYHEM_IDL, provider);
  }

  /** Detect fee program state so builders include fee_config / buyback automatically. */
  async detectFeeProgram() {
    const [fc, g] = await Promise.all([this.connection.getAccountInfo(pda.feeConfig(), "confirmed"), this.fetchGlobal().catch(() => null)]);
    this.feeConfigEnabled = !!fc;
    this.buybackRecipient = g && g.buybackBasisPoints > 0n && !g.buybackFeeRecipient.equals(PublicKey.default) ? g.buybackFeeRecipient : null;
    return { feeConfigEnabled: this.feeConfigEnabled, buybackRecipient: this.buybackRecipient };
  }

  // ------------------------------------------------------------- reads

  async fetchGlobal(): Promise<GlobalState> {
    const g = await this.curve.account.global.fetch(pda.global());
    return {
      authority: g.authority,
      feeRecipient: g.feeRecipient,
      ammProgram: g.ammProgram,
      initialVirtualTokenReserves: big(g.initialVirtualTokenReserves),
      initialVirtualSolReserves: big(g.initialVirtualSolReserves),
      initialRealTokenReserves: big(g.initialRealTokenReserves),
      tokenTotalSupply: big(g.tokenTotalSupply),
      feeBasisPoints: big(g.feeBasisPoints),
      creatorFeeBasisPoints: big(g.creatorFeeBasisPoints),
      migrationFeeLamports: big(g.migrationFeeLamports),
      antiSnipeSlots: big(g.antiSnipeSlots),
      antiSnipeMaxBps: big(g.antiSnipeMaxBps),
      paused: g.paused,
      buybackBasisPoints: big(g.buybackBasisPoints),
      buybackFeeRecipient: g.buybackFeeRecipient,
      holderRewardAuthority: g.holderRewardAuthority,
      mayhemModeEnabled: g.mayhemModeEnabled,
    };
  }

  decodeBondingCurve(data: Buffer): BondingCurveState {
    const b = this.curve.coder.accounts.decode("bondingCurve", data);
    return {
      mint: b.mint,
      creator: b.creator,
      virtualTokenReserves: big(b.virtualTokenReserves),
      virtualSolReserves: big(b.virtualSolReserves),
      realTokenReserves: big(b.realTokenReserves),
      realSolReserves: big(b.realSolReserves),
      tokenTotalSupply: big(b.tokenTotalSupply),
      complete: b.complete,
      migrated: b.migrated,
      createdSlot: big(b.createdSlot),
      creatorFeesTotal: big(b.creatorFeesTotal),
      protocolFeesTotal: big(b.protocolFeesTotal),
      quoteMint: b.quoteMint,
      isHolderReward: b.isHolderReward,
    };
  }

  async fetchBondingCurve(mint: PublicKey): Promise<BondingCurveState | null> {
    const info = await this.connection.getAccountInfo(pda.bondingCurve(mint), "confirmed");
    return info ? this.decodeBondingCurve(info.data) : null;
  }

  async fetchAllBondingCurves(): Promise<BondingCurveState[]> {
    const accts = await this.curve.account.bondingCurve.all();
    return accts.map((a) => this.decodeBondingCurve(this.curve.coder.accounts.encode("bondingCurve", a.account) as any));
  }

  decodePool(address: PublicKey, data: Buffer): PoolState {
    const p = this.amm.coder.accounts.decode("pool", data);
    return {
      address,
      creator: p.creator,
      baseMint: p.baseMint,
      quoteMint: p.quoteMint,
      lpMint: p.lpMint,
      poolBaseTokenAccount: p.poolBaseTokenAccount,
      poolQuoteTokenAccount: p.poolQuoteTokenAccount,
      lpSupply: big(p.lpSupply),
      coinCreator: p.coinCreator,
      protocolFees: big(p.protocolFees),
      creatorFees: big(p.creatorFees),
    };
  }

  async fetchPool(mint: PublicKey, quoteMint: PublicKey = WSOL_MINT): Promise<PoolState | null> {
    const addr = quoteMint.equals(WSOL_MINT) ? pda.migrationPool(mint) : pda.migrationPoolV2(mint, quoteMint);
    const info = await this.connection.getAccountInfo(addr, "confirmed");
    return info ? this.decodePool(addr, info.data) : null;
  }

  async fetchPoolReserves(pool: PoolState) {
    const [b, q] = await this.connection.getMultipleAccountsInfo([pool.poolBaseTokenAccount, pool.poolQuoteTokenAccount], "confirmed");
    const amount = (info: any) => (info ? info.data.readBigUInt64LE(64) : 0n);
    return { baseReserve: amount(b), quoteReserve: amount(q) };
  }

  async fetchAmmConfig(): Promise<AmmConfigState> {
    const c = await this.amm.account.globalConfig.fetch(pda.ammGlobalConfig());
    return {
      admin: c.admin,
      lpFeeBasisPoints: big(c.lpFeeBasisPoints),
      protocolFeeBasisPoints: big(c.protocolFeeBasisPoints),
      coinCreatorFeeBasisPoints: big(c.coinCreatorFeeBasisPoints),
      protocolFeeRecipient: c.protocolFeeRecipient,
      disableFlags: c.disableFlags,
    };
  }

  /** Claimable quote tokens for a creator on a custom pair: curve vault ATA + AMM vault ATA. */
  async creatorClaimableQuote(creator: PublicKey, quoteMint: PublicKey) {
    const [a, b] = await this.connection.getMultipleAccountsInfo([pda.creatorVaultQuote(creator, quoteMint), pda.ammCreatorVaultAta(creator, quoteMint)], "confirmed");
    const amt = (i: any) => (i ? i.data.readBigUInt64LE(64) : 0n);
    return { curve: amt(a), amm: amt(b) };
  }

  /** Lamports claimable by a creator from curve trades (vault balance above rent). */
  async creatorClaimable(creator: PublicKey) {
    const [vault, rent] = await Promise.all([
      this.connection.getBalance(pda.creatorVault(creator), "confirmed"),
      this.connection.getMinimumBalanceForRentExemption(0),
    ]);
    let ammWsol = 0n;
    const ataInfo = await this.connection.getAccountInfo(pda.ammCreatorVaultAta(creator), "confirmed");
    if (ataInfo) ammWsol = ataInfo.data.readBigUInt64LE(64);
    return { curveLamports: BigInt(Math.max(0, vault - rent)), ammWsolLamports: ammWsol };
  }

  // ------------------------------------------------------------- curve instructions

  async createIx(user: PublicKey, mint: PublicKey, name: string, symbol: string, uri: string, isHolderReward = false, creator: PublicKey = PublicKey.default, isMayhemMode = false) {
    return this.curve.methods
      .create(name, symbol, uri, isHolderReward, creator, isMayhemMode)
      .accounts({
        mint,
        mintAuthority: pda.mintAuthority(),
        bondingCurve: pda.bondingCurve(mint),
        associatedBondingCurve: pda.associatedBondingCurve(mint),
        global: pda.global(),
        mplTokenMetadata: MPL_TOKEN_METADATA_PROGRAM_ID,
        metadata: pda.metadata(mint),
        user,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      } as any)
      .instruction();
  }

  /** Token program of a coin (SPL Token or Token-2022), cached per mint. */
  private tokenPrograms = new Map<string, PublicKey>();
  async coinTokenProgram(mint: PublicKey): Promise<PublicKey> {
    const k = mint.toBase58();
    const hit = this.tokenPrograms.get(k);
    if (hit) return hit;
    const info = await this.connection.getAccountInfo(mint, "confirmed");
    const tp = info && info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    this.tokenPrograms.set(k, tp);
    return tp;
  }
  setCoinTokenProgram(mint: PublicKey, tp: PublicKey) {
    this.tokenPrograms.set(mint.toBase58(), tp);
  }

  private tradeAccounts(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, trackVolume = false, tokenProgram: PublicKey = TOKEN_PROGRAM_ID) {
    return {
      globalVolumeAccumulator: trackVolume ? pda.globalVolumeAccumulator() : null,
      userVolumeAccumulator: trackVolume ? pda.userVolumeAccumulator(user) : null,
      feeConfig: this.feeConfigEnabled ? pda.feeConfig() : null,
      buybackFeeRecipient: this.buybackRecipient,
      global: pda.global(),
      feeRecipient,
      mint,
      bondingCurve: pda.bondingCurve(mint),
      associatedBondingCurve: getAssociatedTokenAddressSync(mint, pda.bondingCurve(mint), true, tokenProgram),
      associatedUser: getAssociatedTokenAddressSync(mint, user, false, tokenProgram),
      user,
      creatorVault: pda.creatorVault(creator),
      systemProgram: SystemProgram.programId,
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as any;
  }

  async buyIx(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, tokensOut: bigint, maxSolCost: bigint, trackVolume = false) {
    const tp = await this.coinTokenProgram(mint);
    return this.curve.methods.buy(bn(tokensOut), bn(maxSolCost)).accounts(this.tradeAccounts(user, mint, creator, feeRecipient, trackVolume, tp)).instruction();
  }

  async buyExactSolIx(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, solIn: bigint, minTokensOut: bigint, trackVolume = false) {
    const tp = await this.coinTokenProgram(mint);
    return this.curve.methods
      .buyExactSolIn(bn(solIn), bn(minTokensOut))
      .accounts(this.tradeAccounts(user, mint, creator, feeRecipient, trackVolume, tp))
      .instruction();
  }

  async sellIx(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, tokensIn: bigint, minSolOut: bigint) {
    const tp = await this.coinTokenProgram(mint);
    return this.curve.methods.sell(bn(tokensIn), bn(minSolOut)).accounts(this.tradeAccounts(user, mint, creator, feeRecipient, false, tp)).instruction();
  }

  /** Token-2022 coin with on-mint metadata (no Metaplex account). */
  async createV3Ix(user: PublicKey, mint: PublicKey, name: string, symbol: string, uri: string, isHolderReward = false, creator: PublicKey = PublicKey.default, isMayhemMode = false) {
    this.setCoinTokenProgram(mint, TOKEN_2022_PROGRAM_ID);
    return this.curve.methods
      .createV3(name, symbol, uri, isHolderReward, creator, isMayhemMode)
      .accounts({
        mint, mintAuthority: pda.mintAuthority(), bondingCurve: pda.bondingCurve(mint),
        associatedBondingCurve: getAssociatedTokenAddressSync(mint, pda.bondingCurve(mint), true, TOKEN_2022_PROGRAM_ID),
        global: pda.global(), user, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      } as any)
      .instruction();
  }

  async collectCreatorFeeIx(creator: PublicKey) {
    return this.curve.methods
      .collectCreatorFee()
      .accounts({ creator, creatorVault: pda.creatorVault(creator), systemProgram: SystemProgram.programId } as any)
      .instruction();
  }

  /** Permissionless graduation. Needs ~600k CU; the budget ix is included. */
  async migrateIxs(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey): Promise<TransactionInstruction[]> {
    const bondingCurve = pda.bondingCurve(mint);
    const pool = pda.migrationPool(mint);
    const lpMint = pda.lpMint(pool);
    const tp = await this.coinTokenProgram(mint);
    const ix = await this.curve.methods
      .migrate()
      .accounts({
        global: pda.global(),
        feeRecipient,
        mint,
        bondingCurve,
        associatedBondingCurve: getAssociatedTokenAddressSync(mint, bondingCurve, true, tp),
        baseTokenProgram: tp,
        bondingCurveWsol: getAssociatedTokenAddressSync(WSOL_MINT, bondingCurve, true),
        bondingCurveLp: getAssociatedTokenAddressSync(lpMint, bondingCurve, true),
        user,
        wsolMint: WSOL_MINT,
        ammProgram: AMM_PROGRAM_ID,
        ammGlobalConfig: pda.ammGlobalConfig(),
        pool,
        lpMint,
        lockedLpTokenAccount: pda.lockedLp(pool),
        poolBaseTokenAccount: getAssociatedTokenAddressSync(mint, pool, true, tp),
        poolQuoteTokenAccount: pda.poolQuote(pool),
        coinCreatorVaultAuthority: pda.ammCreatorVaultAuthority(creator),
        coinCreatorVaultAta: pda.ammCreatorVaultAta(creator),
        ammEventAuthority: pda.ammEventAuthority(),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      } as any)
      .instruction();
    return [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix];
  }

  // ------------------------------------------------------------- AMM instructions (quote = WSOL)

  private swapAccounts(user: PublicKey, mint: PublicKey, pool: PoolState, protocolFeeRecipient: PublicKey, baseTokenProgram: PublicKey = TOKEN_PROGRAM_ID) {
    const q = pool.quoteMint;
    return {
      feeConfig: this.feeConfigEnabled ? pda.feeConfig() : null,
      pool: pool.address,
      user,
      globalConfig: pda.ammGlobalConfig(),
      baseMint: mint,
      quoteMint: q,
      userBaseTokenAccount: getAssociatedTokenAddressSync(mint, user, false, baseTokenProgram),
      userQuoteTokenAccount: getAssociatedTokenAddressSync(q, user),
      poolBaseTokenAccount: pool.poolBaseTokenAccount,
      poolQuoteTokenAccount: pool.poolQuoteTokenAccount,
      protocolFeeRecipient,
      protocolFeeRecipientTokenAccount: getAssociatedTokenAddressSync(q, protocolFeeRecipient, true),
      coinCreatorVaultAuthority: pda.ammCreatorVaultAuthority(pool.coinCreator),
      coinCreatorVaultAta: pda.ammCreatorVaultAta(pool.coinCreator, q),
      baseTokenProgram,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any;
  }

  /** Wrap `lamports` SOL into the user's WSOL ATA (creates it if needed). */
  wrapSolIxs(user: PublicKey, lamports: bigint): TransactionInstruction[] {
    const ata = getAssociatedTokenAddressSync(WSOL_MINT, user);
    return [
      createAssociatedTokenAccountIdempotentInstruction(user, ata, user, WSOL_MINT),
      SystemProgram.transfer({ fromPubkey: user, toPubkey: ata, lamports: Number(lamports) }),
      createSyncNativeInstruction(ata),
    ];
  }

  /** Close the user's WSOL ATA, returning all SOL to the wallet. */
  unwrapSolIx(user: PublicKey): TransactionInstruction {
    return createCloseAccountInstruction(getAssociatedTokenAddressSync(WSOL_MINT, user), user, user);
  }

  /** Buy on the AMM. WSOL pools: wrap -> buy -> unwrap in one tx. Custom quote: pay from the user's quote ATA. */
  async ammBuyIxs(user: PublicKey, mint: PublicKey, pool: PoolState, protocolFeeRecipient: PublicKey, baseOut: bigint, maxQuoteIn: bigint) {
    const buy = await this.amm.methods.buy(bn(baseOut), bn(maxQuoteIn)).accounts(this.swapAccounts(user, mint, pool, protocolFeeRecipient, await this.coinTokenProgram(mint))).instruction();
    if (!pool.quoteMint.equals(WSOL_MINT)) return [buy];
    return [...this.wrapSolIxs(user, maxQuoteIn), buy, this.unwrapSolIx(user)];
  }

  async ammSellIxs(user: PublicKey, mint: PublicKey, pool: PoolState, protocolFeeRecipient: PublicKey, baseIn: bigint, minQuoteOut: bigint) {
    const q = pool.quoteMint;
    const ata = getAssociatedTokenAddressSync(q, user);
    const sell = await this.amm.methods.sell(bn(baseIn), bn(minQuoteOut)).accounts(this.swapAccounts(user, mint, pool, protocolFeeRecipient, await this.coinTokenProgram(mint))).instruction();
    const ensure = createAssociatedTokenAccountIdempotentInstruction(user, ata, user, q);
    if (!q.equals(WSOL_MINT)) return [ensure, sell];
    return [ensure, sell, this.unwrapSolIx(user)];
  }

  async ammCollectCreatorFeeIxs(creator: PublicKey, quoteMint: PublicKey = WSOL_MINT) {
    const ix = await this.amm.methods
      .collectCoinCreatorFee()
      .accounts({
        coinCreator: creator,
        quoteMint,
        coinCreatorVaultAuthority: pda.ammCreatorVaultAuthority(creator),
        coinCreatorVaultAta: pda.ammCreatorVaultAta(creator, quoteMint),
        coinCreatorTokenAccount: getAssociatedTokenAddressSync(quoteMint, creator),
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
    return quoteMint.equals(WSOL_MINT) ? [ix, this.unwrapSolIx(creator)] : [ix];
  }

  // ------------------------------------------------------------- custom pairs (v2)

  async fetchQuoteConfig(quoteMint: PublicKey) {
    const info = await this.connection.getAccountInfo(pda.quoteConfig(quoteMint), "confirmed");
    if (!info) return null;
    const q = this.curve.coder.accounts.decode("quoteConfig", info.data);
    return {
      quoteMint: q.quoteMint as PublicKey,
      enabled: q.enabled as boolean,
      initialVirtualQuoteReserves: big(q.initialVirtualQuoteReserves),
      initialVirtualTokenReserves: big(q.initialVirtualTokenReserves),
      initialRealTokenReserves: big(q.initialRealTokenReserves),
      migrationFee: big(q.migrationFee),
      decimals: q.decimals as number,
    };
  }

  async setQuoteConfigIx(authority: PublicKey, quoteMint: PublicKey, params: Record<string, any>) {
    const p: any = {};
    for (const [k, v] of Object.entries(params)) p[k] = typeof v === "bigint" ? bn(v) : v;
    return this.curve.methods.setQuoteConfig(p).accounts({ authority, global: pda.global(), quoteMint, quoteConfig: pda.quoteConfig(quoteMint), systemProgram: SystemProgram.programId } as any).instruction();
  }

  async createV2Ix(user: PublicKey, mint: PublicKey, quoteMint: PublicKey, name: string, symbol: string, uri: string, isHolderReward = false, creator: PublicKey = PublicKey.default, quoteTokenProgram = TOKEN_PROGRAM_ID) {
    return this.curve.methods
      .createV2(name, symbol, uri, isHolderReward, creator)
      .accounts({
        mint,
        mintAuthority: pda.mintAuthority(),
        bondingCurve: pda.bondingCurve(mint),
        associatedBondingCurve: pda.associatedBondingCurve(mint),
        quoteMint,
        quoteConfig: pda.quoteConfig(quoteMint),
        bondingCurveQuote: pda.bondingCurveQuote(mint, quoteMint, quoteTokenProgram),
        global: pda.global(),
        mplTokenMetadata: MPL_TOKEN_METADATA_PROGRAM_ID,
        metadata: pda.metadata(mint),
        user,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        quoteTokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      } as any)
      .instruction();
  }

  private tradeV2Accounts(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, quoteMint: PublicKey, quoteTokenProgram: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID) {
    return {
      feeConfig: this.feeConfigEnabled ? pda.feeConfig() : null,
      global: pda.global(),
      feeRecipient,
      mint,
      bondingCurve: pda.bondingCurve(mint),
      associatedBondingCurve: getAssociatedTokenAddressSync(mint, pda.bondingCurve(mint), true, tokenProgram),
      associatedUser: getAssociatedTokenAddressSync(mint, user, false, tokenProgram),
      user,
      quoteMint,
      userQuote: getAssociatedTokenAddressSync(quoteMint, user, false, quoteTokenProgram),
      bondingCurveQuote: pda.bondingCurveQuote(mint, quoteMint, quoteTokenProgram),
      feeRecipientQuote: getAssociatedTokenAddressSync(quoteMint, feeRecipient, true, quoteTokenProgram),
      creatorVault: pda.creatorVault(creator),
      creatorVaultQuote: pda.creatorVaultQuote(creator, quoteMint, quoteTokenProgram),
      systemProgram: SystemProgram.programId,
      tokenProgram,
      quoteTokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as any;
  }

  async buyV2Ix(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, quoteMint: PublicKey, tokensOut: bigint, maxQuoteCost: bigint, quoteTokenProgram = TOKEN_PROGRAM_ID) {
    return this.curve.methods.buyV2(bn(tokensOut), bn(maxQuoteCost)).accounts(this.tradeV2Accounts(user, mint, creator, feeRecipient, quoteMint, quoteTokenProgram)).instruction();
  }
  async buyExactQuoteInIx(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, quoteMint: PublicKey, quoteIn: bigint, minTokensOut: bigint, quoteTokenProgram = TOKEN_PROGRAM_ID) {
    return this.curve.methods.buyExactQuoteIn(bn(quoteIn), bn(minTokensOut)).accounts(this.tradeV2Accounts(user, mint, creator, feeRecipient, quoteMint, quoteTokenProgram)).instruction();
  }
  async sellV2Ix(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, quoteMint: PublicKey, tokensIn: bigint, minQuoteOut: bigint, quoteTokenProgram = TOKEN_PROGRAM_ID) {
    return this.curve.methods.sellV2(bn(tokensIn), bn(minQuoteOut)).accounts(this.tradeV2Accounts(user, mint, creator, feeRecipient, quoteMint, quoteTokenProgram)).instruction();
  }
  async collectCreatorFeeV2Ix(creator: PublicKey, quoteMint: PublicKey, quoteTokenProgram = TOKEN_PROGRAM_ID, payer: PublicKey = creator) {
    return this.curve.methods
      .collectCreatorFeeV2()
      .accounts({
        payer,
        creator,
        quoteMint,
        creatorVault: pda.creatorVault(creator),
        creatorVaultQuote: pda.creatorVaultQuote(creator, quoteMint, quoteTokenProgram),
        creatorQuote: getAssociatedTokenAddressSync(quoteMint, creator, false, quoteTokenProgram),
        quoteTokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
  }
  async migrateV2Ixs(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, quoteMint: PublicKey, quoteTokenProgram = TOKEN_PROGRAM_ID): Promise<TransactionInstruction[]> {
    const bondingCurve = pda.bondingCurve(mint);
    const pool = pda.migrationPoolV2(mint, quoteMint);
    const lpMint = pda.lpMint(pool);
    const ix = await this.curve.methods
      .migrateV2()
      .accounts({
        global: pda.global(),
        feeRecipient,
        feeRecipientQuote: getAssociatedTokenAddressSync(quoteMint, feeRecipient, true, quoteTokenProgram),
        mint,
        bondingCurve,
        associatedBondingCurve: getAssociatedTokenAddressSync(mint, bondingCurve, true, await this.coinTokenProgram(mint)),
        baseTokenProgram: await this.coinTokenProgram(mint),
        bondingCurveQuote: pda.bondingCurveQuote(mint, quoteMint, quoteTokenProgram),
        bondingCurveLp: getAssociatedTokenAddressSync(lpMint, bondingCurve, true),
        user,
        quoteMint,
        quoteConfig: pda.quoteConfig(quoteMint),
        ammProgram: AMM_PROGRAM_ID,
        ammGlobalConfig: pda.ammGlobalConfig(),
        pool,
        lpMint,
        lockedLpTokenAccount: pda.lockedLp(pool),
        poolBaseTokenAccount: getAssociatedTokenAddressSync(mint, pool, true, await this.coinTokenProgram(mint)),
        poolQuoteTokenAccount: getAssociatedTokenAddressSync(quoteMint, pool, true, quoteTokenProgram),
        coinCreatorVaultAuthority: pda.ammCreatorVaultAuthority(creator),
        coinCreatorVaultAta: pda.ammCreatorVaultAta(creator, quoteMint),
        ammEventAuthority: pda.ammEventAuthority(),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        quoteTokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      } as any)
      .instruction();
    return [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix];
  }

  // ------------------------------------------------------------- volume incentives

  async fetchIncentives() {
    const info = await this.connection.getAccountInfo(pda.globalVolumeAccumulator(), "confirmed");
    if (!info) return null;
    const g = this.curve.coder.accounts.decode("globalVolumeAccumulator", info.data);
    return {
      startTime: Number(g.startTime), endTime: Number(g.endTime), secondsInADay: Number(g.secondsInADay), mint: g.mint as PublicKey,
      totalTokenSupply: (g.totalTokenSupply as any[]).map((x) => big(x)), solVolumes: (g.solVolumes as any[]).map((x) => big(x)),
    };
  }

  async fetchUserVolume(user: PublicKey) {
    const info = await this.connection.getAccountInfo(pda.userVolumeAccumulator(user), "confirmed");
    if (!info) return null;
    const u = this.curve.coder.accounts.decode("userVolumeAccumulator", info.data);
    return { needsClaim: u.needsClaim as boolean, totalUnclaimedTokens: big(u.totalUnclaimedTokens), totalClaimedTokens: big(u.totalClaimedTokens), currentSolVolume: big(u.currentSolVolume), lastUpdateTimestamp: Number(u.lastUpdateTimestamp) };
  }

  async initUserVolumeIx(payer: PublicKey, user: PublicKey = payer) {
    return this.curve.methods.initUserVolumeAccumulator().accounts({ payer, user, userVolumeAccumulator: pda.userVolumeAccumulator(user), systemProgram: SystemProgram.programId } as any).instruction();
  }

  async claimIncentivesIx(payer: PublicKey, user: PublicKey, incentiveMint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) {
    const gva = pda.globalVolumeAccumulator();
    return this.curve.methods
      .claimTokenIncentives()
      .accounts({
        user, payer, globalVolumeAccumulator: gva, globalIncentiveTokenAccount: getAssociatedTokenAddressSync(incentiveMint, gva, true, tokenProgram),
        userVolumeAccumulator: pda.userVolumeAccumulator(user), mint: incentiveMint, userAta: getAssociatedTokenAddressSync(incentiveMint, user, true, tokenProgram),
        tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
  }

  async adminUpdateIncentivesIx(authority: PublicKey, incentiveMint: PublicKey, p: { startTime: number; endTime: number; secondsInADay: number; dayNumber: number; tokenSupplyPerDay: bigint }, tokenProgram = TOKEN_PROGRAM_ID) {
    const gva = pda.globalVolumeAccumulator();
    return this.curve.methods
      .adminUpdateTokenIncentives(bn(p.startTime), bn(p.endTime), bn(p.secondsInADay), bn(p.dayNumber), bn(p.tokenSupplyPerDay))
      .accounts({ authority, global: pda.global(), globalVolumeAccumulator: gva, mint: incentiveMint, globalIncentiveTokenAccount: getAssociatedTokenAddressSync(incentiveMint, gva, true, tokenProgram), tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
      .instruction();
  }

  // ------------------------------------------------------------- holder rewards

  /** Undistributed holder rewards (lamports above rent for SOL curves; quote units for pairs). */
  async holderPot(mint: PublicKey, quoteMint: PublicKey = WSOL_MINT) {
    if (quoteMint.equals(WSOL_MINT)) {
      const [bal, rent] = await Promise.all([this.connection.getBalance(pda.holderVault(mint), "confirmed"), this.connection.getMinimumBalanceForRentExemption(0)]);
      return BigInt(Math.max(0, bal - rent));
    }
    const info = await this.connection.getAccountInfo(pda.creatorVaultQuote(pda.holderRewards(mint), quoteMint), "confirmed");
    return info ? info.data.readBigUInt64LE(64) : 0n;
  }

  /** Authority-only: pay `amounts[i]` to `recipients[i]` from the coin's holder vault. */
  async distributeToHoldersIx(authority: PublicKey, mint: PublicKey, recipients: PublicKey[], amounts: bigint[], quoteMint: PublicKey = WSOL_MINT, quoteTokenProgram = TOKEN_PROGRAM_ID) {
    const holderRewards = pda.holderRewards(mint);
    if (quoteMint.equals(WSOL_MINT)) {
      return this.curve.methods
        .distributeFeeToHolders(amounts.map(bn))
        .accounts({ global: pda.global(), holderRewardAuthority: authority, mint, bondingCurve: pda.bondingCurve(mint), holderRewards, creatorVault: pda.creatorVault(holderRewards), systemProgram: SystemProgram.programId } as any)
        .remainingAccounts(recipients.map((r) => ({ pubkey: r, isSigner: false, isWritable: true })))
        .instruction();
    }
    const remaining = recipients.flatMap((r) => [
      { pubkey: r, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(quoteMint, r, true, quoteTokenProgram), isSigner: false, isWritable: true },
    ]);
    return this.curve.methods
      .distributeFeeToHoldersV2(amounts.map(bn))
      .accounts({
        global: pda.global(), holderRewardAuthority: authority, authority, mint, bondingCurve: pda.bondingCurve(mint), holderRewards,
        creatorVault: pda.creatorVault(holderRewards), creatorVaultQuote: pda.creatorVaultQuote(holderRewards, quoteMint, quoteTokenProgram), quoteMint,
        quoteTokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts(remaining)
      .instruction();
  }

  // ------------------------------------------------------------- fees program

  async fetchFeeConfig() {
    const info = await this.connection.getAccountInfo(pda.feeConfig(), "confirmed");
    if (!info) return null;
    const c = this.fees.coder.accounts.decode("feeConfig", info.data);
    const f = (x: any) => ({ lpFeeBps: big(x.lpFeeBps), protocolFeeBps: big(x.protocolFeeBps), creatorFeeBps: big(x.creatorFeeBps) });
    const t = (x: any) => ({ marketCapLamportsThreshold: big(x.marketCapLamportsThreshold), fees: f(x.fees) });
    return { admin: c.admin as PublicKey, flatFees: f(c.flatFees), feeTiers: (c.feeTiers as any[]).map(t), stableFeeTiers: (c.stableFeeTiers as any[]).map(t), exoticFlatFees: f(c.exoticFlatFees), stableMints: (c.stableMints as PublicKey[]).map((m) => m.toBase58()) };
  }

  async fetchSharingConfig(mint: PublicKey) {
    const info = await this.connection.getAccountInfo(pda.sharingConfig(mint), "confirmed");
    if (!info) return null;
    const c = this.fees.coder.accounts.decode("sharingConfig", info.data);
    return { admin: c.admin as PublicKey, adminRevoked: c.adminRevoked as boolean, active: !!c.status.active, shareholders: (c.shareholders as any[]).map((s) => ({ address: s.address as PublicKey, shareBps: Number(s.shareBps) })) };
  }

  /** What kind of account earns this coin's creator fee. */
  async creatorKind(creator: PublicKey, mint: PublicKey): Promise<"wallet" | "holders" | "sharing" | "social" | "donation" | "unknown"> {
    if (creator.equals(pda.holderRewards(mint))) return "holders";
    const info = await this.connection.getAccountInfo(creator, "confirmed");
    if (!info) return "wallet";
    if (!info.owner.equals(FEES_PROGRAM_ID)) return info.owner.equals(new PublicKey("11111111111111111111111111111111")) ? "wallet" : "unknown";
    const disc = info.data.subarray(0, 8);
    const is = (name: string) => disc.equals(Buffer.from((FEES_IDL.accounts as any[]).find((a) => a.name === name).discriminator));
    if (is("SharingConfig")) return "sharing";
    if (is("SocialFeePda")) return "social";
    if (is("DonationFeePda")) return "donation";
    return "unknown";
  }

  async initializeFeeProgramIxs(authority: PublicKey, socialClaimAuthority: PublicKey, flatFees: any, tiers: any[], claimRateLimit = 0n) {
    const bn2 = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? bn(v) : v]));
    const tiersBn = tiers.map((t) => ({ marketCapLamportsThreshold: bn(t.marketCapLamportsThreshold), fees: bn2(t.fees) }));
    return [
      await this.fees.methods.initializeFeeProgramGlobal(socialClaimAuthority, 0, bn(claimRateLimit)).accounts({ authority } as any).instruction(),
      await this.fees.methods.initializeFeeConfig(bn2(flatFees) as any, tiersBn as any).accounts({ authority, feeProgramGlobal: pda.feeProgramGlobal(), feeConfig: pda.feeConfig() } as any).instruction(),
      await this.fees.methods.initializeBuyback(0, authority, bn(0n)).accounts({ authority, feeProgramGlobal: pda.feeProgramGlobal(), buybackVault: pda.buybackVault(0) } as any).instruction(),
    ];
  }

  async createFeeSharingConfigIx(creator: PublicKey, mint: PublicKey, graduated: boolean, quoteMint: PublicKey = WSOL_MINT) {
    const pool = graduated ? (quoteMint.equals(WSOL_MINT) ? pda.migrationPool(mint) : pda.migrationPoolV2(mint, quoteMint)) : null;
    return this.fees.methods
      .createFeeSharingConfig()
      .accounts({
        payer: creator, feeProgramGlobal: pda.feeProgramGlobal(), mint, sharingConfig: pda.sharingConfig(mint), bondingCurve: pda.bondingCurve(mint),
        curveProgram: CURVE_PROGRAM_ID, curveEventAuthority: pda.curveEventAuthority(), pool, ammProgram: graduated ? AMM_PROGRAM_ID : null, ammEventAuthority: graduated ? pda.ammEventAuthority() : null, ammGlobalConfig: graduated ? pda.ammGlobalConfig() : null,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
  }
  async updateFeeSharesIx(admin: PublicKey, mint: PublicKey, shareholders: { address: PublicKey; shareBps: number }[]) {
    const sharing = pda.sharingConfig(mint);
    return this.fees.methods.updateFeeShares(shareholders).accounts({ authority: admin, mint, sharingConfig: sharing, creatorVault: pda.creatorVault(sharing) } as any).instruction();
  }
  async revokeFeeSharingIx(admin: PublicKey, mint: PublicKey) {
    return this.fees.methods.revokeFeeSharingAuthority().accounts({ authority: admin, sharingConfig: pda.sharingConfig(mint) } as any).instruction();
  }
  /** Curve-side payout of a sharing coin's vault to its shareholders (anyone may call). */
  async distributeCreatorFeesIx(mint: PublicKey, shareholders: PublicKey[], quoteMint: PublicKey = WSOL_MINT, payer?: PublicKey) {
    const sharing = pda.sharingConfig(mint);
    if (quoteMint.equals(WSOL_MINT)) {
      return this.curve.methods
        .distributeCreatorFees()
        .accounts({ mint, bondingCurve: pda.bondingCurve(mint), sharingConfig: sharing, creatorVault: pda.creatorVault(sharing), systemProgram: SystemProgram.programId } as any)
        .remainingAccounts(shareholders.map((r) => ({ pubkey: r, isSigner: false, isWritable: true })))
        .instruction();
    }
    return this.curve.methods
      .distributeCreatorFeesV2(true)
      .accounts({ payer: payer ?? shareholders[0], mint, bondingCurve: pda.bondingCurve(mint), sharingConfig: sharing, creatorVault: pda.creatorVault(sharing), creatorVaultQuote: pda.creatorVaultQuote(sharing, quoteMint), quoteMint, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
      .remainingAccounts([...shareholders.map((r) => ({ pubkey: r, isSigner: false, isWritable: false })), ...shareholders.map((r) => ({ pubkey: getAssociatedTokenAddressSync(quoteMint, r, true), isSigner: false, isWritable: true }))])
      .instruction();
  }
  /** AMM-side payout (graduated sharing coins). */
  async distributeCoinCreatorFeesIx(payer: PublicKey, mint: PublicKey, pool: PoolState, shareholders: PublicKey[]) {
    const sharing = pda.sharingConfig(mint);
    const q = pool.quoteMint;
    return this.amm.methods
      .distributeCoinCreatorFees(true)
      .accounts({ payer, pool: pool.address, sharingConfig: sharing, quoteMint: q, coinCreatorVaultAuthority: pda.ammCreatorVaultAuthority(sharing), coinCreatorVaultAta: pda.ammCreatorVaultAta(sharing, q), quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
      .remainingAccounts([...shareholders.map((r) => ({ pubkey: r, isSigner: false, isWritable: false })), ...shareholders.map((r) => ({ pubkey: getAssociatedTokenAddressSync(q, r, true), isSigner: false, isWritable: true }))])
      .instruction();
  }

  async createSocialFeePdaIx(payer: PublicKey, userId: string, platform: number) {
    return this.fees.methods.createSocialFeePda(userId, platform).accounts({ payer, feeProgramGlobal: pda.feeProgramGlobal(), socialFeePda: pda.socialFeePda(userId, platform), systemProgram: SystemProgram.programId } as any).instruction();
  }
  async claimSocialFeePdaIx(authority: PublicKey, userId: string, platform: number, recipient: PublicKey) {
    return this.fees.methods.claimSocialFeePda(userId, platform).accounts({ socialClaimAuthority: authority, feeProgramGlobal: pda.feeProgramGlobal(), socialFeePda: pda.socialFeePda(userId, platform), recipient } as any).instruction();
  }
  async createDonationFeePdaIx(payer: PublicKey, mint: PublicKey, beneficiary: PublicKey) {
    return this.fees.methods.createDonationFeePda().accounts({ payer, feeProgramGlobal: pda.feeProgramGlobal(), baseMint: mint, beneficiary, donationFeePda: pda.donationFeePda(mint, beneficiary), systemProgram: SystemProgram.programId } as any).instruction();
  }
  async crankDonationIx(payer: PublicKey, mint: PublicKey, beneficiary: PublicKey) {
    return this.fees.methods.crankDonationFeePda().accounts({ payer, feeProgramGlobal: pda.feeProgramGlobal(), donationFeePda: pda.donationFeePda(mint, beneficiary), beneficiary } as any).instruction();
  }
  /** Sweep a creator vault to its creator address (permissionless; needed for PDA creators). */
  async collectForCreatorIx(creator: PublicKey) {
    return this.curve.methods.collectCreatorFee().accounts({ creator, creatorVault: pda.creatorVault(creator), systemProgram: SystemProgram.programId } as any).instruction();
  }
  async sweepBuybackIx(authority: PublicKey, index = 0) {
    return this.fees.methods.sweepBuyback(index).accounts({ authority, buybackVault: pda.buybackVault(index) } as any).instruction();
  }

  // ------------------------------------------------------------- mayhem

  async fetchMayhemParams() {
    const info = await this.connection.getAccountInfo(pda.mayhemGlobalParams(), "confirmed");
    if (!info) return null;
    const g = this.mayhem.coder.accounts.decode("globalParams", info.data);
    return { admin: g.admin as PublicKey, trader: g.trader as PublicKey, paused: g.paused as boolean, solDeployed: BigInt(g.solDeployed.toString()), maxSolPerSweep: big(g.maxSolPerSweep), durationSeconds: Number(g.mayhemDurationSeconds) };
  }
  async fetchMayhemState(mint: PublicKey) {
    const info = await this.connection.getAccountInfo(pda.mayhemState(mint), "confirmed");
    if (!info) return null;
    const s = this.mayhem.coder.accounts.decode("mayhemState", info.data);
    return { endTimestamp: Number(s.endTimestamp), solDeployed: BigInt(s.solDeployed.toString()), ended: !!s.status.ended, burnedAmount: big(s.burnedAmount) };
  }
  /** Register a freshly launched mayhem coin (same tx as create). */
  async mayhemInitStateIx(payer: PublicKey, mint: PublicKey) {
    return this.mayhem.methods.initState().accounts({ payer, globalParams: pda.mayhemGlobalParams(), mint, bondingCurve: pda.bondingCurve(mint), mayhemState: pda.mayhemState(mint), systemProgram: SystemProgram.programId } as any).instruction();
  }
  private async mayhemTradeAccounts(trader: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey) {
    const tp = await this.coinTokenProgram(mint);
    const vault = pda.mayhemSolVault();
    return {
      trader, globalParams: pda.mayhemGlobalParams(), mayhemState: pda.mayhemState(mint), mint, solVault: vault, mayhemTokenVault: getAssociatedTokenAddressSync(mint, vault, true, tp),
      curveProgram: CURVE_PROGRAM_ID, global: pda.global(), feeRecipient, bondingCurve: pda.bondingCurve(mint), associatedBondingCurve: getAssociatedTokenAddressSync(mint, pda.bondingCurve(mint), true, tp),
      creatorVault: pda.creatorVault(creator), feeConfig: this.feeConfigEnabled ? pda.feeConfig() : null, buybackFeeRecipient: this.buybackRecipient, curveEventAuthority: pda.curveEventAuthority(),
      tokenProgram: tp, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any;
  }
  /** reference = lamports per whole token × 1e9 (see program PRICE_SCALE). */
  async mayhemBuyIx(trader: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, solAmount: bigint, reference: bigint, toleranceBps: number) {
    return this.mayhem.methods.buy(bn(solAmount), bn(reference), toleranceBps).accounts(await this.mayhemTradeAccounts(trader, mint, creator, feeRecipient)).instruction();
  }
  async mayhemSellIx(trader: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, tokenAmount: bigint, reference: bigint, toleranceBps: number, retainedReserveBps: number) {
    return this.mayhem.methods.sell(bn(tokenAmount), bn(reference), toleranceBps, retainedReserveBps).accounts(await this.mayhemTradeAccounts(trader, mint, creator, feeRecipient)).instruction();
  }
  async mayhemBurnIx(mint: PublicKey) {
    const tp = await this.coinTokenProgram(mint);
    const vault = pda.mayhemSolVault();
    return this.mayhem.methods.burnTokens().accounts({ mayhemState: pda.mayhemState(mint), mint, mayhemTokenVault: getAssociatedTokenAddressSync(mint, vault, true, tp), solVault: vault, tokenProgram: tp } as any).instruction();
  }
  /** Spot price in the mayhem reference scale. */
  static mayhemReference(c: CurveState) {
    return (c.virtualSolReserves * 1_000_000_000n * 1_000_000n) / c.virtualTokenReserves;
  }

  // ------------------------------------------------------------- multi-hop

  /** One instruction routing through AMM pools: input ATA -> pools... -> output ATA. */
  async multiHopIx(user: PublicKey, inputMint: PublicKey, outputMint: PublicKey, pools: PoolState[], amountIn: bigint, minAmountOut: bigint, protocolFeeRecipient: PublicKey) {
    const inTp = await this.coinTokenProgram(inputMint);
    const outTp = await this.coinTokenProgram(outputMint);
    const remaining = [];
    for (const p of pools) {
      const qTp = await this.coinTokenProgram(p.quoteMint);
      remaining.push(
        { pubkey: p.address, isSigner: false, isWritable: true },
        { pubkey: p.poolBaseTokenAccount, isSigner: false, isWritable: true },
        { pubkey: p.poolQuoteTokenAccount, isSigner: false, isWritable: true },
        { pubkey: p.baseMint, isSigner: false, isWritable: false },
        { pubkey: p.quoteMint, isSigner: false, isWritable: false },
        { pubkey: getAssociatedTokenAddressSync(p.quoteMint, protocolFeeRecipient, true, qTp), isSigner: false, isWritable: true },
        { pubkey: pda.ammCreatorVaultAta(p.coinCreator, p.quoteMint), isSigner: false, isWritable: true }
      );
    }
    return this.amm.methods
      .multiHopSwap(bn(amountIn), bn(minAmountOut))
      .accounts({
        user, userInTokenAccount: getAssociatedTokenAddressSync(inputMint, user, false, inTp), userOutTokenAccount: getAssociatedTokenAddressSync(outputMint, user, false, outTp),
        globalConfig: pda.ammGlobalConfig(), feeConfig: this.feeConfigEnabled ? pda.feeConfig() : null, tokenProgram: TOKEN_PROGRAM_ID, tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      } as any)
      .remainingAccounts(remaining)
      .instruction();
  }

  /**
   * Coin A -> coin B (both SOL-quoted) in one transaction. Graduated legs go through the on-chain
   * router; curve legs are composed (sell A on its curve, buy B with the proceeds), since the
   * curve pays SOL straight to the wallet. Returns the instructions + the expected output.
   */
  async routeIxs(user: PublicKey, a: { mint: PublicKey; creator: PublicKey; pool: PoolState | null; curve: CurveState | null }, b: { mint: PublicKey; creator: PublicKey; pool: PoolState | null; curve: CurveState | null }, amountIn: bigint, slippageBps: bigint, feeRecipient: PublicKey, protocolFeeRecipient: PublicKey, fees: { feeBasisPoints: bigint; creatorFeeBasisPoints: bigint }, ammFees: { lpFeeBasisPoints: bigint; protocolFeeBasisPoints: bigint; coinCreatorFeeBasisPoints: bigint }) {
    const { amm: ammMath, curve: curveMath } = await import("./math");
    const ixs: TransactionInstruction[] = [];
    if (a.pool && b.pool) {
      // both graduated: single on-chain route A -> WSOL -> B
      const ra = await this.fetchPoolReserves(a.pool);
      const qa = ammMath.quoteSell(amountIn, ra.baseReserve, ra.quoteReserve, ammFees);
      const rb = await this.fetchPoolReserves(b.pool);
      const qb = ammMath.quoteBuyWithBudget(qa.userOut, rb.baseReserve, rb.quoteReserve, ammFees);
      const minOut = (qb.baseOut * (10000n - slippageBps)) / 10000n;
      const outAta = getAssociatedTokenAddressSync(b.mint, user, false, await this.coinTokenProgram(b.mint));
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(user, outAta, user, b.mint, await this.coinTokenProgram(b.mint)));
      ixs.push(await this.multiHopIx(user, a.mint, b.mint, [a.pool, b.pool], amountIn, minOut, protocolFeeRecipient));
      return { ixs, expectedOut: qb.baseOut };
    }
    // sell leg -> SOL in wallet
    let solOut: bigint;
    if (a.pool) {
      const ra = await this.fetchPoolReserves(a.pool);
      const q = ammMath.quoteSell(amountIn, ra.baseReserve, ra.quoteReserve, ammFees);
      solOut = (q.userOut * (10000n - slippageBps)) / 10000n;
      ixs.push(...(await this.ammSellIxs(user, a.mint, a.pool, protocolFeeRecipient, amountIn, solOut)));
    } else {
      const q = curveMath.quoteSell(amountIn, a.curve!, fees);
      solOut = (q.userOut * (10000n - slippageBps)) / 10000n;
      ixs.push(await this.sellIx(user, a.mint, a.creator, feeRecipient, amountIn, solOut));
    }
    // buy leg with the guaranteed minimum proceeds
    let expectedOut: bigint;
    if (b.pool) {
      const rb = await this.fetchPoolReserves(b.pool);
      const q = ammMath.quoteBuyWithBudget(solOut, rb.baseReserve, rb.quoteReserve, ammFees);
      expectedOut = q.baseOut;
      ixs.push(...(await this.ammBuyIxs(user, b.mint, b.pool, protocolFeeRecipient, (q.baseOut * (10000n - slippageBps)) / 10000n, solOut)));
    } else {
      const q = curveMath.quoteBuyExactSol(solOut, b.curve!, fees);
      expectedOut = q.tokensOut;
      // spend the sell proceeds net of fees so the buy never exceeds what the sell produced
      const spend = (solOut * 10000n) / (10000n + fees.feeBasisPoints + fees.creatorFeeBasisPoints);
      ixs.push(await this.buyExactSolIx(user, b.mint, b.creator, feeRecipient, spend, (q.tokensOut * (10000n - slippageBps)) / 10000n));
    }
    return { ixs, expectedOut };
  }

  // ------------------------------------------------------------- creator management (CTO / creator fee)

  async adminCtoIx(authority: PublicKey, mint: PublicKey, currentCreator: PublicKey, opts: { toHolders?: boolean; newCreator?: PublicKey; creatorFeeBps?: bigint }) {
    const hr = pda.holderRewards(mint);
    return this.curve.methods
      .adminCto(!!opts.toHolders, opts.creatorFeeBps != null ? bn(opts.creatorFeeBps) : null, opts.newCreator ?? null)
      .accounts({ authority, global: pda.global(), mint, bondingCurve: pda.bondingCurve(mint), oldCreatorVault: pda.creatorVault(currentCreator), holderRewards: hr, holderCreatorVault: pda.creatorVault(hr), systemProgram: SystemProgram.programId } as any)
      .instruction();
  }
  async setCreatorFeeBpsIx(creator: PublicKey, mint: PublicKey, bps: bigint, lock = false) {
    return this.curve.methods.setCreatorFeeBps(bn(bps), lock).accounts({ creator, global: pda.global(), mint, bondingCurve: pda.bondingCurve(mint) } as any).instruction();
  }
  async setCreatorIx(creator: PublicKey, mint: PublicKey, newCreator: PublicKey) {
    return this.curve.methods.setCreator(newCreator).accounts({ creator, mint, bondingCurve: pda.bondingCurve(mint) } as any).instruction();
  }
  async ammAdminCtoPoolIx(authority: PublicKey, pool: PublicKey, coinCreator: PublicKey, toHolders: boolean, creatorFeeBps?: bigint) {
    return this.amm.methods.adminCtoPool(coinCreator, toHolders, creatorFeeBps != null ? bn(creatorFeeBps) : null).accounts({ authority, globalConfig: pda.ammGlobalConfig(), pool } as any).instruction();
  }
  async ammSetCoinCreatorFeeBpsIx(coinCreator: PublicKey, pool: PublicKey, bps: bigint, lock = false) {
    return this.amm.methods.setCoinCreatorFeeBps(bn(bps), lock).accounts({ coinCreator, pool, globalConfig: pda.ammGlobalConfig() } as any).instruction();
  }

  // ------------------------------------------------------------- admin

  async initializeIx(authority: PublicKey, params: Record<string, any>) {
    const p: any = {};
    for (const [k, v] of Object.entries(params)) p[k] = typeof v === "bigint" ? bn(v) : v;
    return this.curve.methods.initialize(p).accounts({ authority } as any).instruction();
  }

  async setParamsIx(authority: PublicKey, params: Record<string, any>) {
    const p: any = {};
    for (const [k, v] of Object.entries(params)) p[k] = typeof v === "bigint" ? bn(v) : v;
    return this.curve.methods.setParams(p).accounts({ authority, global: pda.global() } as any).instruction();
  }

  async createAmmConfigIx(admin: PublicKey, lp: bigint, protocol: bigint, creator: bigint, recipient: PublicKey) {
    return this.amm.methods.createConfig(bn(lp), bn(protocol), bn(creator), recipient).accounts({ admin } as any).instruction();
  }
}

export { CURVE_PROGRAM_ID, AMM_PROGRAM_ID };
