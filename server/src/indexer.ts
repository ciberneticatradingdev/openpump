import { Connection, PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { AMM_PROGRAM_ID, CURVE_PROGRAM_ID, OpenpumpClient, decodeEventsFromParsedTx, type DecodedEvent } from "@openpump/sdk";
import type { Db } from "./db";
import { fetchMetadata } from "./metadata";

type Broadcast = (msg: any) => void;

export const WSOL = "So11111111111111111111111111111111111111112";
/** Known quote mints: QUOTE_MINTS="mint:SYMBOL:decimals,..." (SOL is always present). */
export function quoteInfo(mint: string | null) {
  if (!mint || mint === WSOL || /^1{32}$/.test(mint) || mint === "11111111111111111111111111111111") return { mint: WSOL, symbol: "SOL", decimals: 9 };
  for (const entry of (process.env.QUOTE_MINTS || "").split(",")) {
    const [m, sym, dec] = entry.split(":");
    if (m === mint) return { mint, symbol: sym || "QUOTE", decimals: Number(dec || 9) };
  }
  return { mint, symbol: mint.slice(0, 4), decimals: 9 };
}

const toStr = (v: any) => (v == null ? null : typeof v === "object" && "toString" in v ? v.toString() : String(v));
const num = (v: any) => Number(toStr(v));

export class Indexer {
  private client: OpenpumpClient;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private conn: Connection, private db: Db, private broadcast: Broadcast) {
    this.client = new OpenpumpClient(conn);
  }

  async start() {
    this.running = true;
    for (const p of [CURVE_PROGRAM_ID, AMM_PROGRAM_ID]) await this.backfill(p).catch((e) => console.error("backfill", p.toBase58(), e));
    const interval = Number(process.env.POLL_MS || (this.conn.rpcEndpoint.includes("api.devnet") || this.conn.rpcEndpoint.includes("api.mainnet") ? 6000 : 2500));
    let flip = 0;
    let backoff = 0;
    const tick = async () => {
      if (!this.running) return;
      try {
        // alternate programs per tick to stay under public-RPC rate limits
        await this.pollNew(flip++ % 2 === 0 ? CURVE_PROGRAM_ID : AMM_PROGRAM_ID);
        if (flip % 4 === 0) await this.fetchPendingMetadata();
        backoff = 0;
      } catch (e) {
        const msg = (e as Error).message || "";
        backoff = Math.min(60_000, backoff ? backoff * 2 : 5000);
        console.error("indexer tick", msg.slice(0, 120), msg.includes("429") ? `(backing off ${backoff}ms)` : "");
      }
      this.timer = setTimeout(tick, interval + backoff);
    };
    tick();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  // ------------------------------------------------------------- signature cursors

  private getCursor(p: PublicKey) {
    return this.db.prepare("SELECT last_sig, backfilled FROM cursors WHERE program=?").get(p.toBase58()) as any;
  }
  private setCursor(p: PublicKey, sig: string, backfilled = 1) {
    this.db
      .prepare("INSERT INTO cursors(program,last_sig,backfilled) VALUES(?,?,?) ON CONFLICT(program) DO UPDATE SET last_sig=excluded.last_sig, backfilled=excluded.backfilled")
      .run(p.toBase58(), sig, backfilled);
  }

  /** Walk history oldest→newest once (or until the known cursor). */
  private async backfill(p: PublicKey) {
    const cur = this.getCursor(p);
    if (cur?.backfilled) return;
    const all: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    for (let page = 0; page < 50; page++) {
      const batch = await this.conn.getSignaturesForAddress(p, { before, limit: 1000 }, "confirmed");
      if (!batch.length) break;
      all.push(...batch);
      before = batch[batch.length - 1].signature;
      if (batch.length < 1000) break;
    }
    const ok = all.filter((s) => !s.err).reverse();
    console.log(`[indexer] backfill ${p.toBase58().slice(0, 6)}… ${ok.length} txs`);
    await this.processSignatures(ok.map((s) => s.signature));
    if (ok.length) this.setCursor(p, ok[ok.length - 1].signature, 1);
    else this.setCursor(p, "", 1);
  }

  private async pollNew(p: PublicKey) {
    const cur = this.getCursor(p);
    const until = cur?.last_sig || undefined;
    const batch = await this.conn.getSignaturesForAddress(p, { until, limit: 200 }, "confirmed");
    const ok = batch.filter((s) => !s.err).reverse();
    if (!ok.length) return;
    await this.processSignatures(ok.map((s) => s.signature));
    this.setCursor(p, ok[ok.length - 1].signature, 1);
  }

  private get publicRpc() {
    return /api\.(devnet|mainnet-beta|testnet)\.solana\.com/.test(this.conn.rpcEndpoint);
  }

  /** Public Solana RPCs cap getTransaction hard: fetch one at a time with spacing and patient retries. */
  private async fetchTx(sig: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return await this.conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      } catch (e) {
        const msg = (e as Error).message || "";
        if (!/429|Too many requests/i.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw new Error(`gave up fetching ${sig.slice(0, 8)} after 429s`);
  }

  private async processSignatures(sigs: string[]) {
    const BATCH = Number(process.env.TX_BATCH || (this.publicRpc ? 1 : 10));
    const spacing = Number(process.env.TX_SPACING_MS || (this.publicRpc ? 700 : 0));
    for (let i = 0; i < sigs.length; i += BATCH) {
      const chunk = sigs.slice(i, i + BATCH);
      const txs = BATCH === 1
        ? [await this.fetchTx(chunk[0])]
        : await this.conn.getParsedTransactions(chunk, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      txs.forEach((tx, j) => {
        if (!tx || tx.meta?.err) return;
        const events = decodeEventsFromParsedTx(tx, chunk[j]);
        events.forEach((ev, k) => this.apply(ev, k));
      });
      if (spacing) await new Promise((r) => setTimeout(r, spacing));
    }
  }

  // ------------------------------------------------------------- event handlers

  private apply(ev: DecodedEvent, idx: number) {
    const d = ev.data;
    const ts = ev.blockTime ?? Math.floor(Date.now() / 1000);
    const handlers: Record<string, () => void> = {
      "curve:CreateEvent": () => {
        const q = quoteInfo(toStr(d.quoteMint));
        this.db
          .prepare(
            `INSERT INTO coins(mint,name,symbol,uri,creator,bonding_curve,created_at,created_slot,create_sig,v_sol,v_tok,r_sol,r_tok,supply,price,mcap,quote_mint,quote_symbol,quote_decimals,is_holder_reward)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(mint) DO NOTHING`
          )
          .run(
            toStr(d.mint), d.name, d.symbol, d.uri, toStr(d.creator), toStr(d.bondingCurve), ts, ev.slot, ev.signature,
            toStr(d.virtualSolReserves), toStr(d.virtualTokenReserves), "0", toStr(d.realTokenReserves), toStr(d.tokenTotalSupply),
            (num(d.virtualSolReserves) / num(d.virtualTokenReserves)) * 1e6,
            (num(d.virtualSolReserves) / num(d.virtualTokenReserves)) * num(d.tokenTotalSupply),
            q.mint, q.symbol, q.decimals, d.isHolderReward ? 1 : 0
          );
        this.broadcast({ type: "create", mint: toStr(d.mint), name: d.name, symbol: d.symbol, creator: toStr(d.creator), ts });
      },
      "curve:TradeEvent": () => {
        const mint = toStr(d.mint)!;
        const price = (num(d.virtualSolReserves) / num(d.virtualTokenReserves)) * 1e6;
        const supply = this.db.prepare("SELECT supply FROM coins WHERE mint=?").get(mint) as any;
        const mcap = supply ? (price / 1e6) * Number(supply.supply) : 0;
        const inserted = this.db
          .prepare(
            `INSERT INTO trades(id,sig,mint,venue,user,is_buy,sol,tokens,protocol_fee,creator_fee,price,ts,slot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`
          )
          .run(`${ev.signature}:${idx}`, ev.signature, mint, "curve", toStr(d.user), d.isBuy ? 1 : 0, toStr(d.solAmount), toStr(d.tokenAmount), toStr(d.protocolFee), toStr(d.creatorFee), price, ts, ev.slot);
        if (!inserted.changes) return;
        this.db
          .prepare(
            `UPDATE coins SET v_sol=?, v_tok=?, r_sol=?, r_tok=?, price=?, mcap=?, trades=trades+1, last_trade_at=?,
             volume_sol=CAST(CAST(volume_sol AS INTEGER)+CAST(? AS INTEGER) AS TEXT),
             creator_fees=CAST(CAST(creator_fees AS INTEGER)+CAST(? AS INTEGER) AS TEXT), protocol_fees=CAST(CAST(protocol_fees AS INTEGER)+CAST(? AS INTEGER) AS TEXT)
             WHERE mint=?`
          )
          .run(toStr(d.virtualSolReserves), toStr(d.virtualTokenReserves), toStr(d.realSolReserves), toStr(d.realTokenReserves), price, mcap, ts, toStr(d.solAmount), toStr(d.creatorFee), toStr(d.protocolFee), mint);
        this.broadcast({ type: "trade", venue: "curve", mint, user: toStr(d.user), isBuy: d.isBuy, sol: toStr(d.solAmount), tokens: toStr(d.tokenAmount), price, mcap, ts, sig: ev.signature });
      },
      "curve:CompleteEvent": () => {
        this.db.prepare("UPDATE coins SET complete=1, completed_at=? WHERE mint=?").run(ts, toStr(d.mint));
        this.broadcast({ type: "complete", mint: toStr(d.mint), ts });
      },
      "curve:MigrateEvent": () => {
        this.db.prepare("UPDATE coins SET migrated=1, migrated_at=?, pool=?, pool_base=?, pool_quote=? WHERE mint=?").run(ts, toStr(d.pool), toStr(d.baseAmount), toStr(d.quoteAmount), toStr(d.mint));
        this.db.prepare("INSERT OR IGNORE INTO pools(pool,mint) VALUES(?,?)").run(toStr(d.pool), toStr(d.mint));
        this.broadcast({ type: "migrate", mint: toStr(d.mint), pool: toStr(d.pool), ts });
      },
      "curve:DistributeFeeToHoldersEvent": () => {
        const mint = toStr(d.mint)!;
        const ins = this.db.prepare("INSERT INTO distributions(sig,mint,total,recipients,ts) VALUES(?,?,?,?,?) ON CONFLICT(sig) DO NOTHING").run(ev.signature, mint, toStr(d.total), num(d.recipients), ts);
        if (!ins.changes) return;
        // keep big sums exact: bind as integer, not JS number (SQLite would promote to REAL)
        this.db.prepare("UPDATE coins SET holder_paid=CAST(CAST(holder_paid AS INTEGER)+CAST(? AS INTEGER) AS TEXT) WHERE mint=?").run(toStr(d.total), mint);
        this.broadcast({ type: "holder_rewards", mint, total: toStr(d.total), recipients: num(d.recipients), sig: ev.signature, ts });
      },
      "amm:BuyEvent": () => this.ammTrade(ev, idx, true, ts),
      "amm:SellEvent": () => this.ammTrade(ev, idx, false, ts),
      "amm:CreatePoolEvent": () => {
        this.db.prepare("INSERT OR IGNORE INTO pools(pool,mint) VALUES(?,?)").run(toStr(d.pool), toStr(d.baseMint));
      },
    };
    handlers[`${ev.program}:${ev.name}`]?.();
  }

  private ammTrade(ev: DecodedEvent, idx: number, isBuy: boolean, ts: number) {
    const d = ev.data;
    const row = this.db.prepare("SELECT mint FROM pools WHERE pool=?").get(toStr(d.pool)) as any;
    if (!row) return; // pool not created by migration (foreign pool) — ignore
    const mint = row.mint;
    const baseRes = num(d.poolBaseReserves);
    const quoteRes = num(d.poolQuoteReserves);
    const price = (quoteRes / baseRes) * 1e6;
    const supply = this.db.prepare("SELECT supply FROM coins WHERE mint=?").get(mint) as any;
    const mcap = supply ? (price / 1e6) * Number(supply.supply) : 0;
    const sol = isBuy ? toStr(d.quoteAmountIn) : toStr(d.quoteAmountOut);
    const tokens = isBuy ? toStr(d.baseAmountOut) : toStr(d.baseAmountIn);
    const inserted = this.db
      .prepare(`INSERT INTO trades(id,sig,mint,venue,user,is_buy,sol,tokens,protocol_fee,creator_fee,price,ts,slot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(`${ev.signature}:${idx}`, ev.signature, mint, "amm", toStr(d.user), isBuy ? 1 : 0, sol, tokens, toStr(d.protocolFee), toStr(d.coinCreatorFee), price, ts, ev.slot);
    if (!inserted.changes) return;
    this.db
      .prepare(
        `UPDATE coins SET pool_base=?, pool_quote=?, price=?, mcap=?, trades=trades+1, last_trade_at=?,
         volume_sol=CAST(CAST(volume_sol AS INTEGER)+CAST(? AS INTEGER) AS TEXT),
         creator_fees=CAST(CAST(creator_fees AS INTEGER)+CAST(? AS INTEGER) AS TEXT), protocol_fees=CAST(CAST(protocol_fees AS INTEGER)+CAST(? AS INTEGER) AS TEXT) WHERE mint=?`
      )
      .run(toStr(d.poolBaseReserves), toStr(d.poolQuoteReserves), price, mcap, ts, sol, toStr(d.coinCreatorFee), toStr(d.protocolFee), mint);
    this.broadcast({ type: "trade", venue: "amm", mint, user: toStr(d.user), isBuy, sol, tokens, price, mcap, ts, sig: ev.signature });
  }

  // ------------------------------------------------------------- metadata

  private async fetchPendingMetadata() {
    const rows = this.db.prepare("SELECT mint, uri FROM coins WHERE metadata_fetched=0 ORDER BY created_at DESC LIMIT 5").all() as any[];
    for (const r of rows) {
      const m = await fetchMetadata(r.uri);
      this.db
        .prepare("UPDATE coins SET image=?, description=?, website=?, twitter=?, telegram=?, metadata_fetched=? WHERE mint=?")
        .run(m.image, m.description, m.website, m.twitter, m.telegram, m.ok ? 1 : 2, r.mint);
    }
  }
}
