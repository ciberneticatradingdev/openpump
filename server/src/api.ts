import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";
import { AMM_PROGRAM_ID, CURVE_PROGRAM_ID, DEFAULT_PARAMS, FEES_PROGRAM_ID, OpenpumpClient, incentives as incMath, pda } from "@openpump/sdk";
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
  const client = new OpenpumpClient(conn);
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
        buybackBasisPoints: g.buybackBasisPoints.toString(),
        buybackFeeRecipient: g.buybackFeeRecipient.toBase58(),
        antiSnipeSlots: g.antiSnipeSlots.toString(),
        antiSnipeMaxBps: g.antiSnipeMaxBps.toString(),
        paused: g.paused,
        amm: cfg && {
          lpFeeBasisPoints: cfg.lpFeeBasisPoints.toString(),
          protocolFeeBasisPoints: cfg.protocolFeeBasisPoints.toString(),
          coinCreatorFeeBasisPoints: cfg.coinCreatorFeeBasisPoints.toString(),
          protocolFeeRecipient: cfg.protocolFeeRecipient.toBase58(),
          disableFlags: cfg.disableFlags,
          buybackBasisPoints: cfg.buybackBasisPoints.toString(),
          buybackFeeRecipient: cfg.buybackFeeRecipient.toBase58(),
          boostEnabled: cfg.boostEnabled,
          boostAuthority: cfg.boostAuthority.toBase58(),
          boostBasisPoints: cfg.boostBasisPoints.toString(),
          creatorFeeConfigurable: cfg.creatorFeeConfigurable,
          maxConfigurableCreatorFeeBps: cfg.maxConfigurableCreatorFeeBps.toString(),
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

  let incCache: { at: number; value: any } | null = null;
  const getIncentives = async () => {
    if (incCache && Date.now() - incCache.at < 30_000) return incCache.value;
    let value: any = null;
    try {
      const g = await client.fetchIncentives();
      if (g && g.startTime > 0) {
        const now = Math.floor(Date.now() / 1000);
        const today = incMath.dayOf(now, g);
        value = {
          mint: g.mint.toBase58(), symbol: process.env.INCENTIVE_SYMBOL || "OPENPUMP", decimals: Number(process.env.INCENTIVE_DECIMALS || 6),
          startTime: g.startTime, endTime: g.endTime, secondsInADay: g.secondsInADay, active: incMath.active(g, now), today,
          supplyToday: today !== null && today < 30 ? g.totalTokenSupply[today].toString() : "0",
          volumeToday: today !== null && today < 30 ? g.solVolumes[today].toString() : "0",
          totalTokenSupply: g.totalTokenSupply.map(String), solVolumes: g.solVolumes.map(String),
        };
      }
    } catch {}
    incCache = { at: Date.now(), value };
    return value;
  };

  r.get("/api/user/:pubkey/incentives", async (req, res) => {
    try {
      const g = await client.fetchIncentives();
      const u = await client.fetchUserVolume(new PublicKey(req.params.pubkey));
      if (!g || !u) return res.json({ exists: !!u, claimable: "0", projectedToday: "0", currentSolVolume: u?.currentSolVolume.toString() ?? "0", totalClaimed: u?.totalClaimedTokens.toString() ?? "0" });
      res.json({ exists: true, claimable: incMath.claimable(g, u).toString(), projectedToday: incMath.projectedToday(g, u).toString(), currentSolVolume: u.currentSolVolume.toString(), totalClaimed: u.totalClaimedTokens.toString() });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  let feeCache: { at: number; value: any } | null = null;
  const getFeeConfig = async () => {
    if (feeCache && Date.now() - feeCache.at < 60_000) return feeCache.value;
    let value: any = null;
    try {
      const c = await client.fetchFeeConfig();
      if (c) {
        const f = (x: any) => ({ lpFeeBps: x.lpFeeBps.toString(), protocolFeeBps: x.protocolFeeBps.toString(), creatorFeeBps: x.creatorFeeBps.toString() });
        value = { flatFees: f(c.flatFees), feeTiers: c.feeTiers.map((t) => ({ marketCapLamportsThreshold: t.marketCapLamportsThreshold.toString(), fees: f(t.fees) })), stableFeeTiers: c.stableFeeTiers.map((t) => ({ marketCapLamportsThreshold: t.marketCapLamportsThreshold.toString(), fees: f(t.fees) })), exoticFlatFees: f(c.exoticFlatFees), stableMints: c.stableMints };
      }
    } catch {}
    feeCache = { at: Date.now(), value };
    return value;
  };

  /** Sharing config + pending (unsplit) creator fees for a coin. */
  r.get("/api/coins/:mint/sharing", async (req, res) => {
    try {
      const mint = new PublicKey(req.params.mint);
      const cfg = await client.fetchSharingConfig(mint);
      if (!cfg) return res.json({ exists: false });
      const sharing = pda.sharingConfig(mint);
      const coin = db.prepare("SELECT quote_mint, migrated FROM coins WHERE mint=?").get(req.params.mint) as any;
      const quote = new PublicKey(coin?.quote_mint || "So11111111111111111111111111111111111111112");
      const pending = await client.creatorClaimable(sharing).catch(() => ({ curveLamports: 0n, ammWsolLamports: 0n }));
      const pendingQuote = quote.toBase58() !== "So11111111111111111111111111111111111111112" ? await client.creatorClaimableQuote(sharing, quote).catch(() => ({ curve: 0n, amm: 0n })) : null;
      res.json({
        exists: true, admin: cfg.admin.toBase58(), adminRevoked: cfg.adminRevoked, active: cfg.active,
        shareholders: cfg.shareholders.map((s) => ({ address: s.address.toBase58(), shareBps: s.shareBps })),
        pendingCurve: (pendingQuote ? pendingQuote.curve : pending.curveLamports).toString(), pendingAmm: (pendingQuote ? pendingQuote.amm : pending.ammWsolLamports).toString(),
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  /** Social fee PDA: address + what it has earned (vault pending + PDA balance). */
  r.get("/api/social/:platform/:userId", async (req, res) => {
    try {
      const platform = Number(req.params.platform);
      const userId = String(req.params.userId).toLowerCase();
      const social = pda.socialFeePda(userId, platform);
      const [info, vault] = await Promise.all([conn.getAccountInfo(social, "confirmed"), client.creatorClaimable(social)]);
      const rentPda = info ? await conn.getMinimumBalanceForRentExemption(info.data.length) : 0;
      const coins = db.prepare("SELECT mint, name, symbol, image FROM coins WHERE creator=?").all(social.toBase58());
      res.json({ address: social.toBase58(), exists: !!info, pendingVault: vault.curveLamports.toString(), claimable: info ? String(Math.max(0, info.lamports - rentPda)) : "0", coins });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  /**
   * Social claims. The social-claim authority signs after the X login is verified.
   * Today the verification is operator-side (X-Admin-Token); OAuth with X plugs in here later.
   */
  r.post("/api/social/claim", express.json(), async (req, res) => {
    try {
      const token = process.env.ADMIN_TOKEN;
      if (!token || req.header("x-admin-token") !== token) return res.status(401).json({ error: "unauthorized" });
      const raw = process.env.SOCIAL_CLAIM_AUTHORITY_KEYPAIR;
      if (!raw) return res.status(500).json({ error: "SOCIAL_CLAIM_AUTHORITY_KEYPAIR not set" });
      const { Keypair, Transaction } = await import("@solana/web3.js");
      const { bs58decode } = await import("@openpump/sdk");
      const kp = raw.trim().startsWith("[") ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : Keypair.fromSecretKey(bs58decode(raw.trim()));
      const { platform, userId, recipient } = req.body as { platform: number; userId: string; recipient: string };
      const social = pda.socialFeePda(String(userId).toLowerCase(), Number(platform));
      const tx = new Transaction().add(await client.collectForCreatorIx(social), await client.claimSocialFeePdaIx(kp.publicKey, String(userId).toLowerCase(), Number(platform), new PublicKey(recipient)));
      tx.feePayer = kp.publicKey;
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      res.json({ ok: true, sig });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get("/api/config", async (_req, res) => {
    const quoteMints = [{ mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 }];
    for (const entry of (process.env.QUOTE_MINTS || "").split(",").filter(Boolean)) {
      const [mint, symbol, dec] = entry.split(":");
      quoteMints.push({ mint, symbol: symbol || "QUOTE", decimals: Number(dec || 9) });
    }
    res.json({
      quoteMints,
      incentives: await getIncentives(),
      feeConfig: await getFeeConfig(),
      feesProgram: FEES_PROGRAM_ID.toBase58(),
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

  /** Pools on the AMM: graduated coins (source = migration) and pools anyone created directly (standalone). */
  r.get("/api/pools", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = db
      .prepare(
        `SELECT p.pool, p.mint, p.base_mint, p.quote_mint, p.lp_mint, p.creator, p.coin_creator, p.idx, p.base_res, p.quote_res, p.lp_supply, p.virtual_quote, p.created_at, p.source, p.decimals,
                c.name, c.symbol, c.image, c.price, c.mcap, c.volume_sol, c.trades, c.last_trade_at, c.quote_symbol, c.quote_decimals, c.token_program
         FROM pools p LEFT JOIN coins c ON c.mint = p.mint
         ORDER BY CAST(p.quote_res AS INTEGER) DESC LIMIT ?`
      )
      .all(limit);
    res.json(rows);
  });
  r.get("/api/pools/:pool", (req, res) => {
    const row = db.prepare(`SELECT p.*, c.name, c.symbol, c.image, c.price, c.mcap, c.volume_sol, c.trades, c.quote_symbol, c.quote_decimals, c.token_program FROM pools p LEFT JOIN coins c ON c.mint = p.mint WHERE p.pool=?`).get(req.params.pool);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });

  r.get("/api/coins/:mint", (req, res) => {
    const coin = db.prepare("SELECT * FROM coins WHERE mint=?").get(req.params.mint);
    if (!coin) return res.status(404).json({ error: "not found" });
    const trades = db.prepare("SELECT * FROM trades WHERE mint=? ORDER BY ts DESC, slot DESC LIMIT 50").all(req.params.mint);
    res.json({ ...(coin as any), recentTrades: trades });
  });

  /** Holder-reward coins: paid-out history + the undistributed pot (live from chain). */
  r.get("/api/coins/:mint/rewards", async (req, res) => {
    try {
      const coin = db.prepare("SELECT quote_mint, is_holder_reward, holder_paid FROM coins WHERE mint=?").get(req.params.mint) as any;
      if (!coin) return res.status(404).json({ error: "not found" });
      const rows = db.prepare("SELECT * FROM distributions WHERE mint=? ORDER BY ts DESC LIMIT 50").all(req.params.mint);
      const pot = coin.is_holder_reward ? await client.holderPot(new PublicKey(req.params.mint), new PublicKey(coin.quote_mint)) : 0n;
      res.json({ isHolderReward: !!coin.is_holder_reward, paid: coin.holder_paid, pot: pot.toString(), distributions: rows });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
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
      const coins = db.prepare("SELECT * FROM coins WHERE creator=? ORDER BY created_at DESC").all(req.params.pubkey) as any[];
      const claimable = await client.creatorClaimable(creator);
      const quotes: any[] = [];
      const seen = new Set<string>();
      for (const c of coins) {
        if (!c.quote_mint || c.quote_mint === "So11111111111111111111111111111111111111112" || seen.has(c.quote_mint)) continue;
        seen.add(c.quote_mint);
        const q = await client.creatorClaimableQuote(creator, new PublicKey(c.quote_mint)).catch(() => ({ curve: 0n, amm: 0n }));
        quotes.push({ mint: c.quote_mint, symbol: c.quote_symbol, decimals: c.quote_decimals, curve: q.curve.toString(), amm: q.amm.toString() });
      }
      res.json({ coins, claimable: { curveLamports: claimable.curveLamports.toString(), ammWsolLamports: claimable.ammWsolLamports.toString(), quotes } });
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
