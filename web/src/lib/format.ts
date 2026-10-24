export const LAMPORTS = 1e9;

export const sol = (lamports: number | string | bigint, d = 2) => {
  const n = Number(lamports) / LAMPORTS;
  if (n === 0) return "0";
  if (n < 0.001) return n.toFixed(5);
  if (n < 1) return n.toFixed(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
};

export const compact = (n: number, d = 1) => {
  if (!isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(d) + "K";
  return n.toFixed(a < 10 && a !== Math.floor(a) ? 2 : 0);
};

export const tokens = (units: number | string | bigint) => compact(Number(units) / 1e6);

/** lamports per whole token -> "0.0000412 SOL" style with significant digits */
export const price = (lamportsPerToken: number) => {
  const p = lamportsPerToken / LAMPORTS;
  if (p === 0) return "0";
  if (p >= 1) return p.toFixed(4);
  const digits = Math.min(10, Math.max(4, -Math.floor(Math.log10(p)) + 3));
  return p.toFixed(digits);
};

export const short = (s: string, n = 4) => (s ? `${s.slice(0, n)}…${s.slice(-n)}` : "");

export const ago = (ts: number | null | undefined) => {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

export const explorer = (cluster: string) => (sig: string, kind: "tx" | "address" = "tx") =>
  `https://solscan.io/${kind}/${sig}${cluster === "mainnet" || cluster === "mainnet-beta" ? "" : `?cluster=${cluster === "localnet" ? "custom&customUrl=http://127.0.0.1:8899" : cluster}`}`;
