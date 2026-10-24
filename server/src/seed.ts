/**
 * Dev-only: populate a localnet/devnet with a few coins and trades so the UI has data.
 *   RPC_URL=http://127.0.0.1:8899 pnpm --filter @openpump/server exec tsx src/seed.ts
 * Uses ~/.config/solana/id.json (must be INITIAL_AUTHORITY) and airdrops when on localnet.
 */
import "dotenv/config";
import fs from "node:fs";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { DEFAULT_AMM_FEES, DEFAULT_PARAMS, OpenpumpClient, curve as curveMath, pda } from "@openpump/sdk";
import { createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8899";
const API = process.env.API_URL || "http://localhost:8787";
const conn = new Connection(RPC, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))));
const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
const client = new OpenpumpClient(conn, provider);

const COINS = [
  { name: "People Coin", symbol: "PEOPLE", desc: "the launchpad the community asked for", color: "ff5c1a" },
  { name: "Megaphone", symbol: "LOUD", desc: "say it louder", color: "ffd400" },
  { name: "Town Hall", symbol: "HALL", desc: "everyone gets a seat", color: "27c4ff" },
  { name: "Picket Line", symbol: "PICKET", desc: "we are not leaving", color: "7cff5c" },
  { name: "Banner", symbol: "BANNER", desc: "hold it high", color: "ff4fd8" },
];

const send = async (ixs: any[], signers: Keypair[] = []) => {
  const tx = new Transaction().add(...ixs);
  return provider.sendAndConfirm(tx, signers);
};

async function uploadMeta(c: (typeof COINS)[number]) {
  // 1x1 PNG tinted via SVG → keep it simple: upload an SVG as the image
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#${c.color}"/><text x="128" y="150" font-size="72" font-family="Arial Black,Arial" font-weight="900" text-anchor="middle" fill="#111">${c.symbol.slice(0, 4)}</text></svg>`;
  const form = new FormData();
  form.append("image", new Blob([svg], { type: "image/svg+xml" }), "image.svg");
  form.append("name", c.name);
  form.append("symbol", c.symbol);
  form.append("description", c.desc);
  form.append("twitter", "https://x.com/peoplespad");
  const res = await fetch(`${API}/api/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed ${res.status} ${await res.text()}`);
  return (await res.json()) as { uri: string };
}

async function main() {
  if (RPC.includes("127.0.0.1") || RPC.includes("localhost")) {
    const bal = await conn.getBalance(admin.publicKey);
    if (bal < 50 * LAMPORTS_PER_SOL) await conn.confirmTransaction(await conn.requestAirdrop(admin.publicKey, 500 * LAMPORTS_PER_SOL));
  }
  console.log("admin", admin.publicKey.toBase58(), (await conn.getBalance(admin.publicKey)) / 1e9, "SOL");

  // init once
  const g = await conn.getAccountInfo(pda.global());
  if (!g) {
    const fee = DEFAULT_AMM_FEES;
    await send([
      await client.createAmmConfigIx(admin.publicKey, fee.lpFeeBasisPoints, fee.protocolFeeBasisPoints, fee.coinCreatorFeeBasisPoints, admin.publicKey),
      await client.initializeIx(admin.publicKey, { feeRecipient: admin.publicKey, ...DEFAULT_PARAMS, antiSnipeSlots: 0n }),
    ]);
    console.log("initialized global + amm config");
  }
  const global = await client.fetchGlobal();

  const local = RPC.includes("127.0.0.1") || RPC.includes("localhost");
  // ADMIN_ONLY=1: no trader wallets, admin buys (cheap on devnet). FORCE_NEW=1: never reuse coins.
  const adminOnly = !!process.env.ADMIN_ONLY;
  const traders = adminOnly ? [admin] : Array.from({ length: local ? 6 : 2 }, () => Keypair.generate());
  if (!adminOnly)
    for (const t of traders) {
      if (local) await conn.confirmTransaction(await conn.requestAirdrop(t.publicKey, 120 * LAMPORTS_PER_SOL));
      else await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: t.publicKey, lamports: 0.9 * LAMPORTS_PER_SOL })]);
    }
  const coins = local ? COINS : COINS.slice(0, 3);

  for (const [i, c] of coins.entries()) {
    // reuse an existing coin with this symbol (re-runs on devnet shouldn't spam duplicates)
    const existing: any[] = await fetch(`${API}/api/coins?q=${c.symbol}&limit=5`).then((r) => r.json()).catch(() => []);
    const found = process.env.FORCE_NEW ? null : existing.find((e) => e.symbol === c.symbol && !e.complete);
    let mint: { publicKey: PublicKey };
    if (found) {
      mint = { publicKey: new PublicKey(found.mint) };
      console.log(`reusing ${c.symbol} ${found.mint}`);
    } else {
      const kp = Keypair.generate();
      const { uri } = await uploadMeta(c);
      await send([await client.createIx(admin.publicKey, kp.publicKey, c.name, c.symbol, uri)], [kp]);
      mint = kp;
      console.log(`created ${c.symbol} ${kp.publicKey.toBase58()}`);
    }

    // random-ish trading; coin #0 graduates
    const n = local ? (i === 0 ? 12 : 3 + i * 2) : 3;
    for (let k = 0; k < n; k++) {
      const t = traders[k % traders.length];
      const tp = new AnchorProvider(conn, new Wallet(t), { commitment: "confirmed" });
      const tc = new OpenpumpClient(conn, tp);
      const bc = (await client.fetchBondingCurve(mint.publicKey))!;
      if (bc.complete) break;
      const sellTurn = i !== 0 && k % 4 === 3;
      if (!sellTurn) {
        const sol = BigInt(Math.floor((local ? (i === 0 ? 9 : 0.3 + Math.random() * 2) : (adminOnly ? 0.01 + Math.random() * 0.02 : 0.02 + Math.random() * 0.05)) * 1e9));
        const q = curveMath.quoteBuyExactSol(sol, bc, global);
        const ix = await tc.buyExactSolIx(t.publicKey, mint.publicKey, admin.publicKey, global.feeRecipient, sol, (q.tokensOut * 95n) / 100n);
        await tp.sendAndConfirm(new Transaction().add(ix), [t]);
      } else {
        const ata = await conn.getTokenAccountBalance((await import("@solana/spl-token")).getAssociatedTokenAddressSync(mint.publicKey, t.publicKey)).catch(() => null);
        const have = BigInt(ata?.value.amount ?? "0");
        if (have > 0n) {
          const ix = await tc.sellIx(t.publicKey, mint.publicKey, admin.publicKey, global.feeRecipient, have / 2n, 0n);
          await tp.sendAndConfirm(new Transaction().add(ix), [t]);
        }
      }
    }
    const bc = (await client.fetchBondingCurve(mint.publicKey))!;
    console.log(`  ${c.symbol}: ${Number(bc.realSolReserves) / 1e9} SOL raised, complete=${bc.complete}`);
    if (bc.complete) {
      await send(await client.migrateIxs(admin.publicKey, mint.publicKey, admin.publicKey, global.feeRecipient));
      console.log(`  migrated → pool ${pda.migrationPool(mint.publicKey).toBase58()}`);
      const pool = (await client.fetchPool(mint.publicKey))!;
      const cfg = await client.fetchAmmConfig();
      const t = traders[0];
      const tp = new AnchorProvider(conn, new Wallet(t), { commitment: "confirmed" });
      const tc = new OpenpumpClient(conn, tp);
      for (let k = 0; k < 4; k++) {
        const { baseReserve, quoteReserve } = await client.fetchPoolReserves(pool);
        const budget = BigInt(Math.floor((1 + Math.random() * 3) * 1e9));
        const { amm } = await import("@openpump/sdk");
        const q = amm.quoteBuyWithBudget(budget, baseReserve, quoteReserve, cfg);
        const ixs = await tc.ammBuyIxs(t.publicKey, mint.publicKey, pool, cfg.protocolFeeRecipient, q.baseOut, q.totalIn);
        await tp.sendAndConfirm(new Transaction().add(...ixs), [t]);
      }
      console.log("  4 AMM buys done");
    }
  }
  // ---- custom pair demo: a quote token "OPEN" + one coin paired with it (local or QUOTE_MINT provided)
  if (process.env.SEED_PAIR || local) {
    let quoteMint: PublicKey;
    if (process.env.QUOTE_MINT) quoteMint = new PublicKey(process.env.QUOTE_MINT);
    else {
      quoteMint = await createMint(conn, admin, admin.publicKey, null, 6);
      console.log("quote mint OPEN", quoteMint.toBase58(), "(set QUOTE_MINTS=" + quoteMint.toBase58() + ":OPEN:6 on the server)");
    }
    for (const who of [admin, ...traders]) {
      const ata = await getOrCreateAssociatedTokenAccount(conn, admin, quoteMint, who.publicKey);
      await mintTo(conn, admin, quoteMint, ata.address, admin, 5_000_000 * 1e6);
    }
    if (!(await client.fetchQuoteConfig(quoteMint))) {
      await send([await client.setQuoteConfigIx(admin.publicKey, quoteMint, { enabled: true, initialVirtualQuoteReserves: 1_000_000_000_000n, initialVirtualTokenReserves: DEFAULT_PARAMS.initialVirtualTokenReserves, initialRealTokenReserves: DEFAULT_PARAMS.initialRealTokenReserves, migrationFee: 0n })]);
      console.log("quote config set");
    }
    const kp = Keypair.generate();
    const { uri } = await uploadMeta({ name: "Open Pair", symbol: "PAIR", desc: "first coin paired with OPEN", color: "27c4ff" });
    await send([await client.createV2Ix(admin.publicKey, kp.publicKey, quoteMint, "Open Pair", "PAIR", uri)], [kp]);
    console.log("created PAIR (quote OPEN)", kp.publicKey.toBase58());
    for (const t of traders.slice(0, 3)) {
      const tp = new AnchorProvider(conn, new Wallet(t), { commitment: "confirmed" });
      const tc = new OpenpumpClient(conn, tp);
      const units = BigInt(Math.floor((500 + Math.random() * 2000) * 1e6));
      const ix = await tc.buyExactQuoteInIx(t.publicKey, kp.publicKey, admin.publicKey, global.feeRecipient, quoteMint, units, 0n);
      await tp.sendAndConfirm(new Transaction().add(ix), [t]);
    }
    console.log("  3 PAIR buys in OPEN");
  }
  console.log("seed done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
