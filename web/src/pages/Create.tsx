import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey } from "@solana/web3.js";
import { curve as curveMath } from "@openpump/sdk";
import { API, useConfig } from "../lib/api";
import { useClient, useSendTx, useToast } from "../lib/solana";
import { sol as fmtSol, tokens as fmtTokens } from "../lib/format";

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
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));

  const g = cfg?.global;
  const quote = useMemo(() => {
    if (!g || !devBuy || Number(devBuy) <= 0) return null;
    const c = { virtualSolReserves: BigInt(g.initialVirtualSolReserves), virtualTokenReserves: BigInt(g.initialVirtualTokenReserves), realSolReserves: 0n, realTokenReserves: BigInt(g.initialRealTokenReserves), tokenTotalSupply: BigInt(g.tokenTotalSupply), complete: false };
    try {
      const q = curveMath.quoteBuyExactSol(BigInt(Math.floor(Number(devBuy) * 1e9)), c, { feeBasisPoints: BigInt(g.feeBasisPoints), creatorFeeBasisPoints: BigInt(g.creatorFeeBasisPoints) });
      return { ...q, pct: (Number(q.tokensOut) / Number(g.tokenTotalSupply)) * 100 };
    } catch { return null; }
  }, [devBuy, g]);

  const onFile = (file: File | null) => {
    setFile(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  };

  const valid = f.name.trim().length > 0 && f.name.length <= 32 && /^[A-Za-z0-9$._-]{1,10}$/.test(f.symbol) && !!file;

  const submit = async () => {
    if (!publicKey) return setVisible(true);
    if (!valid || !cfg) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file!);
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      const up = await fetch(`${API}/api/upload`, { method: "POST", body: fd });
      if (!up.ok) throw new Error((await up.json()).error || "upload failed");
      const { uri } = await up.json();

      const mintKp = Keypair.generate();
      const ixs = [await client.createIx(publicKey, mintKp.publicKey, f.name.trim(), f.symbol.trim().toUpperCase(), uri)];
      if (quote) ixs.push(await client.buyExactSolIx(publicKey, mintKp.publicKey, publicKey, new PublicKey(cfg.global.feeRecipient!), BigInt(Math.floor(Number(devBuy) * 1e9)), (quote.tokensOut * 97n) / 100n));
      const sig = await send(ixs, `Launch ${f.symbol.toUpperCase()}`, { cu: 400_000, signers: [mintKp] });
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
              <input className="input" placeholder="People Coin" maxLength={32} value={f.name} onChange={set("name")} />
            </div>
            <div>
              <div className="label mb-1">Ticker</div>
              <input className="input uppercase" placeholder="PEOPLE" maxLength={10} value={f.symbol} onChange={set("symbol")} />
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

      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-head font-semibold text-[14px]">Buy on launch <span className="text-dim font-normal text-[12px]">(optional)</span></div>
            <div className="text-[12px] text-mute">Be the first buyer in the same transaction. Snipers can't front-run you.</div>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input value={devBuy} onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.0" className="input num pr-14" />
            <span className="absolute right-3 top-3 text-[12px] font-semibold text-mute">SOL</span>
          </div>
          {[0.5, 1, 2].map((q) => <button key={q} onClick={() => setDevBuy(String(q))} className="pill !h-11 !px-3">{q}</button>)}
        </div>
        {quote && (
          <div className="text-[12px] text-mute rounded-xl bg-black/30 border border-line p-3 flex justify-between">
            <span>You receive <b className="text-ink num">{fmtTokens(quote.tokensOut)}</b> tokens (<span className="num">{quote.pct.toFixed(2)}%</span> of supply)</span>
            <span>Total <b className="text-ink num">{fmtSol(quote.totalCost, 4)} SOL</b></span>
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
