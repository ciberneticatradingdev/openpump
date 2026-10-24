import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";
import { AMM_PROGRAM_ID, CURVE_PROGRAM_ID, DEFAULT_PARAMS, PeoplepadClient, pda } from "@peoplepad/sdk";
import type { Db } from "./db";

const SORTS: Record<string, string> = {
  new: "created_at DESC",
  trending: "last_trade_at DESC",
  mcap: "mcap DESC",
  volume: "CAST(volume_sol AS INTEGER) DESC",
  graduating: "CAST(r_sol AS INTEGER) DESC",
  graduated: "migrated_at DESC",
};

export function apiRouter(db: Db, conn: Connection) {
  const r = express.Router();
  const client = new PeoplepadClient(conn);
  let globalCache: { at: number; value: any } | null = null;

  const getGlobal = async () => {
    if (globalCache && Date.now() - globalCache.at < 60_000) return globalCache.value;
    try {
      const g = await client.fetchGlobal();
      const cfg = await client.fetchAmmConfig().catch(() => null);
      const value = {
        initialized: true,
        feeRecipient: g.feeRecipient.toBase58(),
        feeBasisPoints: g.feeBasisPoints.toString(),
        creatorFeeBasisPoints: g.creatorFeeBasisPoints.toString(),
        initialVirtualTokenReserves: g.initialVirtualTokenReserves.toString(),
        initialVirtualSolReserves: g.initialVirtualSolReserves.toString(),
        initialRealTokenReserves: g.initialRealTokenReserves.toString(),
        tokenTotalSupply: g.tokenTotalSupply.toString(),
        migrationFeeLamports: g.migrationFeeLamports.toString(),
        antiSnipeSlots: g.antiSnipeSlots.toString(),
        antiSnipeMaxBps: g.antiSnipeMaxBps.toString(),
        paused: g.paused,
        amm: cfg && {
          lpFeeBasisPoints: cfg.lpFeeBasisPoints.toString(),
          protocolFeeBasisPoints: cfg.protocolFeeBasisPoints.toString(),
          coinCreatorFeeBasisPoints: cfg.coinCreatorFeeBasisPoints.toString(),
          protocolFeeRecipient: cfg.protocolFeeRecipient.toBase58(),
          disableFlags: cfg.disableFlags,
        },
      };
      globalCache = { at: Date.now(), value };
      return value;
    } catch {
      const value = { initialized: false, ...Object.fromEntries(Object.entries(DEFAULT_PARAMS).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])) };
      globalCache = { at: Date.now(), value };
      return value;
    }
  };

  r.get("/api/config", async (_req, res) => {
    res.json({
      curveProgram: CURVE_PROGRAM_ID.toBase58(),
      ammProgram: AMM_PROGRAM_ID.toBase58(),
      rpc: process.env.PUBLIC_RPC_URL || process.env.RPC_URL,
      cluster: process.env.CLUSTER || "devnet",
      global: await getGlobal(),
    });
  });

  r.get("/api/stats", (_req, res) => {
    const day = Math.floor(Date.now() / 1000) - 86400;
    const s = db.prepare(`SELECT COUNT(*) coins, SUM(migrated) graduated, SUM(trades) trades FROM coins`).get() as any;
    const v = db.prepare(`SELECT COALESCE(SUM(CAST(sol AS INTEGER)),0) vol, COUNT(*) n FROM trades WHERE ts>?`).get(day) as any;
    const c24 = db.prepare(`SELECT COUNT(*) n FROM coins WHERE created_at>?`).get(day) as any;
    res.json({ coins: s.coins, graduated: s.graduated ?? 0, trades: s.trades ?? 0, volume24h: String(v.vol), trades24h: v.n, coins24h: c24.n });
  });

  r.get("/api/coins", (req, res) => {
    const sort = SORTS[String(req.query.sort || "new")] || SORTS.new;
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    const offset = Number(req.query.offset) || 0;
    const q = String(req.query.q || "").trim();
    const where: string[] = [];
    const params: any[] = [];
    if (q) {
      where.push("(name LIKE ? OR symbol LIKE ? OR mint LIKE ? OR creator = ?)");
      params.push(`%${q}%`, `%${q}%`, `${q}%`, q);
    }
    if (req.query.sort === "graduating") where.push("complete=0");
    if (req.query.sort === "graduated") where.push("migrated=1");
    if (req.query.creator) {
      where.push("creator=?");
      params.push(String(req.query.creator));
    }
    const sql = `SELECT * FROM coins ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${sort} LIMIT ? OFFSET ?`;
    res.json(db.prepare(sql).all(...params, limit, offset));
  });

  r.get("/api/coins/:mint", (req, res) => {
    const coin = db.prepare("SELECT * FROM coins WHERE mint=?").get(req.params.mint);
    if (!coin) return res.status(404).json({ error: "not found" });
    const trades = db.prepare("SELECT * FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 50").all(req.params.mint);
    res.json({ ...(coin as any), recentTrades: trades });
  });

  r.get("/api/coins/:mint/trades", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(db.prepare("SELECT * FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT ?").all(req.params.mint, limit));
  });

  /** OHLC candles in lamports-per-token. res = bucket seconds (default 60). */
  r.get("/api/coins/:mint/candles", (req, res) => {
    const bucket = Math.max(1, Number(req.query.res) || 60);
    const rows = db
      .prepare(
        `SELECT (ts/?)*? AS t, price, CAST(sol AS INTEGER) sol FROM trades WHERE mint=? ORDER BY ts ASC, slot ASC`
      )
      .all(bucket, bucket, req.params.mint) as any[];
    const candles: any[] = [];
    let cur: any = null;
    for (const r0 of rows) {
      if (!cur || cur.time !== r0.t) {
        const open = cur ? cur.close : r0.price;
        cur = { time: r0.t, open, high: Math.max(open, r0.price), low: Math.min(open, r0.price), close: r0.price, volume: 0 };
        candles.push(cur);
      }
      cur.high = Math.max(cur.high, r0.price);
      cur.low = Math.min(cur.low, r0.price);
      cur.close = r0.price;
      cur.volume += r0.sol / 1e9;
    }
    res.json(candles);
  });

  /** Top holders straight from the RPC (no indexer needed). */
  r.get("/api/coins/:mint/holders", async (req, res) => {
    try {
      const mint = new PublicKey(req.params.mint);
      const coin = db.prepare("SELECT bonding_curve, pool, supply FROM coins WHERE mint=?").get(req.params.mint) as any;
      const largest = await conn.getTokenLargestAccounts(mint, "confirmed");
      const owners = await conn.getMultipleAccountsInfo(largest.value.map((a) => a.address), "confirmed");
      const bc = coin ? pda.bondingCurve(mint).toBase58() : null;
      const pool = coin?.pool ?? null;
      const out = largest.value.map((a, i) => {
        const owner = owners[i] ? new PublicKey(owners[i]!.data.subarray(32, 64)).toBase58() : null;
        const label = owner === bc ? "bonding curve" : pool && owner === pool ? "liquidity pool" : null;
        return { owner, amount: a.amount, pct: coin ? (Number(a.amount) / Number(coin.supply)) * 100 : null, label };
      });
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  r.get("/api/creator/:pubkey", async (req, res) => {
    try {
      const creator = new PublicKey(req.params.pubkey);
      const coins = db.prepare("SELECT * FROM coins WHERE creator=? ORDER BY created_at DESC").all(req.params.pubkey);
      const claimable = await client.creatorClaimable(creator);
      res.json({ coins, claimable: { curveLamports: claimable.curveLamports.toString(), ammWsolLamports: claimable.ammWsolLamports.toString() } });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get("/api/activity", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 40, 200);
    res.json(
      db
        .prepare(
          `SELECT t.*, c.name, c.symbol, c.image FROM trades t JOIN coins c ON c.mint=t.mint ORDER BY t.ts DESC, t.slot DESC LIMIT ?`
        )
        .all(limit)
    );
  });

  return r;
}
