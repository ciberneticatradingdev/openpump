import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { amm as ammMath, curve as curveMath, type PoolState } from "@openpump/sdk";
import type { Coin, Config } from "../lib/api";
import { useClient, useSendTx } from "../lib/solana";
import { sol as fmtSol, tokens as fmtTokens } from "../lib/format";

const QUICK = [0.1, 0.5, 1, 5];

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
  const [bal, setBal] = useState<{ sol: bigint; tok: bigint }>({ sol: 0n, tok: 0n });
  const [pool, setPool] = useState<PoolState | null>(null);
  const [reserves, setReserves] = useState<{ baseReserve: bigint; quoteReserve: bigint } | null>(null);

  const mint = useMemo(() => new PublicKey(coin.mint), [coin.mint]);
  const graduated = !!coin.migrated;
  const locked = coin.complete === 1 && !coin.migrated;

  // balances
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!publicKey) return setBal({ sol: 0n, tok: 0n });
      const [s, t] = await Promise.all([
        connection.getBalance(publicKey, "confirmed"),
        connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, publicKey), "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n),
      ]);
      if (alive) setBal({ sol: BigInt(s), tok: t });
    };
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [publicKey, connection, mint, coin.trades]);

  // AMM pool state
  useEffect(() => {
    if (!graduated) return;
    let alive = true;
    const load = async () => {
      const p = await client.fetchPool(mint);
      if (!p || !alive) return;
      setPool(p);
      setReserves(await client.fetchPoolReserves(p));
    };
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [graduated, client, mint, coin.trades]);

  const g = cfg.global;
  const fees = { feeBasisPoints: BigInt(g.feeBasisPoints), creatorFeeBasisPoints: BigInt(g.creatorFeeBasisPoints) };
  const ammFees = g.amm ? { lpFeeBasisPoints: BigInt(g.amm.lpFeeBasisPoints), protocolFeeBasisPoints: BigInt(g.amm.protocolFeeBasisPoints), coinCreatorFeeBasisPoints: BigInt(g.amm.coinCreatorFeeBasisPoints) } : null;
  const curveState = { virtualSolReserves: BigInt(coin.v_sol), virtualTokenReserves: BigInt(coin.v_tok), realSolReserves: BigInt(coin.r_sol), realTokenReserves: BigInt(coin.r_tok), tokenTotalSupply: BigInt(coin.supply), complete: !!coin.complete };

  // quote
  const quote = useMemo(() => {
    const n = Number(amt);
    if (!n || n <= 0) return null;
    try {
      if (side === "buy") {
        const lamports = BigInt(Math.floor(n * 1e9));
        if (!graduated) {
          const q = curveMath.quoteBuyExactSol(lamports, curveState, fees);
          return { out: q.tokensOut, cost: q.totalCost, fee: q.protocolFee + q.creatorFee, creatorFee: q.creatorFee, completes: q.completes, pricePer: Number(q.solIn) / Number(q.tokensOut) };
        }
        if (!reserves || !ammFees) return null;
        const q = ammMath.quoteBuyWithBudget(lamports, reserves.baseReserve, reserves.quoteReserve, ammFees);
        return { out: q.baseOut, cost: q.totalIn, fee: q.fees.total, creatorFee: q.fees.creator, completes: false, pricePer: Number(q.quoteIn) / Number(q.baseOut) };
      } else {
        const units = BigInt(Math.floor(n * 1e6));
        if (!graduated) {
          const q = curveMath.quoteSell(units, curveState, fees);
          return { out: q.userOut, cost: units, fee: q.protocolFee + q.creatorFee, creatorFee: q.creatorFee, completes: false, pricePer: Number(q.solOut) / Number(units) };
        }
        if (!reserves || !ammFees) return null;
        const q = ammMath.quoteSell(units, reserves.baseReserve, reserves.quoteReserve, ammFees);
        return { out: q.userOut, cost: units, fee: q.fees.total, creatorFee: q.fees.creator, completes: false, pricePer: Number(q.quoteOut) / Number(units) };
      }
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
        const lamports = BigInt(Math.floor(Number(amt) * 1e9));
        const minOut = (quote.out * (10000n - slipBps)) / 10000n;
        if (!graduated) ixs = [await client.buyExactSolIx(publicKey, mint, creator, feeRecipient, lamports, minOut)];
        else {
          const maxIn = (quote.cost * (10000n + slipBps)) / 10000n;
          ixs = await client.ammBuyIxs(publicKey, mint, pool!, new PublicKey(g.amm!.protocolFeeRecipient), quote.out, maxIn > lamports ? lamports : maxIn);
        }
      } else {
        const units = BigInt(Math.floor(Number(amt) * 1e6));
        const minOut = (quote.out * (10000n - slipBps)) / 10000n;
        if (!graduated) ixs = [await client.sellIx(publicKey, mint, creator, feeRecipient, units, minOut)];
        else ixs = await client.ammSellIxs(publicKey, mint, pool!, new PublicKey(g.amm!.protocolFeeRecipient), units, minOut);
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
      const ixs = await client.migrateIxs(publicKey, mint, new PublicKey(coin.creator), new PublicKey(g.feeRecipient!));
      const sig = await send(ixs, `Graduate ${coin.symbol} to the AMM`);
      if (sig) onTraded?.();
    } finally {
      setBusy(false);
    }
  };

  const setPctSell = (p: number) => setAmt(((Number(bal.tok) / 1e6) * p).toFixed(p === 1 ? 6 : 2).replace(/\.?0+$/, ""));

  return (
    <div className="panel p-3 space-y-3">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/30 border border-line">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); setAmt(""); }} className={`h-9 rounded-lg font-head font-semibold text-[13px] capitalize transition ${side === s ? (s === "buy" ? "bg-acc text-bg" : "bg-red text-bg") : "text-mute hover:text-ink"}`}>{s}</button>
        ))}
      </div>

      {locked ? (
        <div className="rounded-xl border border-gold/30 bg-gold/10 p-3 text-[13px]">
          <div className="font-semibold text-gold">Curve complete — graduating</div>
          <p className="text-mute mt-1">The bonding curve sold out. Anyone can move the {fmtSol(coin.r_sol, 1)} SOL + remaining supply into the AMM and burn the LP. Trading resumes there.</p>
          <button onClick={migrate} disabled={busy} className="btn btn-acc w-full mt-3">Graduate now (permissionless)</button>
        </div>
      ) : (
        <>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="label">{side === "buy" ? "You pay" : "You sell"}</span>
              <button className="text-[11px] text-mute hover:text-ink num" onClick={() => (side === "buy" ? setAmt(Math.max(0, Number(bal.sol) / 1e9 - 0.01).toFixed(3)) : setPctSell(1))}>
                bal {side === "buy" ? `${fmtSol(bal.sol, 3)} SOL` : `${fmtTokens(bal.tok)} ${coin.symbol}`}
              </button>
            </div>
            <div className="relative">
              <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.0" className="input !h-12 !text-[18px] num pr-20" />
              <span className="absolute right-3 top-3.5 text-[12px] font-semibold text-mute">{side === "buy" ? "SOL" : coin.symbol}</span>
            </div>
            <div className="flex gap-1.5 mt-2">
              {side === "buy"
                ? QUICK.map((q) => <button key={q} onClick={() => setAmt(String(q))} className="pill !h-7 !px-2.5 flex-1 justify-center">{q} SOL</button>)
                : [0.25, 0.5, 0.75, 1].map((p) => <button key={p} onClick={() => setPctSell(p)} className="pill !h-7 !px-2.5 flex-1 justify-center">{p * 100}%</button>)}
            </div>
          </div>

          <div className="rounded-xl bg-black/30 border border-line p-3 text-[12px] space-y-1.5">
            <Row k={side === "buy" ? "You receive" : "You receive"} v={quote ? (side === "buy" ? `${fmtTokens(quote.out)} ${coin.symbol}` : `${fmtSol(quote.out, 4)} SOL`) : "–"} strong />
            <Row k="Price" v={quote ? `${(quote.pricePer / 1e3).toFixed(9)} SOL` : "–"} />
            <Row k={`Fees (${(Number(g.feeBasisPoints) + Number(g.creatorFeeBasisPoints)) / 100}%)`} v={quote ? `${fmtSol(quote.fee, 5)} SOL` : "–"} hint={quote ? `${fmtSol(quote.creatorFee, 5)} to creator` : undefined} />
            <Row k="Slippage" v={<span className="flex gap-1">{[0.5, 1, 2, 5].map((s) => <button key={s} onClick={() => setSlip(s)} className={`px-1.5 rounded ${slip === s ? "bg-acc/15 text-acc" : "text-mute hover:text-ink"}`}>{s}%</button>)}</span>} />
            {quote?.completes && <div className="text-gold text-[11px] pt-1">This buy completes the curve. You get everything that is left and pay only for that.</div>}
          </div>

          <button onClick={submit} disabled={busy || (!!publicKey && !quote)} className={`btn w-full !h-11 ${side === "buy" ? "btn-acc" : "btn-red"}`}>
            {!publicKey ? "Connect wallet" : busy ? "Sending…" : side === "buy" ? `Buy ${coin.symbol}` : `Sell ${coin.symbol}`}
          </button>
          <p className="text-[11px] text-dim text-center">{graduated ? "Trades on the AMM pool. Fees: LP + protocol + creator." : "Trades on the bonding curve. Creator earns from trade one."}</p>
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
