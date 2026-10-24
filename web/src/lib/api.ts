import { useQuery } from "@tanstack/react-query";

export interface Coin {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  image: string | null;
  description: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  creator: string;
  bonding_curve: string;
  created_at: number;
  created_slot: number;
  complete: number;
  completed_at: number | null;
  migrated: number;
  migrated_at: number | null;
  pool: string | null;
  v_sol: string;
  v_tok: string;
  r_sol: string;
  r_tok: string;
  supply: string;
  pool_base: string | null;
  pool_quote: string | null;
  price: number; // lamports per token
  mcap: number; // lamports
  volume_sol: string;
  trades: number;
  last_trade_at: number | null;
  creator_fees: string;
  protocol_fees: string;
}

export interface Trade {
  id: string;
  sig: string;
  mint: string;
  venue: "curve" | "amm";
  user: string;
  is_buy: number;
  sol: string;
  tokens: string;
  protocol_fee: string;
  creator_fee: string;
  price: number;
  ts: number;
  slot: number;
  name?: string;
  symbol?: string;
  image?: string | null;
}

export interface Config {
  curveProgram: string;
  ammProgram: string;
  rpc: string;
  cluster: string;
  global: {
    initialized: boolean;
    feeRecipient?: string;
    feeBasisPoints: string;
    creatorFeeBasisPoints: string;
    initialVirtualTokenReserves: string;
    initialVirtualSolReserves: string;
    initialRealTokenReserves: string;
    tokenTotalSupply: string;
    migrationFeeLamports: string;
    antiSnipeSlots: string;
    antiSnipeMaxBps: string;
    paused: boolean;
    amm?: { lpFeeBasisPoints: string; protocolFeeBasisPoints: string; coinCreatorFeeBasisPoints: string; protocolFeeRecipient: string; disableFlags: number } | null;
  };
}

export const API = (import.meta as any).env?.VITE_API_URL || "";

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/config"), staleTime: 60_000 });
export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: () => get<any>("/api/stats"), refetchInterval: 15_000 });
export const useCoins = (sort: string, q = "", limit = 60) =>
  useQuery({ queryKey: ["coins", sort, q, limit], queryFn: () => get<Coin[]>(`/api/coins?sort=${sort}&q=${encodeURIComponent(q)}&limit=${limit}`), refetchInterval: 8_000 });
export const useCoin = (mint?: string) =>
  useQuery({ queryKey: ["coin", mint], queryFn: () => get<Coin & { recentTrades: Trade[] }>(`/api/coins/${mint}`), enabled: !!mint, refetchInterval: 6_000 });
export const useTrades = (mint?: string, limit = 100) =>
  useQuery({ queryKey: ["trades", mint, limit], queryFn: () => get<Trade[]>(`/api/coins/${mint}/trades?limit=${limit}`), enabled: !!mint, refetchInterval: 6_000 });
export const useCandles = (mint?: string, res = 60) =>
  useQuery({ queryKey: ["candles", mint, res], queryFn: () => get<any[]>(`/api/coins/${mint}/candles?res=${res}`), enabled: !!mint, refetchInterval: 6_000 });
export const useHolders = (mint?: string) =>
  useQuery({ queryKey: ["holders", mint], queryFn: () => get<any[]>(`/api/coins/${mint}/holders`), enabled: !!mint, refetchInterval: 20_000 });
export const useActivity = (limit = 30) => useQuery({ queryKey: ["activity", limit], queryFn: () => get<Trade[]>(`/api/activity?limit=${limit}`), refetchInterval: 8_000 });
export const useCreator = (pubkey?: string) =>
  useQuery({ queryKey: ["creator", pubkey], queryFn: () => get<{ coins: Coin[]; claimable: { curveLamports: string; ammWsolLamports: string } }>(`/api/creator/${pubkey}`), enabled: !!pubkey, refetchInterval: 10_000 });
