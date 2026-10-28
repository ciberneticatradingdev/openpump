import { Route, Routes } from "react-router-dom";
import { SolanaProviders } from "./lib/solana";
import { useLive } from "./lib/ws";
import TopBar from "./components/TopBar";
import Dock from "./components/Dock";
import Toasts from "./components/Toasts";
import Home from "./pages/Home";
import CoinPage from "./pages/Coin";
import CreatePage from "./pages/Create";
import ProfilePage from "./pages/Profile";
import HowItWorks from "./pages/HowItWorks";
import SwapPage from "./pages/Swap";
import PoolsPage from "./pages/Pools";
import CreatePoolPage from "./pages/CreatePool";

function Shell() {
  useLive();
  return (
    <div className="min-h-full flex flex-col">
      <TopBar />
      <main className="flex-1 w-full max-w-[1480px] mx-auto px-3 sm:px-5 pb-28 pt-3">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/coin/:mint" element={<CoinPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/profile/:pubkey?" element={<ProfilePage />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/swap" element={<SwapPage />} />
          <Route path="/pools" element={<PoolsPage />} />
          <Route path="/pools/new" element={<CreatePoolPage />} />
        </Routes>
      </main>
      <Dock />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <SolanaProviders>
      <Shell />
    </SolanaProviders>
  );
}
