import { Link } from "react-router-dom";
import { useActivity } from "../lib/api";
import { useLiveTrades } from "../lib/ws";
import { short, sol } from "../lib/format";
import Avatar from "./Avatar";

/** Live trade tape: recent trades from the API, then live ones prepended via WS. */
export default function Ticker() {
  const { data } = useActivity(24);
  const live = useLiveTrades(24);
  const items = [
    ...live.map((t) => ({ key: t.sig, mint: t.mint, isBuy: t.isBuy, sol: t.sol, user: t.user, symbol: undefined as string | undefined, image: null as string | null })),
    ...(data || []).map((t) => ({ key: t.id, mint: t.mint, isBuy: !!t.is_buy, sol: t.sol, user: t.user, symbol: t.symbol, image: t.image ?? null })),
  ].slice(0, 30);
  if (!items.length) return null;
  return (
    <div className="panel overflow-hidden h-10 flex items-center">
      <div className="px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-dim border-r border-line h-full flex items-center shrink-0 gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-acc animate-pulse" /> live
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div className="flex items-center gap-2 px-2 whitespace-nowrap animate-[tape_60s_linear_infinite] hover:[animation-play-state:paused]" style={{ width: "max-content" }}>
          {[...items, ...items].map((t, i) => (
            <Link key={t.key + i} to={`/coin/${t.mint}`} className="flex items-center gap-2 pl-1 pr-2.5 h-7 rounded-full border border-line bg-black/20 hover:bg-panel2 text-[12px]">
              <Avatar src={t.image} name={t.symbol || t.mint} size={18} />
              <span className="text-mute">{short(t.user, 3)}</span>
              <span className={`font-semibold ${t.isBuy ? "text-acc" : "text-red"}`}>{t.isBuy ? "bought" : "sold"}</span>
              <span className="num">{sol(t.sol)} SOL</span>
              {t.symbol && <span className="text-mute">of {t.symbol}</span>}
            </Link>
          ))}
        </div>
      </div>
      <style>{`@keyframes tape { from { transform: translateX(0);} to { transform: translateX(-50%);} }`}</style>
    </div>
  );
}
