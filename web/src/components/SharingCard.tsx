import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { WSOL, type Coin, type Sharing } from "../lib/api";
import { useClient, useSendTx } from "../lib/solana";
import { qty, short } from "../lib/format";

/** Creator fee sharing: start, view, split, pay out, lock. Shown on the coin page. */
export default function SharingCard({ coin, sharing }: { coin: Coin; sharing: Sharing | null }) {
  const { publicKey } = useWallet();
  const client = useClient();
  const send = useSendTx();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<{ address: string; pct: string }[]>([]);
  const me = publicKey?.toBase58();
  const isCreatorWallet = coin.creator_kind === "wallet" && me === coin.creator;
  const isAdmin = !!sharing?.exists && me === sharing.admin && !sharing.adminRevoked;
  const qDec = coin.quote_decimals ?? 9;
  const qSym = coin.quote_symbol || "SOL";
  const mint = new PublicKey(coin.mint);
  const refresh = () => setTimeout(() => { qc.invalidateQueries({ queryKey: ["sharing", coin.mint] }); qc.invalidateQueries({ queryKey: ["coin", coin.mint] }); }, 1500);

  const start = async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const sig = await send([await client.createFeeSharingConfigIx(publicKey, mint, !!coin.migrated, new PublicKey(coin.quote_mint || WSOL))], "Start fee sharing", { cu: 300_000 });
      if (sig) refresh();
    } finally { setBusy(false); }
  };
  const distribute = async () => {
    if (!publicKey || !sharing?.shareholders) return;
    setBusy(true);
    try {
      const holders = sharing.shareholders.map((s) => new PublicKey(s.address));
      const ixs = [await client.distributeCreatorFeesIx(mint, holders, new PublicKey(coin.quote_mint || WSOL), publicKey)];
      if (coin.migrated) {
        const pool = coin.pool ? await client.fetchPoolByAddress(new PublicKey(coin.pool)) : await client.fetchPool(mint, new PublicKey(coin.quote_mint || WSOL));
        if (pool) ixs.push(await client.distributeCoinCreatorFeesIx(publicKey, mint, pool, holders));
      }
      const sig = await send(ixs, "Pay out shared fees", { cu: 400_000 });
      if (sig) refresh();
    } finally { setBusy(false); }
  };
  const saveSplit = async () => {
    if (!publicKey) return;
    const shareholders = rows.filter((r) => r.address && Number(r.pct) > 0).map((r) => ({ address: new PublicKey(r.address.trim()), shareBps: Math.round(Number(r.pct) * 100) }));
    const total = shareholders.reduce((a, s) => a + s.shareBps, 0);
    if (total !== 10000) return alert(`Shares must total 100% (now ${total / 100}%)`);
    setBusy(true);
    try {
      const sig = await send([await client.updateFeeSharesIx(publicKey, mint, shareholders)], "Update fee split");
      if (sig) { setEditing(false); refresh(); }
    } finally { setBusy(false); }
  };
  const lock = async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const sig = await send([await client.revokeFeeSharingIx(publicKey, mint)], "Lock fee split forever");
      if (sig) refresh();
    } finally { setBusy(false); }
  };

  if (!sharing?.exists) {
    if (!isCreatorWallet) return null;
    return (
      <div className="panel p-3 text-[12px] text-mute space-y-2">
        <div className="label">Fee sharing</div>
        <p>Split your creator fee with partners, a community wallet or a charity. Starts at 100% to you; you set the split after.</p>
        <button onClick={start} disabled={busy} className="btn btn-ghost w-full !h-9">Start fee sharing</button>
      </div>
    );
  }
  const pending = BigInt(sharing.pendingCurve || "0") + BigInt(sharing.pendingAmm || "0");
  return (
    <div className="panel p-3 text-[12px] text-mute space-y-2">
      <div className="flex items-center justify-between">
        <span className="label">Fee sharing</span>
        {sharing.adminRevoked ? <span className="text-[10px] uppercase tracking-wider text-dim">locked</span> : <span className="text-[10px] uppercase tracking-wider text-acc">open</span>}
      </div>
      {!editing && (
        <div className="space-y-1">
          {sharing.shareholders?.map((s) => (
            <div key={s.address} className="flex justify-between num"><span>{short(s.address, 5)}{s.address === me && <span className="text-acc"> (you)</span>}</span><span className="text-ink">{(s.shareBps / 100).toFixed(1)}%</span></div>
          ))}
        </div>
      )}
      {editing && (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-1.5">
              <input className="input !h-8 text-[12px] num flex-1" placeholder="wallet" value={r.address} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} />
              <input className="input !h-8 text-[12px] num w-16" placeholder="%" value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
            </div>
          ))}
          <div className="flex gap-1.5">
            <button onClick={() => setRows([...rows, { address: "", pct: "" }])} className="pill !h-7">+ wallet</button>
            <button onClick={saveSplit} disabled={busy} className="btn btn-acc !h-7 !px-3 !text-[12px]">Save split</button>
            <button onClick={() => setEditing(false)} className="pill !h-7">Cancel</button>
          </div>
          <p className="text-[11px] text-dim">Up to 10 wallets, must total 100%. Pending fees must be paid out first.</p>
        </div>
      )}
      <div className="flex justify-between"><span>Pending payout</span><span className="text-ink num">{qty(pending, qDec, 4)} {qSym}</span></div>
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={distribute} disabled={busy || pending === 0n || !publicKey} className="btn btn-ghost !h-8 !px-3 !text-[12px]">Pay out</button>
        {isAdmin && !editing && <button onClick={() => { setRows((sharing.shareholders || []).map((s) => ({ address: s.address, pct: String(s.shareBps / 100) }))); setEditing(true); }} disabled={busy} className="btn btn-ghost !h-8 !px-3 !text-[12px]">Edit split</button>}
        {isAdmin && <button onClick={lock} disabled={busy} className="btn btn-ghost !h-8 !px-3 !text-[12px]">Lock</button>}
      </div>
    </div>
  );
}
