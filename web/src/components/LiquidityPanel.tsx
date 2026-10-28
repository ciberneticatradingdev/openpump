import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { OpenpumpClient, type PoolState } from "@openpump/sdk";
import { type Coin, type Config } from "../lib/api";
import { useClient, useSendTx } from "../lib/solana";
import { qty, tokens as fmtTokens } from "../lib/format";

/** Add / remove liquidity on the coin's OpenSwap pool. LP is a plain SPL token minted by the pool. */
export default function LiquidityPanel({ coin, cfg, onChanged }: { coin: Coin; cfg: Config; onChanged?: () => void }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useClient();
  const send = useSendTx();
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState("");
  const [pctOut, setPctOut] = useState(25);
  const [busy, setBusy] = useState(false);
  const [pool, setPool] = useState<PoolState | null>(null);
  const [res, setRes] = useState<{ base: bigint; quote: bigint; lp: bigint } | null>(null);
  const [lpBal, setLpBal] = useState(0n);
  const [tokBal, setTokBal] = useState(0n);

  const qSym = coin.quote_symbol || "SOL";
  const qDec = coin.quote_decimals ?? 9;
  const mint = useMemo(() => new PublicKey(coin.mint), [coin.mint]);
  const tokenProgram = useMemo(() => new PublicKey(coin.token_program || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), [coin.token_program]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const p = await client.fetchPoolByAddress(new PublicKey(coin.pool!));
      if (!p || !alive) return;
      const r = await client.fetchPoolReserves(p);
      if (!alive) return;
      setPool(p);
      setRes({ base: r.baseReserve, quote: r.realQuoteReserve, lp: p.lpSupply });
      if (publicKey) {
        const [lp, tok] = await Promise.all([
          connection.getTokenAccountBalance(getAssociatedTokenAddressSync(p.lpMint, publicKey), "confirmed").then((x) => BigInt(x.value.amount)).catch(() => 0n),
          connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, publicKey, false, tokenProgram), "confirmed").then((x) => BigInt(x.value.amount)).catch(() => 0n),
        ]);
        if (alive) { setLpBal(lp); setTokBal(tok); }
      }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [client, connection, coin.pool, coin.trades, publicKey, mint, tokenProgram]);

  const boosting = !!pool && pool.virtualQuoteReserves > 0n;
  const quoteIn = useMemo(() => { const n = Number(amt); return n > 0 ? BigInt(Math.floor(n * 10 ** qDec)) : 0n; }, [amt, qDec]);
  const addQuote = useMemo(() => {
    if (!res || quoteIn <= 0n || res.quote === 0n) return null;
    const lpOut = OpenpumpClient.lpForQuote(quoteIn, res.quote, res.lp);
    const need = OpenpumpClient.depositAmounts(lpOut, res.base, res.quote, res.lp);
    return { lpOut, ...need, share: res.lp + lpOut > 0n ? Number((lpOut * 10_000n) / (res.lp + lpOut)) / 100 : 0 };
  }, [res, quoteIn]);
  const lpIn = useMemo(() => (lpBal * BigInt(pctOut)) / 100n, [lpBal, pctOut]);
  const removeQuote = useMemo(() => (res && lpIn > 0n ? OpenpumpClient.withdrawAmounts(lpIn, res.base, res.quote, res.lp) : null), [res, lpIn]);
  const yourShare = res && res.lp > 0n ? Number((lpBal * 10_000n) / res.lp) / 100 : 0;

  const go = async () => {
    if (!publicKey) return setVisible(true);
    if (!pool) return;
    setBusy(true);
    try {
      const slip = 100n; // 1 % on the amounts the program computes from live reserves
      let sig: string | null = null;
      if (mode === "add" && addQuote) {
        const ixs = await client.depositIxs(publicKey, pool, addQuote.lpOut, addQuote.base + (addQuote.base * slip) / 10_000n, addQuote.quote + (addQuote.quote * slip) / 10_000n);
        sig = await send(ixs, `Add ${qty(addQuote.quote, qDec, 3)} ${qSym} + ${fmtTokens(addQuote.base)} ${coin.symbol}`, { cu: 300_000 });
      } else if (mode === "remove" && removeQuote) {
        const ixs = await client.withdrawIxs(publicKey, pool, lpIn, removeQuote.base - (removeQuote.base * slip) / 10_000n, removeQuote.quote - (removeQuote.quote * slip) / 10_000n);
        sig = await send(ixs, `Remove ${pctOut}% of your liquidity`, { cu: 300_000 });
      }
      if (sig) { setAmt(""); onChanged?.(); }
    } finally { setBusy(false); }
  };

  return (
    <div className="panel p-3 text-[12px] text-mute space-y-2">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between">
        <span className="label">Liquidity · OpenSwap</span>
        <span className="text-[11px] num">{res ? <>{qty(res.quote, qDec, 2)} {qSym} · {fmtTokens(res.base)} {coin.symbol}</> : "…"} <span className="ml-1 text-dim">{open ? "▴" : "▾"}</span></span>
      </button>
      {open && (
        <>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <Cell k="LP supply" v={fmtTokens(res?.lp ?? 0n)} />
            <Cell k="Your LP" v={fmtTokens(lpBal)} />
            <Cell k="Your share" v={`${yourShare.toFixed(2)}%`} />
          </div>
          {boosting ? (
            <p className="text-[11px]">Deposits and withdrawals are locked while a boost is in flight ({qty(pool!.virtualQuoteReserves, qDec, 2)} {qSym} left to burn).</p>
          ) : (
            <>
              <div className="flex gap-1">
                {(["add", "remove"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={`pill flex-1 justify-center capitalize ${mode === m ? "pill-active" : ""}`}>{m}</button>
                ))}
              </div>
              {mode === "add" ? (
                <>
                  <div className="relative">
                    <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="0.0" className="input !h-10 pr-14 num" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-dim">{qSym}</span>
                  </div>
                  {addQuote && (
                    <div className="space-y-0.5">
                      <Row k={`+ ${coin.symbol} needed`} v={<span className={addQuote.base > tokBal ? "text-red" : ""}>{fmtTokens(addQuote.base)}{addQuote.base > tokBal ? " (you have " + fmtTokens(tokBal) + ")" : ""}</span>} />
                      <Row k="LP you receive" v={fmtTokens(addQuote.lpOut)} />
                      <Row k="Pool share after" v={`${addQuote.share.toFixed(2)}%`} />
                    </div>
                  )}
                  <button disabled={busy || !addQuote || addQuote.base > tokBal} onClick={go} className="btn btn-acc w-full !h-10">{publicKey ? "Add liquidity" : "Connect wallet"}</button>
                  <p className="text-[11px]">Adds at the current ratio: {qSym} plus the matching {coin.symbol}. LP earns {cfg.global.amm ? Number(cfg.global.amm.lpFeeBasisPoints) / 100 : 0.2}% of every swap.</p>
                </>
              ) : (
                <>
                  <div className="flex gap-1">
                    {[25, 50, 75, 100].map((p) => (
                      <button key={p} onClick={() => setPctOut(p)} className={`pill flex-1 justify-center ${pctOut === p ? "pill-active" : ""}`}>{p}%</button>
                    ))}
                  </div>
                  {removeQuote && lpIn > 0n && (
                    <div className="space-y-0.5">
                      <Row k={`You get ${qSym}`} v={qty(removeQuote.quote, qDec, 4)} />
                      <Row k={`You get ${coin.symbol}`} v={fmtTokens(removeQuote.base)} />
                      <Row k="LP burned" v={fmtTokens(lpIn)} />
                    </div>
                  )}
                  <button disabled={busy || lpIn <= 0n} onClick={go} className="btn btn-ghost w-full !h-10">{publicKey ? (lpBal > 0n ? "Remove liquidity" : "No LP in this wallet") : "Connect wallet"}</button>
                  {coin.bonding_curve && <p className="text-[11px]">Graduation liquidity is locked forever; only LP you added yourself can be removed.</p>}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

const Cell = ({ k, v }: { k: string; v: any }) => (
  <div className="rounded-lg bg-panel2 px-2 py-1.5"><div className="label !text-[9px]">{k}</div><div className="num text-ink font-semibold">{v}</div></div>
);
const Row = ({ k, v }: { k: string; v: any }) => (
  <div className="flex justify-between"><span>{k}</span><span className="text-ink num">{v}</span></div>
);
