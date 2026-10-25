import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AMM_PROGRAM_ID, CURVE_PROGRAM_ID, FEES_PROGRAM_ID, MAYHEM_PROGRAM_ID, MPL_TOKEN_METADATA_PROGRAM_ID, WSOL_MINT } from "./ids";

const u16le = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);

export const pda = {
  global: () => PublicKey.findProgramAddressSync([Buffer.from("global")], CURVE_PROGRAM_ID)[0],
  mintAuthority: () => PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], CURVE_PROGRAM_ID)[0],
  bondingCurve: (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], CURVE_PROGRAM_ID)[0],
  creatorVault: (creator: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creator.toBuffer()], CURVE_PROGRAM_ID)[0],
  curveEventAuthority: () => PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], CURVE_PROGRAM_ID)[0],
  metadata: (mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      MPL_TOKEN_METADATA_PROGRAM_ID
    )[0],
  associatedBondingCurve: (mint: PublicKey) => getAssociatedTokenAddressSync(mint, pda.bondingCurve(mint), true),
  /** Holder rewards: the "creator" of a holder-reward coin, and the vault its fees accrue in. */
  holderRewards: (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("holder-rewards"), mint.toBuffer()], CURVE_PROGRAM_ID)[0],
  holderVault: (mint: PublicKey) => pda.creatorVault(pda.holderRewards(mint)),
  /** Fees program */
  feeProgramGlobal: () => PublicKey.findProgramAddressSync([Buffer.from("fee-program-global")], FEES_PROGRAM_ID)[0],
  feeConfig: () => PublicKey.findProgramAddressSync([Buffer.from("fee-config")], FEES_PROGRAM_ID)[0],
  sharingConfig: (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), mint.toBuffer()], FEES_PROGRAM_ID)[0],
  socialFeePda: (userId: string, platform: number) =>
    PublicKey.findProgramAddressSync([Buffer.from("social-fee-pda"), Buffer.from(userId), Buffer.from([platform])], FEES_PROGRAM_ID)[0],
  donationFeePda: (mint: PublicKey, beneficiary: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("donation-fee-pda"), mint.toBuffer(), beneficiary.toBuffer()], FEES_PROGRAM_ID)[0],
  buybackVault: (index = 0) => PublicKey.findProgramAddressSync([Buffer.from("buyback"), Buffer.from([index])], FEES_PROGRAM_ID)[0],
  /** Mayhem */
  mayhemGlobalParams: () => PublicKey.findProgramAddressSync([Buffer.from("global-params")], MAYHEM_PROGRAM_ID)[0],
  mayhemSolVault: () => PublicKey.findProgramAddressSync([Buffer.from("sol-vault")], MAYHEM_PROGRAM_ID)[0],
  mayhemState: (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("mayhem-state"), mint.toBuffer()], MAYHEM_PROGRAM_ID)[0],
  /** Volume incentives */
  globalVolumeAccumulator: () => PublicKey.findProgramAddressSync([Buffer.from("global_volume_accumulator")], CURVE_PROGRAM_ID)[0],
  userVolumeAccumulator: (user: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("user_volume_accumulator"), user.toBuffer()], CURVE_PROGRAM_ID)[0],
  /** v2 (custom pairs) */
  quoteConfig: (quoteMint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("quote-config"), quoteMint.toBuffer()], CURVE_PROGRAM_ID)[0],
  bondingCurveQuote: (mint: PublicKey, quoteMint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) =>
    getAssociatedTokenAddressSync(quoteMint, pda.bondingCurve(mint), true, tokenProgram),
  creatorVaultQuote: (creator: PublicKey, quoteMint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) =>
    getAssociatedTokenAddressSync(quoteMint, pda.creatorVault(creator), true, tokenProgram),
  /** Pool created by v2 migration: index 0, creator = bonding curve PDA, quote = the coin's quote mint. */
  migrationPoolV2: (mint: PublicKey, quoteMint: PublicKey) => pda.pool(0, pda.bondingCurve(mint), mint, quoteMint),

  ammGlobalConfig: () => PublicKey.findProgramAddressSync([Buffer.from("global-config")], AMM_PROGRAM_ID)[0],
  ammEventAuthority: () => PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], AMM_PROGRAM_ID)[0],
  /** Pool created by migration: index 0, creator = bonding curve PDA, quote = WSOL. */
  migrationPool: (mint: PublicKey) => pda.pool(0, pda.bondingCurve(mint), mint, WSOL_MINT),
  pool: (index: number, creator: PublicKey, baseMint: PublicKey, quoteMint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), u16le(index), creator.toBuffer(), baseMint.toBuffer(), quoteMint.toBuffer()],
      AMM_PROGRAM_ID
    )[0],
  lpMint: (pool: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("pool-lp-mint"), pool.toBuffer()], AMM_PROGRAM_ID)[0],
  ammCreatorVaultAuthority: (creator: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creator.toBuffer()], AMM_PROGRAM_ID)[0],
  ammCreatorVaultAta: (creator: PublicKey, quoteMint: PublicKey = WSOL_MINT) =>
    getAssociatedTokenAddressSync(quoteMint, pda.ammCreatorVaultAuthority(creator), true),
  poolBase: (pool: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, pool, true),
  poolQuote: (pool: PublicKey, quoteMint: PublicKey = WSOL_MINT) => getAssociatedTokenAddressSync(quoteMint, pool, true),
  lockedLp: (pool: PublicKey) => getAssociatedTokenAddressSync(pda.lpMint(pool), pool, true),
};
