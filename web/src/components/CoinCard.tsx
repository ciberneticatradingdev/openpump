import { Link } from "react-router-dom";
import type { Coin } from "../lib/api";
import { ago, qty, short } from "../lib/format";
import Avatar from "./Avatar";
import Progress from "./Progress";

export function progressOf(c: Coin, initialReal: string | undefined) {
  if (c.migrated || c.complete) return 100;
  const init = Number(initialReal || "793100000000000");
  return ((init - Number(c.r_tok)) / init) * 100;
}

export default function CoinCard({ c, initialReal, flash }: { c: Coin; initialReal?: string; flash?: "up" | "down" | null }) {
  const p = progressOf(c, initialReal);
  const graduated = !!c.migrated;
  return (
    <Link to={`/coin/${c.mint}`} className={`block rounded-xl2 border border-transparent hover:border-line2 hover:bg-panel2 transition p-2.5 ${flash ? `flash-${flash}` : ""}`}>
      <div className="flex items-start gap-3">
        <Avatar src={c.image} name={c.symbol} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-head font-semibold text-[14px] truncate">{c.symbol}</span>
            <span className="text-mute text-[12px] truncate">{c.name}</span>
            {c.quote_symbol && c.quote_symbol !== "SOL" && <span className="text-[10px] font-semibold text-mute border border-line rounded-full px-1.5 py-0.5">/{c.quote_symbol}</span>}
            {graduated && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-acc bg-acc/10 border border-acc/30 rounded-full px-1.5 py-0.5">AMM</span>}
            {!graduated && c.complete === 1 && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-gold bg-gold/10 border border-gold/30 rounded-full px-1.5 py-0.5">graduating</span>}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-dim mt-0.5">
            <span>by {short(c.creator)}</span>
            <span>·</span>
            <span>{ago(c.created_at)}</span>
            {c.trades > 0 && (
              <>
                <span>·</span>
                <span>{c.trades} trades</span>
              </>
            )}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[12px] text-mute">
              MC <span className="text-ink font-semibold num">{qty(c.mcap, c.quote_decimals ?? 9, 1)} {c.quote_symbol || "SOL"}</span>
            </span>
            {!graduated && <span className="text-[11px] num text-dim">{qty(c.r_sol, c.quote_decimals ?? 9, 1)} {c.quote_symbol || "SOL"} raised</span>}
            {graduated && <span className="text-[11px] num text-dim">pool {qty(c.pool_quote || 0, c.quote_decimals ?? 9, 1)} {c.quote_symbol || "SOL"}</span>}
          </div>
          {!graduated && <Progress value={p} className="mt-1.5" color={c.complete ? "bg-gold" : "bg-acc"} />}
        </div>
      </div>
    </Link>
  );
}

export function CoinCardSkeleton() {
  return (
    <div className="p-2.5 flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl shimmer" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-1/2 rounded shimmer" />
        <div className="h-2.5 w-1/3 rounded shimmer" />
        <div className="h-1.5 w-full rounded shimmer" />
      </div>
    </div>
  );
}
