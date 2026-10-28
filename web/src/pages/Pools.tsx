import { Link } from "react-router-dom";
import { useConfig, usePools, type Pool } from "../lib/api";
import { ago, qty, short, tokens as fmtTokens } from "../lib/format";
import Avatar from "../components/Avatar";

/** Every pool on OpenSwap: graduated coins plus pools anyone created directly on the AMM. */
export default function PoolsPage() {
  const { data: cfg } = useConfig();
  const { data: pools, isLoading } = usePools(200);
  const totalQuote = (pools || []).filter((p) => p.quote_mint === "So11111111111111111111111111111111111111112").reduce((a, p) => a + Number(p.quote_res), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="font-head font-bold text-[22px] sm:text-[26px] tracking-tight leading-none">OpenSwap pools</h1>
          <p className="text-mute text-[13px] mt-1.5">
            The AMM side of OpenPump. Graduated coins land here with their LP burned; anyone can also open a pool for any SPL token and add or remove liquidity.
            {cfg?.global.amm && <> Fees per swap: <b className="text-ink">{Number(cfg.global.amm.lpFeeBasisPoints) / 100}%</b> to LPs, {Number(cfg.global.amm.protocolFeeBasisPoints) / 100}% protocol, {Number(cfg.global.amm.coinCreatorFeeBasisPoints) / 100}% coin creator.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pools && <span className="pill !h-9 num">{pools.length} pools · {(totalQuote / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })} SOL</span>}
          <Link to="/pools/new" className="btn btn-acc !h-9 !rounded-full">+ Create pool</Link>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="grid grid-cols-[1fr_110px_120px_90px_90px] sm:grid-cols-[1fr_130px_140px_110px_100px_90px] gap-2 px-4 py-2 border-b border-line label">
          <span>Pool</span><span className="text-right">Price</span><span className="text-right">Liquidity</span><span className="text-right hidden sm:block">LP supply</span><span className="text-right">Trades</span><span className="text-right">Created</span>
        </div>
        {isLoading && <div className="px-4 py-8 text-center text-mute text-[13px]">Loading pools…</div>}
        {pools && pools.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-mute">
            No pools yet. <Link to="/pools/new" className="text-acc hover:underline">Create the first one →</Link>
          </div>
        )}
        {pools?.map((p) => <PoolRow key={p.pool} p={p} />)}
      </div>
    </div>
  );
}

function PoolRow({ p }: { p: Pool }) {
  const qDec = p.quote_decimals ?? 9;
  const qSym = p.quote_symbol || "SOL";
  const base = Number(p.base_res), quote = Number(p.quote_res) + Number(p.virtual_quote || 0);
  const dec = p.decimals ?? 6;
  const price = base > 0 ? (quote / base) * 10 ** dec / 10 ** qDec : 0;
  return (
    <Link to={`/coin/${p.mint}`} className="grid grid-cols-[1fr_110px_120px_90px_90px] sm:grid-cols-[1fr_130px_140px_110px_100px_90px] gap-2 items-center px-4 py-2.5 border-b border-line last:border-0 hover:bg-panel2 transition-colors text-[13px]">
      <span className="flex items-center gap-2.5 min-w-0">
        <Avatar src={p.image} name={p.symbol || p.mint} size={30} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <b className="text-ink">{p.symbol || short(p.mint)}</b><span className="text-dim">/ {qSym}</span>
            {p.source === "standalone" ? <span className="text-[9px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 border text-acc bg-acc/10 border-acc/30">standalone</span> : <span className="text-[9px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 border text-mute border-line">graduated</span>}
            {Number(p.virtual_quote) > 0 && <span className="text-[9px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 border text-gold bg-gold/10 border-gold/30">boost</span>}
          </span>
          <span className="block text-[11px] text-mute truncate">{p.name || p.mint}</span>
        </span>
      </span>
      <span className="text-right num text-ink">{price < 0.000001 ? price.toExponential(2) : price.toLocaleString("en-US", { maximumFractionDigits: 8 })} {qSym}</span>
      <span className="text-right num text-ink">{qty(p.quote_res, qDec, 2)} {qSym}<span className="block text-[11px] text-mute">{fmtTokens(p.base_res)} {p.symbol || "tokens"}</span></span>
      <span className="text-right num text-mute hidden sm:block">{fmtTokens(p.lp_supply)}</span>
      <span className="text-right num text-mute">{p.trades ?? 0}</span>
      <span className="text-right text-mute text-[12px]">{p.created_at ? ago(p.created_at) : "—"}</span>
    </Link>
  );
}
