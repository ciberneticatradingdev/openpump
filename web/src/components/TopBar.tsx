import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { BRAND } from "../lib/brand";
import { useCoins, useConfig, useStats } from "../lib/api";
import { sol, short } from "../lib/format";
import Avatar from "./Avatar";

export default function TopBar() {
  const { data: cfg } = useConfig();
  const { data: stats } = useStats();
  const { publicKey } = useWallet();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data: results } = useCoins("trending", q, 8);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-bg/70 border-b border-line">
      <div className="max-w-[1480px] mx-auto px-3 sm:px-5 h-14 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-acc grid place-items-center">
            <svg viewBox="0 0 64 64" className="w-5 h-5"><path d="M14 46V18h14a9 9 0 0 1 0 18h-7v10z" fill="#050806" /><circle cx="46" cy="40" r="6" fill="#050806" /></svg>
          </span>
          <span className="font-head font-bold tracking-tight text-[15px] hidden sm:block">{BRAND.name}</span>
        </Link>

        <div className="relative flex-1 max-w-[520px] mx-auto">
          <input
            ref={ref}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search coins, tickers…"
            className="input !h-9 !bg-panel !rounded-full pl-9 pr-14 text-[13px]"
          />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <kbd className="hidden sm:block absolute right-3 top-2 text-[10px] text-dim border border-line rounded px-1.5 py-0.5 font-sans">⌘K</kbd>
          {open && q && results && results.length > 0 && (
            <div className="absolute top-11 left-0 right-0 panel bg-[#0a0f0b] overflow-hidden shadow-dock">
              {results.map((c) => (
                <button key={c.mint} onMouseDown={() => { nav(`/coin/${c.mint}`); setQ(""); setOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-panel2 text-left">
                  <Avatar src={c.image} name={c.symbol} size={28} />
                  <span className="font-semibold text-[13px]">{c.symbol}</span>
                  <span className="text-mute text-[12px] truncate">{c.name}</span>
                  <span className="ml-auto text-[12px] num text-mute">{sol(c.mcap, 1)} SOL</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hidden lg:flex items-center gap-2 text-[12px] text-mute num">
          {stats && (
            <>
              <span className="pill !h-7">
                <span className="w-1.5 h-1.5 rounded-full bg-acc animate-pulse" /> {stats.coins24h} launched 24h
              </span>
              <span className="pill !h-7">{sol(stats.volume24h, 1)} SOL vol 24h</span>
            </>
          )}
          {cfg && <span className="pill !h-7 capitalize">{cfg.cluster}</span>}
        </div>

        <Link to="/create" className="btn btn-acc !h-9 !rounded-full hidden sm:inline-flex">+ Launch</Link>
        {publicKey && (
          <Link to="/profile" className="pill !h-9 hidden md:inline-flex" title="Your profile">{short(publicKey.toBase58())}</Link>
        )}
        <WalletMultiButton />
      </div>
    </header>
  );
}
