import { NavLink } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";

const Item = ({ to, label, children, accent }: any) => (
  <NavLink
    to={to}
    end={to === "/"}
    className={({ isActive }) =>
      `flex flex-col items-center justify-center w-14 h-11 rounded-xl transition ${accent ? "bg-acc text-bg" : isActive ? "bg-panel2 text-ink" : "text-mute hover:text-ink"}`
    }
    aria-label={label}
    title={label}
  >
    {children}
  </NavLink>
);

export default function Dock() {
  const { publicKey } = useWallet();
  return (
    <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-1 p-1.5 rounded-2xl bg-[#0b100c]/90 backdrop-blur-xl border border-line2 shadow-dock">
        <Item to="/" label="Board">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
        </Item>
        <Item to="/create" label="Launch a coin" accent>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
        </Item>
        <Item to="/how-it-works" label="How it works">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" /></svg>
        </Item>
        <Item to={publicKey ? "/profile" : "/profile/"} label="Profile">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
        </Item>
      </div>
    </nav>
  );
}
