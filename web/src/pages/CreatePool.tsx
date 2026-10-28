import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { OpenpumpClient, WSOL_MINT } from "@openpump/sdk";
import { useConfig } from "../lib/api";
import { useClient, useSendTx } from "../lib/solana";
import { short } from "../lib/format";

/** Open an OpenSwap pool for any SPL / Token-2022 mint you hold, quoted in SOL. The first deposit sets the price. */
export default function CreatePoolPage() {
  const { data: cfg } = useConfig();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useClient();
  const send = useSendTx();
  const nav = useNavigate();
  const [mintS, setMintS] = useState("");
  const [baseAmt, setBaseAmt] = useState("");
  const [solAmt, setSolAmt] = useState("");
  const [feeBps, setFeeBps] = useState(0);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ mint: PublicKey; decimals: number; supply: bigint; tokenProgram: PublicKey; balance: bigint; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [solBal, setSolBal] = useState(0n);

  useEffect(() => { if (publicKey) connection.getBalance(publicKey, "confirmed").then((b) => setSolBal(BigInt(b))).catch(() => {}); }, [publicKey, connection]);

  // read the mint: decimals, supply, token program, your balance
  useEffect(() => {
    setInfo(null); setErr(null);
    let mint: PublicKey;
    try { mint = new PublicKey(mintS.trim()); } catch { return; }
    let alive = true;
    (async () => {
      const acc = await connection.getAccountInfo(mint, "confirmed");
      if (!alive) return;
      if (!acc || !(acc.owner.equals(TOKEN_PROGRAM_ID) || acc.owner.equals(TOKEN_2022_PROGRAM_ID)) || acc.data.length < 82) return setErr("Not a token mint on this cluster.");
      const decimals = acc.data[44];
      const supply = acc.data.readBigUInt64LE(36);
      const balance = publicKey ? await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, publicKey, false, acc.owner), "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n) : 0n;
      if (alive) setInfo({ mint, decimals, supply, tokenProgram: acc.owner, balance, name: short(mint.toBase58()) });
    })().catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [mintS, connection, publicKey]);

  const baseIn = useMemo(() => (info && Number(baseAmt) > 0 ? BigInt(Math.floor(Number(baseAmt) * 10 ** info.decimals)) : 0n), [baseAmt, info]);
  const quoteIn = useMemo(() => (Number(solAmt) > 0 ? BigInt(Math.floor(Number(solAmt) * LAMPORTS_PER_SOL)) : 0n), [solAmt]);
  const price = info && baseIn > 0n && quoteIn > 0n ? (Number(quoteIn) / Number(baseIn)) * 10 ** info.decimals / LAMPORTS_PER_SOL : 0;
  const lp = baseIn > 0n && quoteIn > 0n ? OpenpumpClient.initialLp(baseIn, quoteIn) : 0n;
  const maxFee = Number(cfg?.global.amm?.maxConfigurableCreatorFeeBps ?? 100);
  const problems: string[] = [];
  if (info && baseIn > info.balance) problems.push(`You hold ${(Number(info.balance) / 10 ** info.decimals).toLocaleString("en-US")} of this token.`);
  if (quoteIn > 0n && quoteIn + 20_000_000n > solBal && publicKey) problems.push("Not enough SOL (keep ~0.02 for rent and fees).");
  if (lp > 0n && lp <= 1000n) problems.push("Amounts too small: the pool keeps the first 1 000 LP units locked.");
  const ready = !!info && baseIn > 0n && quoteIn > 0n && problems.length === 0 && !busy;

  const create = async () => {
    if (!publicKey) return setVisible(true);
    if (!info) return;
    setBusy(true);
    try {
      client.setCoinTokenProgram(info.mint, info.tokenProgram);
      const index = await client.freePoolIndex(publicKey, info.mint, WSOL_MINT);
      const { ixs } = await client.createPoolIxs(publicKey, index, info.mint, WSOL_MINT, baseIn, quoteIn, { creatorFeeBps: BigInt(feeBps), canEditCreatorFee: true });
      const sig = await send(ixs, `Create ${info.name} / SOL pool`);
      if (sig) setTimeout(() => nav(`/coin/${info.mint.toBase58()}`), 2500);
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-[640px] mx-auto space-y-3">
      <div className="px-1">
        <Link to="/pools" className="text-[12px] text-mute hover:text-ink">← Pools</Link>
        <h1 className="font-head font-bold text-[22px] sm:text-[26px] tracking-tight leading-none mt-1">Create a pool</h1>
        <p className="text-mute text-[13px] mt-1.5">Any SPL or Token-2022 mint against SOL. Your two deposits set the opening price; you receive LP tokens for your share and can remove liquidity any time. The pool is permissionless: anyone can trade or add liquidity.</p>
      </div>

      <div className="panel p-4 space-y-4">
        <div>
          <label className="label">Token mint</label>
          <input value={mintS} onChange={(e) => setMintS(e.target.value)} placeholder="Mint address of a token you hold" className="input mt-1 num" spellCheck={false} />
          {err && <p className="text-[12px] text-red mt-1">{err}</p>}
          {info && (
            <p className="text-[12px] text-mute mt-1 num">
              {info.decimals} decimals · supply {(Number(info.supply) / 10 ** info.decimals).toLocaleString("en-US", { maximumFractionDigits: 0 })} · {info.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "SPL"} · you hold <b className="text-ink">{(Number(info.balance) / 10 ** info.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })}</b>
            </p>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Token amount</label>
            <div className="relative mt-1">
              <input value={baseAmt} onChange={(e) => setBaseAmt(e.target.value)} inputMode="decimal" placeholder="0" className="input pr-16 num" />
              <button type="button" onClick={() => info && setBaseAmt(String(Number(info.balance) / 10 ** info.decimals))} className="absolute right-2 top-1/2 -translate-y-1/2 pill !h-7 !px-2">max</button>
            </div>
          </div>
          <div>
            <label className="label">SOL amount</label>
            <div className="relative mt-1">
              <input value={solAmt} onChange={(e) => setSolAmt(e.target.value)} inputMode="decimal" placeholder="0.0" className="input pr-14 num" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-dim">SOL</span>
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label">Coin creator fee</label>
            <span className="text-[12px] num text-ink">{(feeBps / 100).toFixed(2)}%</span>
          </div>
          <input type="range" min={0} max={maxFee} step={5} value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} className="w-full mt-1 accent-[#02d086]" />
          <p className="text-[11px] text-mute mt-1">A share of every swap paid to you as the coin creator, on top of the {cfg?.global.amm ? Number(cfg.global.amm.lpFeeBasisPoints) / 100 : 0.2}% LP fee and {cfg?.global.amm ? Number(cfg.global.amm.protocolFeeBasisPoints) / 100 : 0.05}% protocol fee. Max {(maxFee / 100).toFixed(2)}%. Editable later.</p>
        </div>

        {baseIn > 0n && quoteIn > 0n && info && (
          <div className="rounded-xl bg-panel2 border border-line p-3 text-[12px] text-mute space-y-1">
            <Row k="Opening price" v={`${price < 0.000001 ? price.toExponential(3) : price.toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL per token`} />
            <Row k="Implied market cap" v={`${((price * Number(info.supply)) / 10 ** info.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`} />
            <Row k="LP you receive" v={`${(Number(lp - 1000n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} (1 000 units stay locked)`} />
          </div>
        )}
        {problems.map((p) => <p key={p} className="text-[12px] text-red">{p}</p>)}
        <button disabled={!ready} onClick={create} className="btn btn-acc w-full">{publicKey ? (busy ? "Creating…" : "Create pool") : "Connect wallet"}</button>
        <p className="text-[11px] text-mute">One transaction: wraps the SOL, creates the pool, its vaults and LP mint, deposits both sides and mints your LP. Rent for the new accounts (~0.01 SOL) is paid by you.</p>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: any }) => (
  <div className="flex justify-between gap-3"><span>{k}</span><span className="text-ink num text-right">{v}</span></div>
);
