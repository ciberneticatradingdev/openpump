/** Mirrors the on-chain math in programs/<name>/src/math.rs exactly (BigInt, same rounding). */
import { BPS } from "./ids";

export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export const feeCeil = (amount: bigint, bps: bigint) => (bps === 0n ? 0n : ceilDiv(amount * bps, BPS));

export interface CurveState {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}
export interface FeeParams {
  feeBasisPoints: bigint;
  creatorFeeBasisPoints: bigint;
}

export const curve = {
  /** SOL (lamports, pre-fee) to receive `tokensOut`. */
  solInForTokensOut(tokensOut: bigint, c: CurveState) {
    if (tokensOut >= c.virtualTokenReserves) throw new Error("insufficient reserves");
    return ceilDiv(tokensOut * c.virtualSolReserves, c.virtualTokenReserves - tokensOut);
  },
  tokensOutForSolIn(solIn: bigint, c: CurveState) {
    return (solIn * c.virtualTokenReserves) / (c.virtualSolReserves + solIn);
  },
  solOutForTokensIn(tokensIn: bigint, c: CurveState) {
    return (tokensIn * c.virtualSolReserves) / (c.virtualTokenReserves + tokensIn);
  },
  /** Full buy quote for "spend X SOL" including partial fill at the end of the curve. */
  quoteBuyExactSol(solIn: bigint, c: CurveState, f: FeeParams) {
    let tokensOut = curve.tokensOutForSolIn(solIn, c);
    let spend = solIn;
    if (tokensOut >= c.realTokenReserves) {
      tokensOut = c.realTokenReserves;
      spend = curve.solInForTokensOut(tokensOut, c);
    }
    const protocolFee = feeCeil(spend, f.feeBasisPoints);
    const creatorFee = feeCeil(spend, f.creatorFeeBasisPoints);
    return { tokensOut, solIn: spend, protocolFee, creatorFee, totalCost: spend + protocolFee + creatorFee, completes: tokensOut === c.realTokenReserves };
  },
  quoteBuyTokens(tokens: bigint, c: CurveState, f: FeeParams) {
    const tokensOut = tokens > c.realTokenReserves ? c.realTokenReserves : tokens;
    const solIn = curve.solInForTokensOut(tokensOut, c);
    const protocolFee = feeCeil(solIn, f.feeBasisPoints);
    const creatorFee = feeCeil(solIn, f.creatorFeeBasisPoints);
    return { tokensOut, solIn, protocolFee, creatorFee, totalCost: solIn + protocolFee + creatorFee, completes: tokensOut === c.realTokenReserves };
  },
  quoteSell(tokensIn: bigint, c: CurveState, f: FeeParams) {
    const solOut = curve.solOutForTokensIn(tokensIn, c);
    const protocolFee = feeCeil(solOut, f.feeBasisPoints);
    const creatorFee = feeCeil(solOut, f.creatorFeeBasisPoints);
    return { solOut, protocolFee, creatorFee, userOut: solOut - protocolFee - creatorFee };
  },
  /** Spot price in lamports per whole token (10^6 base units). */
  priceLamportsPerToken(c: CurveState) {
    return Number(c.virtualSolReserves) / Number(c.virtualTokenReserves) * 1e6;
  },
  /** Market cap in lamports (price * total supply). */
  marketCapLamports(c: CurveState) {
    return (Number(c.virtualSolReserves) / Number(c.virtualTokenReserves)) * Number(c.tokenTotalSupply);
  },
  /** 0..1 progress to graduation. */
  progress(c: CurveState, initialRealTokenReserves: bigint) {
    if (c.complete) return 1;
    const sold = initialRealTokenReserves - c.realTokenReserves;
    return Number(sold) / Number(initialRealTokenReserves);
  },
};

export interface AmmFees {
  lpFeeBasisPoints: bigint;
  protocolFeeBasisPoints: bigint;
  coinCreatorFeeBasisPoints: bigint;
}

export const amm = {
  quoteInForBaseOut(baseOut: bigint, baseReserve: bigint, quoteReserve: bigint) {
    if (baseOut >= baseReserve) throw new Error("insufficient liquidity");
    return ceilDiv(baseOut * quoteReserve, baseReserve - baseOut);
  },
  quoteOutForBaseIn(baseIn: bigint, baseReserve: bigint, quoteReserve: bigint) {
    return (baseIn * quoteReserve) / (baseReserve + baseIn);
  },
  baseOutForQuoteIn(quoteIn: bigint, baseReserve: bigint, quoteReserve: bigint) {
    return (quoteIn * baseReserve) / (quoteReserve + quoteIn);
  },
  fees(amount: bigint, f: AmmFees, hasCreator = true) {
    const lp = feeCeil(amount, f.lpFeeBasisPoints);
    const protocol = feeCeil(amount, f.protocolFeeBasisPoints);
    const creator = hasCreator ? feeCeil(amount, f.coinCreatorFeeBasisPoints) : 0n;
    return { lp, protocol, creator, total: lp + protocol + creator };
  },
  /** Buy exactly `baseOut`; returns the max quote the user must allow (fees included). */
  quoteBuy(baseOut: bigint, baseReserve: bigint, quoteReserve: bigint, f: AmmFees) {
    const quoteIn = amm.quoteInForBaseOut(baseOut, baseReserve, quoteReserve);
    const fees = amm.fees(quoteIn, f);
    return { quoteIn, fees, totalIn: quoteIn + fees.total };
  },
  /** "Spend X quote" helper: solve base out such that totalIn <= quoteBudget (approximate, then exact). */
  quoteBuyWithBudget(quoteBudget: bigint, baseReserve: bigint, quoteReserve: bigint, f: AmmFees) {
    const totalBps = f.lpFeeBasisPoints + f.protocolFeeBasisPoints + f.coinCreatorFeeBasisPoints;
    // quoteIn * (1 + totalBps/BPS) <= budget  =>  quoteIn <= budget * BPS / (BPS + totalBps)
    let quoteIn = (quoteBudget * BPS) / (BPS + totalBps);
    let baseOut = amm.baseOutForQuoteIn(quoteIn, baseReserve, quoteReserve);
    // tighten until the exact total fits the budget
    for (let i = 0; i < 8 && baseOut > 0n; i++) {
      const q = amm.quoteBuy(baseOut, baseReserve, quoteReserve, f);
      if (q.totalIn <= quoteBudget) return { baseOut, ...q };
      baseOut = (baseOut * 9999n) / 10000n;
    }
    return { baseOut, ...amm.quoteBuy(baseOut, baseReserve, quoteReserve, f) };
  },
  quoteSell(baseIn: bigint, baseReserve: bigint, quoteReserve: bigint, f: AmmFees) {
    const quoteOut = amm.quoteOutForBaseIn(baseIn, baseReserve, quoteReserve);
    const fees = amm.fees(quoteOut, f);
    return { quoteOut, fees, userOut: quoteOut - fees.total };
  },
  priceLamportsPerToken(baseReserve: bigint, quoteReserve: bigint) {
    return (Number(quoteReserve) / Number(baseReserve)) * 1e6;
  },
};

export const fmt = {
  sol: (lamports: bigint | number, digits = 3) => (Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: digits }),
  tokens: (units: bigint | number, digits = 2) => (Number(units) / 1e6).toLocaleString("en-US", { maximumFractionDigits: digits }),
  compact: (n: number) =>
    n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(n < 10 ? 2 : 0),
};
