import { AnchorProvider, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
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
import { AMM_IDL, AMM_PROGRAM_ID, CURVE_IDL, CURVE_PROGRAM_ID, MPL_TOKEN_METADATA_PROGRAM_ID, WSOL_MINT } from "./ids";
import { pda } from "./pda";
import type { PeoplepadAmm } from "./peoplepad_amm";
import type { PeoplepadCurve } from "./peoplepad_curve";
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
}

export interface BondingCurveState extends CurveState {
  mint: PublicKey;
  creator: PublicKey;
  migrated: boolean;
  createdSlot: bigint;
  creatorFeesTotal: bigint;
  protocolFeesTotal: bigint;
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

export class PeoplepadClient {
  readonly curve: Program<PeoplepadCurve>;
  readonly amm: Program<PeoplepadAmm>;

  constructor(readonly connection: Connection, provider: AnchorProvider = readOnlyProvider(connection)) {
    this.curve = new Program<PeoplepadCurve>(CURVE_IDL, provider);
    this.amm = new Program<PeoplepadAmm>(AMM_IDL, provider);
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

  async fetchPool(mint: PublicKey): Promise<PoolState | null> {
    const addr = pda.migrationPool(mint);
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

  async createIx(user: PublicKey, mint: PublicKey, name: string, symbol: string, uri: string) {
    return this.curve.methods
      .create(name, symbol, uri)
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

  private tradeAccounts(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey) {
    return {
      global: pda.global(),
      feeRecipient,
      mint,
      bondingCurve: pda.bondingCurve(mint),
      associatedBondingCurve: pda.associatedBondingCurve(mint),
      associatedUser: getAssociatedTokenAddressSync(mint, user),
      user,
      creatorVault: pda.creatorVault(creator),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as any;
  }

  async buyIx(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, tokensOut: bigint, maxSolCost: bigint) {
    return this.curve.methods.buy(bn(tokensOut), bn(maxSolCost)).accounts(this.tradeAccounts(user, mint, creator, feeRecipient)).instruction();
  }

  async buyExactSolIx(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, solIn: bigint, minTokensOut: bigint) {
    return this.curve.methods
      .buyExactSolIn(bn(solIn), bn(minTokensOut))
      .accounts(this.tradeAccounts(user, mint, creator, feeRecipient))
      .instruction();
  }

  async sellIx(user: PublicKey, mint: PublicKey, creator: PublicKey, feeRecipient: PublicKey, tokensIn: bigint, minSolOut: bigint) {
    return this.curve.methods.sell(bn(tokensIn), bn(minSolOut)).accounts(this.tradeAccounts(user, mint, creator, feeRecipient)).instruction();
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
    const ix = await this.curve.methods
      .migrate()
      .accounts({
        global: pda.global(),
        feeRecipient,
        mint,
        bondingCurve,
        associatedBondingCurve: pda.associatedBondingCurve(mint),
        bondingCurveWsol: getAssociatedTokenAddressSync(WSOL_MINT, bondingCurve, true),
        bondingCurveLp: getAssociatedTokenAddressSync(lpMint, bondingCurve, true),
        user,
        wsolMint: WSOL_MINT,
        ammProgram: AMM_PROGRAM_ID,
        ammGlobalConfig: pda.ammGlobalConfig(),
        pool,
        lpMint,
        lockedLpTokenAccount: pda.lockedLp(pool),
        poolBaseTokenAccount: pda.poolBase(pool, mint),
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

  private swapAccounts(user: PublicKey, mint: PublicKey, pool: PoolState, protocolFeeRecipient: PublicKey) {
    return {
      pool: pool.address,
      user,
      globalConfig: pda.ammGlobalConfig(),
      baseMint: mint,
      quoteMint: WSOL_MINT,
      userBaseTokenAccount: getAssociatedTokenAddressSync(mint, user),
      userQuoteTokenAccount: getAssociatedTokenAddressSync(WSOL_MINT, user),
      poolBaseTokenAccount: pool.poolBaseTokenAccount,
      poolQuoteTokenAccount: pool.poolQuoteTokenAccount,
      protocolFeeRecipient,
      protocolFeeRecipientTokenAccount: getAssociatedTokenAddressSync(WSOL_MINT, protocolFeeRecipient),
      coinCreatorVaultAuthority: pda.ammCreatorVaultAuthority(pool.coinCreator),
      coinCreatorVaultAta: pda.ammCreatorVaultAta(pool.coinCreator),
      baseTokenProgram: TOKEN_PROGRAM_ID,
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

  /** Buy on the AMM paying from SOL: wrap -> buy -> unwrap, all in one tx. */
  async ammBuyIxs(user: PublicKey, mint: PublicKey, pool: PoolState, protocolFeeRecipient: PublicKey, baseOut: bigint, maxQuoteIn: bigint) {
    const buy = await this.amm.methods.buy(bn(baseOut), bn(maxQuoteIn)).accounts(this.swapAccounts(user, mint, pool, protocolFeeRecipient)).instruction();
    return [...this.wrapSolIxs(user, maxQuoteIn), buy, this.unwrapSolIx(user)];
  }

  async ammSellIxs(user: PublicKey, mint: PublicKey, pool: PoolState, protocolFeeRecipient: PublicKey, baseIn: bigint, minQuoteOut: bigint) {
    const ata = getAssociatedTokenAddressSync(WSOL_MINT, user);
    const sell = await this.amm.methods.sell(bn(baseIn), bn(minQuoteOut)).accounts(this.swapAccounts(user, mint, pool, protocolFeeRecipient)).instruction();
    return [createAssociatedTokenAccountIdempotentInstruction(user, ata, user, WSOL_MINT), sell, this.unwrapSolIx(user)];
  }

  async ammCollectCreatorFeeIxs(creator: PublicKey) {
    const ix = await this.amm.methods
      .collectCoinCreatorFee()
      .accounts({
        coinCreator: creator,
        quoteMint: WSOL_MINT,
        coinCreatorVaultAuthority: pda.ammCreatorVaultAuthority(creator),
        coinCreatorVaultAta: pda.ammCreatorVaultAta(creator),
        coinCreatorTokenAccount: getAssociatedTokenAddressSync(WSOL_MINT, creator),
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
    return [ix, this.unwrapSolIx(creator)];
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
