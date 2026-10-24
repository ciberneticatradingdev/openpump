import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AMM_PROGRAM_ID, CURVE_PROGRAM_ID, MPL_TOKEN_METADATA_PROGRAM_ID, WSOL_MINT } from "./ids";

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
