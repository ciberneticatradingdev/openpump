import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useCoins, useConfig, useCreator, type Coin } from "../lib/api";
import { useClient, useSendTx, useToast } from "../lib/solana";
import { qty, short, sol, tokens as fmtTokens } from "../lib/format";
import CoinCard from "../components/CoinCard";
import Avatar from "../components/Avatar";

export default function ProfilePage() {
  const { pubkey: param } = useParams();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const pubkey = param || publicKey?.toBase58();
  const isMe = !!publicKey && pubkey === publicKey.toBase58();
  const { data, refetch } = useCreator(pubkey);
  const { data: cfg } = useConfig();
  const { connection } = useConnection();
  const client = useClient();
  const send = useSendTx();
  const toast = useToast();
  const [holdings, setHoldings] = useState<{ coin: Coin; amount: bigint }[]>([]);
  const { data: all } = useCoins("mcap", "", 200);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pubkey || !all) return;
    let alive = true;
    (async () => {
      try {
        const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(pubkey), { programId: TOKEN_PROGRAM_ID }, "confirmed");
        const byMint = new Map(all.map((c) => [c.mint, c]));
        const h = res.value
          .map((a) => ({ mint: a.account.data.parsed.info.mint as string, amount: BigInt(a.account.data.parsed.info.tokenAmount.amount) }))
          .filter((x) => x.amount > 0n && byMint.has(x.mint))
          .map((x) => ({ coin: byMint.get(x.mint)!, amount: x.amount }))
          .sort((a, b) => Number(b.amount) * b.coin.price - Number(a.amount) * a.coin.price);
        if (alive) setHoldings(h);
      } catch {}
    })();
    return () => { alive = false; };
  }, [pubkey, all, connection]);

  if (!pubkey)
    return (
      <div className="panel p-10 text-center space-y-3">
        <div className="font-head font-semibold text-[18px]">Your profile</div>
        <p className="text-mute text-[13px]">Connect a wallet to see your coins, holdings and claimable fees.</p>
        <button className="btn btn-acc" onClick={() => setVisible(true)}>Connect wallet</button>
      </div>
    );

  const claimCurve = async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const sig = await send([await client.collectCreatorFeeIx(publicKey)], "Claim curve fees");
      if (sig) setTimeout(() => refetch(), 1500);
    } finally { setBusy(false); }
  };
  const claimAmm = async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const sig = await send(await client.ammCollectCreatorFeeIxs(publicKey), "Claim AMM fees");
      if (sig) setTimeout(() => refetch(), 1500);
    } finally { setBusy(false); }
  };

  const claimQuote = async (q: { mint: string; symbol: string; curve: string; amm: string }) => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const qm = new PublicKey(q.mint);
      const ixs = [];
      if (Number(q.curve) > 0) ixs.push(await client.collectCreatorFeeV2Ix(publicKey, qm));
      if (Number(q.amm) > 0) ixs.push(...(await client.ammCollectCreatorFeeIxs(publicKey, qm)));
      const sig = await send(ixs, `Claim ${q.symbol} fees`);
      if (sig) setTimeout(() => refetch(), 1500);
    } finally { setBusy(false); }
  };
  const curveClaim = Number(data?.claimable.curveLamports || 0);
  const ammClaim = Number(data?.claimable.ammWsolLamports || 0);
  const lifetime = (data?.coins || []).reduce((a, c) => a + Number(c.creator_fees), 0);

  return (
    <div className="space-y-3">
      <div className="panel p-4 flex flex-wrap items-center gap-4">
        <Avatar name={pubkey} size={56} />
        <div className="flex-1 min-w-[200px]">
          <div className="font-head font-bold text-[18px] num">{short(pubkey, 6)}{isMe && <span className="text-acc text-[12px] font-sans font-semibold ml-2">you</span>}</div>
          <div className="text-[12px] text-mute">{data?.coins.length ?? 0} coins launched · {sol(lifetime, 3)} SOL earned as creator</div>
        </div>
        <div className="flex gap-2">
          <div className="panel px-3 py-2 min-w-[150px]">
            <div className="label">Claimable (curve)</div>
            <div className="kpi">{sol(curveClaim, 4)} SOL</div>
            {isMe && <button onClick={claimCurve} disabled={busy || curveClaim <= 0} className="btn btn-acc !h-8 w-full mt-2 text-[12px]">Claim</button>}
          </div>
          <div className="panel px-3 py-2 min-w-[150px]">
            <div className="label">Claimable (AMM)</div>
            <div className="kpi">{sol(ammClaim, 4)} SOL</div>
            {isMe && <button onClick={claimAmm} disabled={busy || ammClaim <= 0} className="btn btn-acc !h-8 w-full mt-2 text-[12px]">Claim</button>}
          </div>
          {(data?.claimable.quotes || []).map((q) => (
            <div key={q.mint} className="panel px-3 py-2 min-w-[150px]">
              <div className="label">Claimable ({q.symbol} pair)</div>
              <div className="kpi">{qty(Number(q.curve) + Number(q.amm), q.decimals, 4)} {q.symbol}</div>
              {isMe && <button onClick={() => claimQuote(q)} disabled={busy || Number(q.curve) + Number(q.amm) <= 0} className="btn btn-acc !h-8 w-full mt-2 text-[12px]">Claim</button>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="panel">
          <header className="px-3 h-11 flex items-center border-b border-line font-head font-semibold text-[14px]">Holdings <span className="text-dim text-[11px] font-sans font-normal ml-2">{holdings.length}</span></header>
          <div className="p-1.5">
            {holdings.length === 0 && <div className="text-dim text-[13px] text-center py-8">No holdings on this launchpad yet.</div>}
            {holdings.map(({ coin, amount }) => (
              <Link key={coin.mint} to={`/coin/${coin.mint}`} className="flex items-center gap-3 p-2.5 rounded-xl2 hover:bg-panel2">
                <Avatar src={coin.image} name={coin.symbol} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[13px]">{coin.symbol} <span className="text-mute font-normal">{coin.name}</span></div>
                  <div className="text-[11px] text-dim num">{fmtTokens(amount)} tokens</div>
                </div>
                <div className="text-right num">
                  <div className="text-[13px] font-semibold">{qty((Number(amount) / 1e6) * coin.price, coin.quote_decimals ?? 9, 3)} {coin.quote_symbol || "SOL"}</div>
                  <div className="text-[11px] text-dim">{coin.migrated ? "AMM" : "curve"}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section className="panel">
          <header className="px-3 h-11 flex items-center border-b border-line font-head font-semibold text-[14px]">Launched <span className="text-dim text-[11px] font-sans font-normal ml-2">{data?.coins.length ?? 0}</span></header>
          <div className="p-1.5 space-y-0.5">
            {data?.coins.length === 0 && <div className="text-dim text-[13px] text-center py-8">{isMe ? <>Nothing yet. <Link to="/create" className="text-acc">Launch your first coin →</Link></> : "No coins launched."}</div>}
            {data?.coins.map((c) => <CoinCard key={c.mint} c={c} initialReal={cfg?.global.initialRealTokenReserves} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
