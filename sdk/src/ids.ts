import { PublicKey } from "@solana/web3.js";
import curveIdl from "../idl/openpump_curve.json";
import ammIdl from "../idl/openpump_amm.json";

export const CURVE_IDL = curveIdl as any;
export const AMM_IDL = ammIdl as any;

export const CURVE_PROGRAM_ID = new PublicKey(curveIdl.address);
export const AMM_PROGRAM_ID = new PublicKey(ammIdl.address);
export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export const TOKEN_DECIMALS = 6;
export const BPS = 10_000n;

/** Default launch parameters (pump.fun-shaped numbers, our fee split). */
export const DEFAULT_PARAMS = {
  initialVirtualTokenReserves: 1_073_000_000_000_000n,
  initialVirtualSolReserves: 30_000_000_000n,
  initialRealTokenReserves: 793_100_000_000_000n,
  tokenTotalSupply: 1_000_000_000_000_000n,
  feeBasisPoints: 50n, // 0.50 % protocol
  creatorFeeBasisPoints: 50n, // 0.50 % creator, from trade #1
  migrationFeeLamports: 0n,
  antiSnipeSlots: 15n, // ~6 s window
  antiSnipeMaxBps: 100n, // 1 % of supply per buy inside the window
  paused: false,
};

export const DEFAULT_AMM_FEES = {
  lpFeeBasisPoints: 20n, // 0.20 % to LPs
  protocolFeeBasisPoints: 5n, // 0.05 %
  coinCreatorFeeBasisPoints: 5n, // 0.05 %
};
