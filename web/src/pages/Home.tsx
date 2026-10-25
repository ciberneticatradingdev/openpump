import { useState } from "react";
import { Link } from "react-router-dom";
import { useCoins, useConfig, useStats, type Coin } from "../lib/api";
import { useLive } from "../lib/ws";
import { qty, sol } from "../lib/format";
import CoinCard, { CoinCardSkeleton } from "../components/CoinCard";
import Ticker from "../components/Ticker";
import { BRAND } from "../lib/brand";

type Col = { key: string; title: string; hint: string; sort: string; filter?: (c: Coin) => boolean };
const COLS: Col[] = [
  { key: "new", title: "New", hint: "just launched", sort: "new", filter: (c) => !c.migrated },
  { key: "graduating", title: "About to graduate", hint: "closest to the AMM", sort: "graduating", filter: (c) => !c.migrated },
  { key: "graduated", title: "Graduated", hint: "trading on the AMM", sort: "graduated" },
];

export default function Home() {
  const { data: cfg } = useConfig();
  const { data: stats } = useStats();
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  useLive((m) => {
    if (m.type === "trade") {
      setFlash((f) => ({ ...f, [m.mint]: m.isBuy ? "up" : "down" }));
      setTimeout(() => setFlash((f) => { const { [m.mint]: _, ...rest } = f; return rest; }), 1300);
    }
  });
  const initialReal = cfg?.global.initialRealTokenReserves;

  return (
    <div className="space-y-3">
      <Ticker />

      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="font-head font-bold text-[22px] sm:text-[26px] tracking-tight leading-none">{BRAND.tagline}</h1>
          <p className="text-mute text-[13px] mt-1.5">
            Open-source pump.fun. Launch a coin in one click. Creators earn <b className="text-ink">{cfg ? Number(cfg.global.creatorFeeBasisPoints) / 100 : 0.5}%</b> of every trade from trade one. Graduation at ~85 SOL moves everything into an AMM with the LP burned.
            {" "}<Link to="/how-it-works" className="text-acc hover:underline">How it works →</Link>
          </p>
        </div>
        {stats && (
          <div className="flex gap-2 text-[12px] num">
            <Stat k="coins" v={stats.coins} />
            <Stat k="graduated" v={stats.graduated} />
            <Stat k="trades 24h" v={stats.trades24h} />
            <Stat k="vol 24h" v={`${sol(stats.volume24h, 1)} SOL`} />
          </div>
        )}
      </div>

      {cfg?.incentives?.active && (
        <Link to="/profile" className="panel panel-hover px-4 py-2.5 flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-acc bg-acc/10 border border-acc/30 rounded-full px-1.5 py-0.5">trade to earn</span>
          <span>Day {(cfg.incentives.today ?? 0) + 1}: <b className="num">{qty(cfg.incentives.supplyToday, cfg.incentives.decimals, 0)} {cfg.incentives.symbol}</b> split by SOL buy volume on bonding curves.</span>
          <span className="text-mute num">{sol(cfg.incentives.volumeToday, 2)} SOL traded today</span>
          <span className="ml-auto text-acc">Your rewards →</span>
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {COLS.map((col) => (
          <Column key={col.key} col={col} initialReal={initialReal} flash={flash} />
        ))}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: any }) {
  return (
    <div className="panel px-3 py-1.5 min-w-[84px]">
      <div className="label">{k}</div>
      <div className="font-semibold text-[14px]">{v}</div>
    </div>
  );
}

function Column({ col, initialReal, flash }: { col: Col; initialReal?: string; flash: Record<string, "up" | "down"> }) {
  const { data, isLoading } = useCoins(col.sort, "", 40);
  const items = (data || []).filter(col.filter || (() => true));
  return (
    <section className="panel flex flex-col min-h-[420px] lg:h-[calc(100vh-290px)] lg:min-h-[560px]">
      <header className="flex items-center gap-2 px-3 h-11 border-b border-line shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${col.key === "graduated" ? "bg-acc" : col.key === "graduating" ? "bg-gold" : "bg-ink/60"}`} />
        <h2 className="font-head font-semibold text-[14px]">{col.title}</h2>
        <span className="text-[11px] text-dim">{col.hint}</span>
        <span className="ml-auto text-[11px] text-dim num">{items.length}</span>
      </header>
      <div className="flex-1 overflow-y-auto p-1.5 pb-20 space-y-0.5">
        {isLoading && Array.from({ length: 6 }).map((_, i) => <CoinCardSkeleton key={i} />)}
        {!isLoading && items.length === 0 && (
          <div className="h-full grid place-items-center text-center text-dim text-[13px] p-6">
            {col.key === "new" ? (
              <div>
                Nothing here yet.
                <br />
                <Link to="/create" className="text-acc hover:underline">Launch the first coin →</Link>
              </div>
            ) : (
              "Nothing here yet."
            )}
          </div>
        )}
        {items.map((c) => (
          <CoinCard key={c.mint} c={c} initialReal={initialReal} flash={flash[c.mint] ?? null} />
        ))}
      </div>
    </section>
  );
}
