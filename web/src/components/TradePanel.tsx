import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { amm as ammMath, curve as curveMath, incentives as incMath, pda, tiers, type PoolState } from "@openpump/sdk";
import { isV2, type Coin, type Config } from "../lib/api";
import { useClient, useSendTx } from "../lib/solana";
import { qty, tokens as fmtTokens } from "../lib/format";

const QUICK_SOL = [0.1, 0.5, 1, 5];

/**
 * Trade panel for both venues (bonding curve / AMM) and both quote kinds
 * (native SOL "v1" curves, custom-pair "v2" curves paid in an SPL quote token).
 */
export default function TradePanel({ coin, cfg, onTraded }: { coin: Coin; cfg: Config; onTraded?: () => void }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useClient();
  const send = useSendTx();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("");
  const [slip, setSlip] = useState(2);
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState<{ quote: bigint; tok: bigint }>({ quote: 0n, tok: 0n });
  const [pool, setPool] = useState<PoolState | null>(null);
  const [reserves, setReserves] = useState<{ baseReserve: bigint; quoteReserve: bigint } | null>(null);

  const mint = useMemo(() => new PublicKey(coin.mint), [coin.mint]);
  const v2 = isV2(coin);
  const quoteMint = useMemo(() => new PublicKey(coin.quote_mint), [coin.quote_mint]);
  const qSym = coin.quote_symbol || "SOL";
  const qDec = coin.quote_decimals ?? 9;
  const graduated = !!coin.migrated;
  const locked = coin.complete === 1 && !coin.migrated;
  const quick = v2 ? [10, 100, 1000, 10000] : QUICK_SOL;

  // balances: quote (SOL or quote ATA) + coin
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!publicKey) return setBal({ quote: 0n, tok: 0n });
      const tokP = connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, publicKey), "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n);
      const quoteP = v2
        ? connection.getTokenAccountBalance(getAssociatedTokenAddressSync(quoteMint, publicKey), "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n)
        : connection.getBalance(publicKey, "confirmed").then((b) => BigInt(b));
      const [q, t] = await Promise.all([quoteP, tokP]);
      if (alive) setBal({ quote: q, tok: t });
    };
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [publicKey, connection, mint, quoteMint, v2, coin.trades]);

  // AMM pool state (after graduation)
  useEffect(() => {
    if (!graduated) return;
    let alive = true;
    const load = async () => {
      const p = await client.fetchPool(mint, quoteMint);
      if (!p || !alive) return;
      setPool(p);
      setReserves(await client.fetchPoolReserves(p));
    };
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [graduated, client, mint, quoteMint, coin.trades]);

  const g = cfg.global;
  const tierNow = currentTier(cfg, coin, reserves);
  const fees = tierNow ? { feeBasisPoints: tierNow.protocolFeeBps, creatorFeeBasisPoints: tierNow.creatorFeeBps } : { feeBasisPoints: BigInt(g.feeBasisPoints), creatorFeeBasisPoints: BigInt(g.creatorFeeBasisPoints) };
  const ammFees = tierNow
    ? { lpFeeBasisPoints: tierNow.lpFeeBps, protocolFeeBasisPoints: tierNow.protocolFeeBps, coinCreatorFeeBasisPoints: tierNow.creatorFeeBps }
    : g.amm ? { lpFeeBasisPoints: BigInt(g.amm.lpFeeBasisPoints), protocolFeeBasisPoints: BigInt(g.amm.protocolFeeBasisPoints), coinCreatorFeeBasisPoints: BigInt(g.amm.coinCreatorFeeBasisPoints) } : null;
  const feePct = (Number(fees.feeBasisPoints) + Number(fees.creatorFeeBasisPoints)) / 100;
  const curveState = { virtualSolReserves: BigInt(coin.v_sol), virtualTokenReserves: BigInt(coin.v_tok), realSolReserves: BigInt(coin.r_sol), realTokenReserves: BigInt(coin.r_tok), tokenTotalSupply: BigInt(coin.supply), complete: !!coin.complete };
  const toUnits = (n: number, dec: number) => BigInt(Math.floor(n * 10 ** dec));

  const quote = useMemo(() => {
    const n = Number(amt);
    if (!n || n <= 0) return null;
    try {
      if (side === "buy") {
        const units = toUnits(n, qDec);
        if (!graduated) {
          const q = curveMath.quoteBuyExactSol(units, curveState, fees);
          return { out: q.tokensOut, cost: q.totalCost, fee: q.protocolFee + q.creatorFee, creatorFee: q.creatorFee, completes: q.completes, pricePer: Number(q.solIn) / Number(q.tokensOut) };
        }
        if (!reserves || !ammFees) return null;
        const q = ammMath.quoteBuyWithBudget(units, reserves.baseReserve, reserves.quoteReserve, ammFees);
        return { out: q.baseOut, cost: q.totalIn, fee: q.fees.total, creatorFee: q.fees.creator, completes: false, pricePer: Number(q.quoteIn) / Number(q.baseOut) };
      }
      const units = toUnits(n, 6);
      if (!graduated) {
        const q = curveMath.quoteSell(units, curveState, fees);
        return { out: q.userOut, cost: units, fee: q.protocolFee + q.creatorFee, creatorFee: q.creatorFee, completes: false, pricePer: Number(q.solOut) / Number(units) };
      }
      if (!reserves || !ammFees) return null;
      const q = ammMath.quoteSell(units, reserves.baseReserve, reserves.quoteReserve, ammFees);
      return { out: q.userOut, cost: units, fee: q.fees.total, creatorFee: q.fees.creator, completes: false, pricePer: Number(q.quoteOut) / Number(units) };
    } catch {
      return null;
    }
  }, [amt, side, coin, reserves, graduated]);

  const submit = async () => {
    if (!publicKey) return setVisible(true);
    if (!quote) return;
    setBusy(true);
    try {
      const creator = new PublicKey(coin.creator);
      const feeRecipient = new PublicKey(g.feeRecipient!);
      const slipBps = BigInt(Math.round(slip * 100));
      let ixs;
      if (side === "buy") {
        const units = toUnits(Number(amt), qDec);
        const minOut = (quote.out * (10000n - slipBps)) / 10000n;
        if (!graduated) {
          if (v2) ixs = [await client.buyExactQuoteInIx(publicKey, mint, creator, feeRecipient, quoteMint, units, minOut)];
          else {
            // trade-to-earn: count this buy toward the volume campaign when one is live
            const inc = cfg.incentives;
            const track = !!inc && incMath.active({ ...inc, totalTokenSupply: [], solVolumes: [] });
            ixs = [];
            if (track && !(await connection.getAccountInfo(pda.userVolumeAccumulator(publicKey), "confirmed"))) ixs.push(await client.initUserVolumeIx(publicKey));
            ixs.push(await client.buyExactSolIx(publicKey, mint, creator, feeRecipient, units, minOut, track));
          }
        } else {
          const maxIn = (quote.cost * (10000n + slipBps)) / 10000n;
          ixs = await client.ammBuyIxs(publicKey, mint, pool!, new PublicKey(g.amm!.protocolFeeRecipient), quote.out, maxIn > units ? units : maxIn);
        }
      } else {
        const units = toUnits(Number(amt), 6);
        const minOut = (quote.out * (10000n - slipBps)) / 10000n;
        if (!graduated) {
          ixs = v2
            ? [await client.sellV2Ix(publicKey, mint, creator, feeRecipient, quoteMint, units, minOut)]
            : [await client.sellIx(publicKey, mint, creator, feeRecipient, units, minOut)];
        } else ixs = await client.ammSellIxs(publicKey, mint, pool!, new PublicKey(g.amm!.protocolFeeRecipient), units, minOut);
      }
      const sig = await send(ixs, `${side === "buy" ? "Buy" : "Sell"} ${coin.symbol}`, { cu: 250_000 });
      if (sig) { setAmt(""); onTraded?.(); }
    } finally {
      setBusy(false);
    }
  };

  const migrate = async () => {
    if (!publicKey) return setVisible(true);
    setBusy(true);
    try {
      const creator = new PublicKey(coin.creator);
      const feeRecipient = new PublicKey(g.feeRecipient!);
      const ixs = v2 ? await client.migrateV2Ixs(publicKey, mint, creator, feeRecipient, quoteMint) : await client.migrateIxs(publicKey, mint, creator, feeRecipient);
      const sig = await send(ixs, `Graduate ${coin.symbol} to the AMM`);
      if (sig) onTraded?.();
    } finally {
      setBusy(false);
    }
  };

  const setPctSell = (p: number) => setAmt(((Number(bal.tok) / 1e6) * p).toFixed(p === 1 ? 6 : 2).replace(/\.?0+$/, ""));
  const setMaxBuy = () => {
    const n = Number(bal.quote) / 10 ** qDec;
    setAmt(Math.max(0, v2 ? n : n - 0.01).toFixed(v2 ? 2 : 3));
  };

  return (
    <div className="panel p-3 space-y-3">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/30 border border-line">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); setAmt(""); }} className={`h-9 rounded-lg font-head font-semibold text-[13px] capitalize transition ${side === s ? (s === "buy" ? "bg-acc text-bg" : "bg-red text-bg") : "text-mute hover:text-ink"}`}>{s}</button>
        ))}
      </div>

      {v2 && (
        <div className="text-[11px] text-mute flex items-center gap-2">
          <span className="pill !h-6 !text-[10px] text-acc border-acc/30 bg-acc/10">custom pair</span>
          trades in <b className="text-ink">{qSym}</b>, not SOL
        </div>
      )}

      {locked ? (
        <div className="rounded-xl border border-gold/30 bg-gold/10 p-3 text-[13px]">
          <div className="font-semibold text-gold">Curve complete — graduating</div>
          <p className="text-mute mt-1">The bonding curve sold out. Anyone can move the {qty(coin.r_sol, qDec)} {qSym} + remaining supply into the AMM and burn the LP. Trading resumes there.</p>
          <button onClick={migrate} disabled={busy} className="btn btn-acc w-full mt-3">Graduate now (permissionless)</button>
        </div>
      ) : (
        <>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="label">{side === "buy" ? "You pay" : "You sell"}</span>
              <button className="text-[11px] text-mute hover:text-ink num" onClick={() => (side === "buy" ? setMaxBuy() : setPctSell(1))}>
                bal {side === "buy" ? `${qty(bal.quote, qDec, 3)} ${qSym}` : `${fmtTokens(bal.tok)} ${coin.symbol}`}
              </button>
            </div>
            <div className="relative">
              <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.0" className="input !h-12 !text-[18px] num pr-24" />
              <span className="absolute right-3 top-3.5 text-[12px] font-semibold text-mute">{side === "buy" ? qSym : coin.symbol}</span>
            </div>
            <div className="flex gap-1.5 mt-2">
              {side === "buy"
                ? quick.map((q) => <button key={q} onClick={() => setAmt(String(q))} className="pill !h-7 !px-2 flex-1 justify-center">{q >= 1000 ? `${q / 1000}K` : q} {qSym}</button>)
                : [0.25, 0.5, 0.75, 1].map((p) => <button key={p} onClick={() => setPctSell(p)} className="pill !h-7 !px-2.5 flex-1 justify-center">{p * 100}%</button>)}
            </div>
          </div>

          <div className="rounded-xl bg-black/30 border border-line p-3 text-[12px] space-y-1.5">
            <Row k="You receive" v={quote ? (side === "buy" ? `${fmtTokens(quote.out)} ${coin.symbol}` : `${qty(quote.out, qDec, 4)} ${qSym}`) : "–"} strong />
            <Row k="Price" v={quote ? `${(quote.pricePer * 1e6 / 10 ** qDec).toPrecision(4)} ${qSym}` : "–"} />
            <Row k={`Fees (${feePct}%${tierNow ? ", tiered" : ""})`} v={quote ? `${qty(quote.fee, qDec, 5)} ${qSym}` : "–"} hint={quote ? `${qty(quote.creatorFee, qDec, 5)} to ${coin.is_holder_reward ? "holders" : "creator"}` : undefined} />
            <Row k="Slippage" v={<span className="flex gap-1">{[0.5, 1, 2, 5].map((s) => <button key={s} onClick={() => setSlip(s)} className={`px-1.5 rounded ${slip === s ? "bg-acc/15 text-acc" : "text-mute hover:text-ink"}`}>{s}%</button>)}</span>} />
            {quote?.completes && <div className="text-gold text-[11px] pt-1">This buy completes the curve. You get everything that is left and pay only for that.</div>}
          </div>

          <button onClick={submit} disabled={busy || (!!publicKey && !quote)} className={`btn w-full !h-11 ${side === "buy" ? "btn-acc" : "btn-red"}`}>
            {!publicKey ? "Connect wallet" : busy ? "Sending…" : side === "buy" ? `Buy ${coin.symbol}` : `Sell ${coin.symbol}`}
          </button>
          <p className="text-[11px] text-dim text-center">{graduated ? "Trades on the AMM pool. Fees: LP + protocol + creator." : "Trades on the bonding curve. Creator earns from trade one."}</p>
          {!graduated && !v2 && cfg.incentives?.active && side === "buy" && (
            <p className="text-[11px] text-acc text-center">Trade to earn: this buy counts toward today's {cfg.incentives.symbol} rewards.</p>
          )}
        </>
      )}
    </div>
  );
}

function Row({ k, v, strong, hint }: { k: string; v: any; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-mute">{k}</span>
      <span className={`text-right num ${strong ? "text-ink font-semibold text-[13px]" : "text-ink"}`}>
        {v}
        {hint && <div className="text-[10px] text-dim font-normal">{hint}</div>}
      </span>
    </div>
  );
}

/** Tier fees for the coin's current market cap (curve: virtual reserves; AMM: pool reserves × mint supply). */
export function currentTier(cfg: Config, coin: Coin, reserves: { baseReserve: bigint; quoteReserve: bigint } | null) {
  const fc = cfg.feeConfig;
  if (!fc) return null;
  const supply = BigInt(coin.supply);
  const mcap = coin.migrated && reserves ? tiers.marketCap(reserves.quoteReserve, reserves.baseReserve, supply) : tiers.marketCap(BigInt(coin.v_sol), BigInt(coin.v_tok), supply);
  const b = (x: { lpFeeBps: string; protocolFeeBps: string; creatorFeeBps: string }) => ({ lpFeeBps: BigInt(x.lpFeeBps), protocolFeeBps: BigInt(x.protocolFeeBps), creatorFeeBps: BigInt(x.creatorFeeBps) });
  const t = (x: { marketCapLamportsThreshold: string; fees: any }) => ({ marketCapLamportsThreshold: BigInt(x.marketCapLamportsThreshold), fees: b(x.fees) });
  return tiers.feesFor({ flatFees: b(fc.flatFees), feeTiers: fc.feeTiers.map(t), stableFeeTiers: fc.stableFeeTiers.map(t), exoticFlatFees: b(fc.exoticFlatFees), stableMints: fc.stableMints }, mcap, coin.quote_mint);
}
