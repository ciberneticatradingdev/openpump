import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey } from "@solana/web3.js";
import { curve as curveMath } from "@openpump/sdk";
import { API, WSOL, useConfig, type QuoteMintInfo } from "../lib/api";
import { useClient, useSendTx, useToast } from "../lib/solana";
import { qty, tokens as fmtTokens } from "../lib/format";

export default function CreatePage() {
  const { data: cfg } = useConfig();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useClient();
  const send = useSendTx();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", symbol: "", description: "", twitter: "", telegram: "", website: "" });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [devBuy, setDevBuy] = useState("");
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<QuoteMintInfo | null>(null);
  const [holderRewards, setHolderRewards] = useState(false);
  const [quoteCfg, setQuoteCfg] = useState<{ initialVirtualQuoteReserves: bigint; initialVirtualTokenReserves: bigint; initialRealTokenReserves: bigint; enabled: boolean } | null>(null);
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));

  const pairs = cfg?.quoteMints ?? [];
  useEffect(() => { if (!pair && pairs.length) setPair(pairs[0]); }, [pairs, pair]);
  const v2 = !!pair && pair.mint !== WSOL;

  // custom pairs carry their own curve parameters on-chain
  useEffect(() => {
    if (!v2 || !pair) return setQuoteCfg(null);
    client.fetchQuoteConfig(new PublicKey(pair.mint)).then((q) => setQuoteCfg(q ? { ...q } : null)).catch(() => setQuoteCfg(null));
  }, [v2, pair, client]);

  const g = cfg?.global;
  const qDec = pair?.decimals ?? 9;
  const qSym = pair?.symbol ?? "SOL";
  const curveState = useMemo(() => {
    if (!g) return null;
    if (v2) {
      if (!quoteCfg) return null;
      return { virtualSolReserves: quoteCfg.initialVirtualQuoteReserves, virtualTokenReserves: quoteCfg.initialVirtualTokenReserves, realSolReserves: 0n, realTokenReserves: quoteCfg.initialRealTokenReserves, tokenTotalSupply: BigInt(g.tokenTotalSupply), complete: false };
    }
    return { virtualSolReserves: BigInt(g.initialVirtualSolReserves), virtualTokenReserves: BigInt(g.initialVirtualTokenReserves), realSolReserves: 0n, realTokenReserves: BigInt(g.initialRealTokenReserves), tokenTotalSupply: BigInt(g.tokenTotalSupply), complete: false };
  }, [g, v2, quoteCfg]);

  const quote = useMemo(() => {
    if (!g || !curveState || !devBuy || Number(devBuy) <= 0) return null;
    try {
      const q = curveMath.quoteBuyExactSol(BigInt(Math.floor(Number(devBuy) * 10 ** qDec)), curveState, { feeBasisPoints: BigInt(g.feeBasisPoints), creatorFeeBasisPoints: BigInt(g.creatorFeeBasisPoints) });
      return { ...q, pct: (Number(q.tokensOut) / Number(g.tokenTotalSupply)) * 100 };
    } catch { return null; }
  }, [devBuy, g, curveState, qDec]);

  const onFile = (file: File | null) => {
    setFile(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  };

  const valid = f.name.trim().length > 0 && f.name.length <= 32 && /^[A-Za-z0-9$._-]{1,10}$/.test(f.symbol) && !!file && (!v2 || !!quoteCfg?.enabled);

  const submit = async () => {
    if (!publicKey) return setVisible(true);
    if (!valid || !cfg || !pair) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file!);
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      const up = await fetch(`${API}/api/upload`, { method: "POST", body: fd });
      if (!up.ok) throw new Error((await up.json()).error || "upload failed");
      const { uri } = await up.json();

      const mintKp = Keypair.generate();
      const name = f.name.trim();
      const symbol = f.symbol.trim().toUpperCase();
      const feeRecipient = new PublicKey(cfg.global.feeRecipient!);
      const ixs = v2
        ? [await client.createV2Ix(publicKey, mintKp.publicKey, new PublicKey(pair.mint), name, symbol, uri, holderRewards)]
        : [await client.createIx(publicKey, mintKp.publicKey, name, symbol, uri, holderRewards)];
      if (quote) {
        const units = BigInt(Math.floor(Number(devBuy) * 10 ** qDec));
        const minOut = (quote.tokensOut * 97n) / 100n;
        ixs.push(
          v2
            ? await client.buyExactQuoteInIx(publicKey, mintKp.publicKey, publicKey, feeRecipient, new PublicKey(pair.mint), units, minOut)
            : await client.buyExactSolIx(publicKey, mintKp.publicKey, publicKey, feeRecipient, units, minOut)
        );
      }
      const sig = await send(ixs, `Launch ${symbol}`, { cu: 400_000, signers: [mintKp] });
      if (sig) {
        toast.push({ kind: "ok", title: "Coin is live", body: "The board updates in a few seconds." });
        setTimeout(() => nav(`/coin/${mintKp.publicKey.toBase58()}`), 1500);
      }
    } catch (e: any) {
      toast.push({ kind: "err", title: "Launch failed", body: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[680px] mx-auto space-y-3">
      <div className="px-1">
        <h1 className="font-head font-bold text-[24px] tracking-tight">Launch a coin</h1>
        <p className="text-mute text-[13px] mt-1">One transaction. Mint authority is revoked, the full supply goes on the curve, and you earn <b className="text-ink">{g ? Number(g.creatorFeeBasisPoints) / 100 : 0.5}%</b> of every trade from the first one.</p>
      </div>

      <div className="panel p-4 space-y-4">
        <div className="grid grid-cols-[112px_1fr] gap-4">
          <label className="relative w-28 h-28 rounded-2xl border border-dashed border-line2 bg-black/30 grid place-items-center cursor-pointer overflow-hidden hover:border-acc/50">
            {preview ? <img src={preview} className="w-full h-full object-cover" /> : <span className="text-[11px] text-dim text-center px-2">drop image<br />png / jpg / gif</span>}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
          </label>
          <div className="space-y-3">
            <div>
              <div className="label mb-1">Name</div>
              <input className="input" placeholder="OpenPump Coin" maxLength={32} value={f.name} onChange={set("name")} />
            </div>
            <div>
              <div className="label mb-1">Ticker</div>
              <input className="input uppercase" placeholder="OPEN" maxLength={10} value={f.symbol} onChange={set("symbol")} />
            </div>
          </div>
        </div>
        <div>
          <div className="label mb-1">Description</div>
          <textarea className="input !h-24 py-2 resize-none" placeholder="What is this coin about?" maxLength={500} value={f.description} onChange={set("description")} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(["twitter", "telegram", "website"] as const).map((k) => (
            <div key={k}>
              <div className="label mb-1">{k === "twitter" ? "X / Twitter" : k} <span className="text-dim normal-case tracking-normal">(optional)</span></div>
              <input className="input !h-10 text-[13px]" placeholder="https://" value={(f as any)[k]} onChange={set(k)} />
            </div>
          ))}
        </div>
      </div>

      {/* pair */}
      <div className="panel p-4 space-y-3">
        <div>
          <div className="font-head font-semibold text-[14px]">Trading pair</div>
          <div className="text-[12px] text-mute">What your coin is priced and traded in, on the curve and on the AMM after graduation.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pairs.map((p) => (
            <button key={p.mint} onClick={() => setPair(p)} className={`pill !h-9 !px-3 ${pair?.mint === p.mint ? "pill-active" : ""}`}>
              {p.symbol}
              {p.mint === WSOL ? <span className="text-dim font-normal">native</span> : <span className="text-dim font-normal">custom pair</span>}
            </button>
          ))}
          {pairs.length <= 1 && <span className="text-[12px] text-dim self-center">No custom pairs enabled on this cluster yet.</span>}
        </div>
        {v2 && quoteCfg && (
          <div className="text-[12px] text-mute rounded-xl bg-black/30 border border-line p-3">
            Starts at <b className="text-ink num">{qty(quoteCfg.initialVirtualQuoteReserves, qDec, 0)} {qSym}</b> virtual liquidity · graduates after ~<b className="text-ink num">{qty(curveMath.solInForTokensOut(quoteCfg.initialRealTokenReserves, { ...curveState! }), qDec, 0)} {qSym}</b> is raised.
          </div>
        )}
        {v2 && !quoteCfg && <div className="text-[12px] text-red">This pair is not configured on-chain yet.</div>}
      </div>

      {/* creator rewards recipient */}
      <div className="panel p-4 space-y-3">
        <div>
          <div className="font-head font-semibold text-[14px]">Creator rewards go to</div>
          <div className="text-[12px] text-mute">{g ? Number(g.creatorFeeBasisPoints) / 100 : 0.5}% of every trade, on the curve and on the AMM. Choose who receives it; this cannot be changed later.</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setHolderRewards(false)} className={`rounded-xl border p-3 text-left transition ${!holderRewards ? "border-acc/50 bg-acc/10" : "border-line hover:border-line2"}`}>
            <div className="font-semibold text-[13px]">You (the creator)</div>
            <div className="text-[11px] text-mute mt-0.5">Claim any time from your profile.</div>
          </button>
          <button onClick={() => setHolderRewards(true)} className={`rounded-xl border p-3 text-left transition ${holderRewards ? "border-acc/50 bg-acc/10" : "border-line hover:border-line2"}`}>
            <div className="font-semibold text-[13px]">Holders <span className="text-[10px] font-bold uppercase tracking-wider text-acc bg-acc/10 border border-acc/30 rounded-full px-1.5 py-0.5 ml-1">rewards → holders</span></div>
            <div className="text-[11px] text-mute mt-0.5">Paid out pro-rata to the top holders every few minutes. You earn nothing as creator.</div>
          </button>
        </div>
      </div>

      <div className="panel p-4 space-y-3">
        <div>
          <div className="font-head font-semibold text-[14px]">Buy on launch <span className="text-dim font-normal text-[12px]">(optional)</span></div>
          <div className="text-[12px] text-mute">Be the first buyer in the same transaction. Snipers can't front-run you.</div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input value={devBuy} onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.0" className="input num pr-20" />
            <span className="absolute right-3 top-3 text-[12px] font-semibold text-mute">{qSym}</span>
          </div>
          {(v2 ? [100, 1000, 10000] : [0.5, 1, 2]).map((q) => <button key={q} onClick={() => setDevBuy(String(q))} className="pill !h-11 !px-3">{q >= 1000 ? `${q / 1000}K` : q}</button>)}
        </div>
        {quote && (
          <div className="text-[12px] text-mute rounded-xl bg-black/30 border border-line p-3 flex justify-between">
            <span>You receive <b className="text-ink num">{fmtTokens(quote.tokensOut)}</b> tokens (<span className="num">{quote.pct.toFixed(2)}%</span> of supply)</span>
            <span>Total <b className="text-ink num">{qty(quote.totalCost, qDec, 4)} {qSym}</b></span>
          </div>
        )}
      </div>

      <div className="panel p-4 flex flex-wrap items-center gap-3">
        <div className="text-[12px] text-mute flex-1 min-w-[200px]">
          <div>Launch cost: <b className="text-ink">~0.02 SOL</b> rent (mint, curve, metadata) + network fee. No platform fee to launch.</div>
          <div className="mt-0.5">Supply 1,000,000,000 · 6 decimals · mint authority revoked · metadata immutable.</div>
        </div>
        <button onClick={submit} disabled={busy || (!!publicKey && !valid)} className="btn btn-acc !h-11 px-6">
          {!publicKey ? "Connect wallet" : busy ? "Launching…" : "Launch coin"}
        </button>
      </div>
    </div>
  );
}
