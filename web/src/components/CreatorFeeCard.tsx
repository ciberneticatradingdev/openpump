import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import type { Coin, Config } from "../lib/api";
import { useClient, useSendTx } from "../lib/solana";

/** Creator-only: set your creator fee (0 = follow the schedule) within the protocol ceiling, or lock it. */
export default function CreatorFeeCard({ coin, cfg, currentBps }: { coin: Coin; cfg: Config; currentBps: number }) {
  const { publicKey } = useWallet();
  const client = useClient();
  const send = useSendTx();
  const qc = useQueryClient();
  const [pct, setPct] = useState(String(currentBps / 100));
  const [busy, setBusy] = useState(false);
  if (!publicKey || publicKey.toBase58() !== coin.creator || coin.is_holder_reward) return null;
  const maxPct = 1; // mirrors Global.max_configurable_creator_fee_bps default (100 bps); the program enforces the real ceiling
  const apply = async (lock: boolean) => {
    const bps = Math.round(Number(pct) * 100);
    if (!(bps >= 0 && bps <= 10_000)) return;
    setBusy(true);
    try {
      const sig = await send([await client.setCreatorFeeBpsIx(publicKey, new PublicKey(coin.mint), BigInt(bps), lock)], lock ? "Lock creator fee" : "Set creator fee");
      if (sig) setTimeout(() => qc.invalidateQueries({ queryKey: ["coin", coin.mint] }), 1500);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel p-3 text-[12px] text-mute space-y-2">
      <div className="label">Your creator fee</div>
      <p>Default follows the market-cap schedule. You can set a fixed % up to {maxPct}% (protocol ceiling), or lock it so holders know it can never change.</p>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <input className="input !h-9 num pr-8" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9.]/g, ""))} />
          <span className="absolute right-3 top-2 text-dim">%</span>
        </div>
        <button onClick={() => apply(false)} disabled={busy} className="btn btn-ghost !h-9 !px-3 !text-[12px]">Set</button>
        <button onClick={() => apply(true)} disabled={busy} className="btn btn-ghost !h-9 !px-3 !text-[12px]">Lock</button>
      </div>
      <p className="text-[11px] text-dim">0 = schedule. Only the current creator wallet can change this.</p>
    </div>
  );
}
