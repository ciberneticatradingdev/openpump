import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCoin, useConfig, useHolders, useRewards, useTrades } from "../lib/api";
import { ago, compact, explorer, priceQ, qty, short, sol } from "../lib/format";
import Avatar from "../components/Avatar";
import Chart from "../components/Chart";
import Progress from "../components/Progress";
import TradePanel from "../components/TradePanel";
import { progressOf } from "../components/CoinCard";
import { useToast } from "../lib/solana";

export default function CoinPage() {
  const { mint } = useParams();
  const { data: coin, isLoading, refetch } = useCoin(mint);
  const { data: cfg } = useConfig();
  const { data: rewards } = useRewards(mint, !!coin?.is_holder_reward);
  const { publicKey } = useWallet();
  const toast = useToast();
  const [tab, setTab] = useState<"trades" | "holders" | "about">("trades");

  if (isLoading || !cfg) return <div className="panel h-[60vh] shimmer" />;
  if (!coin) return <div className="panel p-10 text-center text-mute">Coin not found. <Link to="/" className="text-acc">Back to the board</Link></div>;

  const graduated = !!coin.migrated;
  const p = progressOf(coin, cfg.global.initialRealTokenReserves);
  const ex = explorer(cfg.cluster);
  const qSym = coin.quote_symbol || "SOL";
  const qDec = coin.quote_decimals ?? 9;
  const target = qSym === "SOL" && Number(cfg.global.initialVirtualSolReserves) === 30e9 ? 85 : null;
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.push({ kind: "ok", title: "Copied" }); };
  const isCreator = publicKey?.toBase58() === coin.creator;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-3">
      <div className="space-y-3 min-w-0">
        {/* header */}
        <div className="panel p-3 flex flex-wrap items-center gap-3">
          <Avatar src={coin.image} name={coin.symbol} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-head font-bold text-[20px] tracking-tight">{coin.symbol}</h1>
              <span className="text-mute text-[14px] truncate">{coin.name}</span>
              {graduated ? <Badge color="acc">AMM</Badge> : coin.complete ? <Badge color="gold">graduating</Badge> : <Badge>bonding curve</Badge>}
              {qSym !== "SOL" && <Badge>pair /{qSym}</Badge>}
              {!!coin.is_holder_reward && <Badge color="acc">rewards → holders</Badge>}
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[12px] text-mute mt-1">
              <button onClick={() => copy(coin.mint)} className="pill !h-7 num hover:border-line2" title="Copy contract address">{short(coin.mint, 5)} <span className="text-dim">⧉</span></button>
              {coin.is_holder_reward ? (
                <span className="pill !h-7">creator fee → holders</span>
              ) : (
                <Link to={`/profile/${coin.creator}`} className="pill !h-7 hover:border-line2">by {short(coin.creator)}{isCreator && <span className="text-acc">(you)</span>}</Link>
              )}
              <span className="pill !h-7">{ago(coin.created_at)} ago</span>
              {coin.twitter && <a href={coin.twitter} target="_blank" rel="noreferrer" className="pill !h-7 hover:border-line2">X ↗</a>}
              {coin.telegram && <a href={coin.telegram} target="_blank" rel="noreferrer" className="pill !h-7 hover:border-line2">TG ↗</a>}
              {coin.website && <a href={coin.website} target="_blank" rel="noreferrer" className="pill !h-7 hover:border-line2">web ↗</a>}
              <a href={ex(coin.mint, "address")} target="_blank" rel="noreferrer" className="pill !h-7 hover:border-line2">solscan ↗</a>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Kpi k="Market cap" v={`${qty(coin.mcap, qDec, 1)} ${qSym}`} />
          <Kpi k="Price" v={`${priceQ(coin.price, qDec)} ${qSym}`} />
          <Kpi k="Volume" v={`${qty(coin.volume_sol, qDec, 1)} ${qSym}`} />
          <Kpi k="Trades" v={coin.trades} />
          {coin.is_holder_reward ? (
            <Kpi k="Paid to holders" v={`${qty(coin.holder_paid || 0, qDec, 3)} ${qSym}`} />
          ) : (
            <Kpi k="Creator earned" v={`${qty(coin.creator_fees, qDec, 3)} ${qSym}`} />
          )}
        </div>

        <Chart mint={coin.mint} qSym={qSym} qDec={qDec} />

        {/* tabs */}
        <div className="panel">
          <div className="flex items-center gap-1 px-2 pt-2 border-b border-line pb-2">
            {(["trades", "holders", "about"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`pill capitalize ${tab === t ? "pill-active" : "!border-transparent !bg-transparent text-mute hover:text-ink"}`}>{t}</button>
            ))}
          </div>
          {tab === "trades" && <Trades mint={coin.mint} symbol={coin.symbol} cluster={cfg.cluster} qSym={qSym} qDec={qDec} />}
          {tab === "holders" && <Holders mint={coin.mint} cluster={cfg.cluster} />}
          {tab === "about" && (
            <div className="p-4 text-[13px] text-mute space-y-2">
              <p className="text-ink whitespace-pre-wrap">{coin.description || "No description."}</p>
              <p>Mint: <span className="num text-ink">{coin.mint}</span></p>
              <p>Bonding curve: <span className="num text-ink">{coin.bonding_curve}</span></p>
              {coin.pool && <p>AMM pool: <span className="num text-ink">{coin.pool}</span></p>}
              <p>Metadata: <a href={coin.uri} target="_blank" rel="noreferrer" className="text-acc hover:underline break-all">{coin.uri}</a></p>
            </div>
          )}
        </div>
      </div>

      {/* right column */}
      <div className="space-y-3 xl:sticky xl:top-[68px] self-start">
        <TradePanel coin={coin} cfg={cfg} onTraded={() => setTimeout(() => refetch(), 1500)} />

        <div className="panel p-3">
          <div className="flex items-center justify-between">
            <span className="label">{graduated ? "Graduated" : "Bonding curve progress"}</span>
            <span className="text-[12px] num font-semibold">{p.toFixed(1)}%</span>
          </div>
          <Progress value={p} className="mt-2" color={graduated ? "bg-acc" : coin.complete ? "bg-gold" : "bg-acc"} />
          <p className="text-[12px] text-mute mt-2">
            {graduated ? (
              <>Trading on the AMM with <b className="text-ink num">{qty(coin.pool_quote || 0, qDec, 1)} {qSym}</b> liquidity. LP burned, so liquidity can never be pulled.</>
            ) : (
              <><b className="text-ink num">{qty(coin.r_sol, qDec, 2)} {qSym}</b> raised{target ? <> of ~{target} SOL</> : null}. When the curve sells out, all of it + the remaining supply becomes permanent AMM liquidity.</>
            )}
          </p>
        </div>

        {!!coin.is_holder_reward && (
          <div className="panel p-3 text-[12px] text-mute space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="label">Holder rewards</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-acc">live</span>
            </div>
            <Row k="Pot (undistributed)" v={`${qty(rewards?.pot || 0, qDec, 4)} ${qSym}`} />
            <Row k="Paid out so far" v={`${qty(coin.holder_paid || 0, qDec, 4)} ${qSym}`} />
            <Row k="Payouts" v={rewards?.distributions.length ?? 0} />
            <p className="pt-1">The creator fee of every trade goes to this coin's holders instead of the creator. Paid pro-rata to the top 20 holders every few minutes.</p>
          </div>
        )}
        <div className="panel p-3 text-[12px] text-mute space-y-1.5">
          <div className="label mb-1">Fee split on every trade</div>
          <Row k={coin.is_holder_reward ? "Holders" : "Creator"} v={`${Number(cfg.global.creatorFeeBasisPoints) / 100}%`} />
          <Row k="Protocol" v={`${Number(cfg.global.feeBasisPoints) / 100}%`} />
          {graduated && cfg.global.amm && <Row k="AMM LPs" v={`${Number(cfg.global.amm.lpFeeBasisPoints) / 100}%`} />}
          {isCreator && !coin.is_holder_reward && <Link to="/profile" className="btn btn-ghost w-full mt-2 !h-9">Claim your fees →</Link>}
        </div>
      </div>
    </div>
  );
}

const Badge = ({ children, color }: { children: any; color?: "acc" | "gold" }) => (
  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${color === "acc" ? "text-acc bg-acc/10 border-acc/30" : color === "gold" ? "text-gold bg-gold/10 border-gold/30" : "text-mute bg-panel border-line"}`}>{children}</span>
);
const Kpi = ({ k, v }: { k: string; v: any }) => (
  <div className="panel px-3 py-2">
    <div className="label">{k}</div>
    <div className="kpi mt-0.5">{v}</div>
  </div>
);
const Row = ({ k, v }: { k: string; v: any }) => (
  <div className="flex justify-between"><span>{k}</span><span className="text-ink num">{v}</span></div>
);

function Trades({ mint, symbol, cluster, qSym, qDec }: { mint: string; symbol: string; cluster: string; qSym: string; qDec: number }) {
  const { data } = useTrades(mint, 100);
  const ex = explorer(cluster);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] num">
        <thead className="text-dim text-left">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
            <th>account</th><th>type</th><th className="text-right">{qSym}</th><th className="text-right">{symbol}</th><th className="text-right">venue</th><th className="text-right">time</th><th className="text-right">tx</th>
          </tr>
        </thead>
        <tbody>
          {(data || []).map((t) => (
            <tr key={t.id} className="border-t border-line hover:bg-panel2 [&>td]:px-3 [&>td]:py-2">
              <td><Link to={`/profile/${t.user}`} className="hover:text-acc">{short(t.user)}</Link></td>
              <td className={t.is_buy ? "text-acc font-semibold" : "text-red font-semibold"}>{t.is_buy ? "buy" : "sell"}</td>
              <td className="text-right">{qty(t.sol, qDec, 4)}</td>
              <td className="text-right">{compact(Number(t.tokens) / 1e6)}</td>
              <td className="text-right text-mute">{t.venue}</td>
              <td className="text-right text-mute">{ago(t.ts)} ago</td>
              <td className="text-right"><a href={ex(t.sig)} target="_blank" rel="noreferrer" className="text-dim hover:text-acc">{t.sig.slice(0, 6)} ↗</a></td>
            </tr>
          ))}
          {data && data.length === 0 && <tr><td colSpan={7} className="text-center text-dim py-8">No trades yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Holders({ mint, cluster }: { mint: string; cluster: string }) {
  const { data, isLoading } = useHolders(mint);
  const ex = explorer(cluster);
  return (
    <div className="p-2">
      {isLoading && <div className="h-40 shimmer rounded-xl" />}
      {(data || []).map((h, i) => (
        <div key={h.owner + i} className="flex items-center gap-3 px-2 py-2 border-t border-line first:border-0 text-[12px] num">
          <span className="text-dim w-5">{i + 1}</span>
          <a href={ex(h.owner, "address")} target="_blank" rel="noreferrer" className="hover:text-acc">{short(h.owner, 5)}</a>
          {h.label && <span className="pill !h-6 !text-[10px]">{h.label}</span>}
          <span className="ml-auto text-mute">{h.pct?.toFixed(2)}%</span>
          <div className="w-24 h-1.5 bg-white/[0.06] rounded-full overflow-hidden"><div className="h-full bg-acc" style={{ width: `${Math.min(100, h.pct || 0)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
