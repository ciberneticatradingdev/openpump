import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { WSOL, useCoins, useConfig, type Coin } from "../lib/api";
import { useClient, useSendTx } from "../lib/solana";
import { tokens as fmtTokens } from "../lib/format";
import Avatar from "../components/Avatar";

/** Coin -> coin in one transaction (pump.fun multi-hop). Both coins must be SOL-quoted. */
export default function SwapPage() {
  const { data: cfg } = useConfig();
  const { data: coins } = useCoins("mcap", "", 200);
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const client = useClient();
  const send = useSendTx();
  const [fromMint, setFromMint] = useState<string>("");
  const [toMint, setToMint] = useState<string>("");
  const [q, setQ] = useState("");
  const [amt, setAmt] = useState("");
  const [bal, setBal] = useState(0n);
  const [quote, setQuote] = useState<{ out: bigint; legs: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const sol = (coins || []).filter((c) => c.quote_mint === WSOL || !c.quote_mint);
  const from = sol.find((c) => c.mint === fromMint) || null;
  const to = sol.find((c) => c.mint === toMint) || null;
  const candidates = useMemo(() => sol.filter((c) => c.mint !== fromMint && (!q || c.symbol.toLowerCase().includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 8), [sol, fromMint, q]);

  useEffect(() => {
    if (!publicKey || !from) return setBal(0n);
    const tp = new PublicKey(from.token_program || TOKEN_PROGRAM_ID.toBase58());
    connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(from.mint), publicKey, false, tp), "confirmed").then((r) => setBal(BigInt(r.value.amount))).catch(() => setBal(0n));
  }, [publicKey, from, connection]);

  const legState = async (c: Coin) => {
    const mint = new PublicKey(c.mint);
    client.setCoinTokenProgram(mint, new PublicKey(c.token_program || TOKEN_PROGRAM_ID.toBase58()));
    const pool = c.migrated ? await client.fetchPool(mint) : null;
    const curve = c.migrated ? null : { virtualSolReserves: BigInt(c.v_sol), virtualTokenReserves: BigInt(c.v_tok), realSolReserves: BigInt(c.r_sol), realTokenReserves: BigInt(c.r_tok), tokenTotalSupply: BigInt(c.supply), complete: !!c.complete };
    return { mint, creator: new PublicKey(c.creator), pool, curve };
  };

  const build = async () => {
    if (!cfg || !from || !to || !publicKey) return null;
    const g = cfg.global;
    const units = BigInt(Math.floor(Number(amt) * 1e6));
    if (units <= 0n) return null;
    const fees = { feeBasisPoints: BigInt(g.feeBasisPoints), creatorFeeBasisPoints: BigInt(g.creatorFeeBasisPoints) };
    const ammFees = { lpFeeBasisPoints: BigInt(g.amm?.lpFeeBasisPoints || 20), protocolFeeBasisPoints: BigInt(g.amm?.protocolFeeBasisPoints || 5), coinCreatorFeeBasisPoints: BigInt(g.amm?.coinCreatorFeeBasisPoints || 5) };
    const [a, b] = await Promise.all([legState(from), legState(to)]);
    const r = await client.routeIxs(publicKey, a, b, units, 200n, new PublicKey(g.feeRecipient!), new PublicKey(g.amm!.protocolFeeRecipient), fees, ammFees);
    return { ...r, legs: `${a.pool ? "AMM" : "curve"} → SOL → ${b.pool ? "AMM" : "curve"}${a.pool && b.pool ? " (one on-chain route)" : ""}` };
  };

  useEffect(() => {
    let alive = true;
    if (!publicKey || !from || !to || !amt) return setQuote(null);
    build().then((r) => alive && setQuote(r ? { out: r.expectedOut, legs: r.legs } : null)).catch(() => alive && setQuote(null));
    return () => { alive = false; };
  }, [from, to, amt, publicKey]);

  const submit = async () => {
    if (!publicKey) return setVisible(true);
    setBusy(true);
    try {
      const r = await build();
      if (!r) return;
      await send(r.ixs, `Swap ${from!.symbol} → ${to!.symbol}`, { cu: 500_000 });
      setAmt("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[680px] mx-auto space-y-3">
      <div className="px-1">
        <h1 className="font-head font-bold text-[24px] tracking-tight">Swap coin → coin</h1>
        <p className="text-mute text-[13px] mt-1">Any OpenPump coin into any other, in one transaction. Graduated pairs route on-chain through the AMM; bonding-curve legs sell and buy within the same transaction.</p>
      </div>
      <div className="panel p-4 space-y-3">
        <div>
          <div className="label mb-1">From</div>
          <div className="flex flex-wrap gap-1.5">
            {sol.slice(0, 12).map((c) => (
              <button key={c.mint} onClick={() => setFromMint(c.mint)} className={`pill !h-8 ${fromMint === c.mint ? "pill-active" : ""}`}>
                <Avatar src={c.image} name={c.symbol} size={16} /> {c.symbol}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.0" className="input !h-12 !text-[18px] num pr-28" />
          <span className="absolute right-3 top-3.5 text-[12px] font-semibold text-mute">{from?.symbol || "—"}</span>
          {from && publicKey && <button onClick={() => setAmt((Number(bal) / 1e6).toString())} className="absolute right-20 top-3.5 text-[11px] text-acc">max {fmtTokens(bal)}</button>}
        </div>
        <div>
          <div className="label mb-1">To</div>
          <input className="input !h-9 text-[13px] mb-1.5" placeholder="search coin…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((c) => (
              <button key={c.mint} onClick={() => setToMint(c.mint)} className={`pill !h-8 ${toMint === c.mint ? "pill-active" : ""}`}>
                <Avatar src={c.image} name={c.symbol} size={16} /> {c.symbol}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-panel2 border border-line p-3 text-[12px] text-mute space-y-1">
          <div className="flex justify-between"><span>You receive (est.)</span><span className="text-ink num font-semibold">{quote ? `${fmtTokens(quote.out)} ${to?.symbol}` : "–"}</span></div>
          <div className="flex justify-between"><span>Route</span><span className="text-ink">{quote?.legs || "–"}</span></div>
          <div className="flex justify-between"><span>Slippage</span><span className="text-ink">2%</span></div>
        </div>
        <button onClick={submit} disabled={busy || (!!publicKey && !quote)} className="btn btn-acc w-full !h-11">{!publicKey ? "Connect wallet" : busy ? "Swapping…" : "Swap"}</button>
      </div>
    </div>
  );
}
