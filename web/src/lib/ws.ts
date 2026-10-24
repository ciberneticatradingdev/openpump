import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API } from "./api";

export interface LiveTrade {
  type: "trade";
  venue: "curve" | "amm";
  mint: string;
  user: string;
  isBuy: boolean;
  sol: string;
  tokens: string;
  price: number;
  mcap: number;
  ts: number;
  sig: string;
}
export type LiveMsg = LiveTrade | { type: "create"; mint: string; name: string; symbol: string; creator: string; ts: number } | { type: "complete" | "migrate"; mint: string; ts: number } | { type: "hello" };

const listeners = new Set<(m: LiveMsg) => void>();
let socket: WebSocket | null = null;

function ensureSocket() {
  if (socket && socket.readyState <= 1) return;
  const base = API || window.location.origin;
  const url = base.replace(/^http/, "ws") + "/ws";
  socket = new WebSocket(url);
  socket.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      listeners.forEach((l) => l(m));
    } catch {}
  };
  socket.onclose = () => setTimeout(ensureSocket, 2000);
}

/** Subscribe to live events; invalidates react-query caches so every view stays fresh. */
export function useLive(onMsg?: (m: LiveMsg) => void) {
  const qc = useQueryClient();
  const cb = useRef(onMsg);
  cb.current = onMsg;
  useEffect(() => {
    ensureSocket();
    const l = (m: LiveMsg) => {
      cb.current?.(m);
      if (m.type === "trade") {
        qc.invalidateQueries({ queryKey: ["coin", m.mint] });
        qc.invalidateQueries({ queryKey: ["trades", m.mint] });
        qc.invalidateQueries({ queryKey: ["candles", m.mint] });
        qc.invalidateQueries({ queryKey: ["coins"] });
        qc.invalidateQueries({ queryKey: ["activity"] });
      } else if (m.type !== "hello") {
        qc.invalidateQueries({ queryKey: ["coins"] });
        qc.invalidateQueries({ queryKey: ["coin", (m as any).mint] });
        qc.invalidateQueries({ queryKey: ["stats"] });
      }
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, [qc]);
}

/** Rolling buffer of the last N live trades for tickers. */
export function useLiveTrades(n = 30) {
  const [items, setItems] = useState<LiveTrade[]>([]);
  useLive((m) => {
    if (m.type === "trade") setItems((prev) => [m, ...prev].slice(0, n));
  });
  return items;
}
