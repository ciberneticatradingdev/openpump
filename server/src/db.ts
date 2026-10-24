import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function openDb(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS coins (
      mint TEXT PRIMARY KEY,
      name TEXT, symbol TEXT, uri TEXT,
      image TEXT, description TEXT, website TEXT, twitter TEXT, telegram TEXT,
      creator TEXT NOT NULL,
      bonding_curve TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      created_slot INTEGER NOT NULL,
      create_sig TEXT,
      complete INTEGER DEFAULT 0,
      completed_at INTEGER,
      migrated INTEGER DEFAULT 0,
      migrated_at INTEGER,
      pool TEXT,
      v_sol TEXT, v_tok TEXT, r_sol TEXT, r_tok TEXT, supply TEXT,
      pool_base TEXT, pool_quote TEXT,
      price REAL DEFAULT 0,        -- lamports per whole token
      mcap REAL DEFAULT 0,         -- lamports
      volume_sol TEXT DEFAULT '0', -- lifetime lamports
      trades INTEGER DEFAULT 0,
      last_trade_at INTEGER,
      creator_fees TEXT DEFAULT '0',
      protocol_fees TEXT DEFAULT '0',
      metadata_fetched INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS coins_created ON coins(created_at DESC);
    CREATE INDEX IF NOT EXISTS coins_last_trade ON coins(last_trade_at DESC);
    CREATE INDEX IF NOT EXISTS coins_creator ON coins(creator);

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,          -- sig:index
      sig TEXT NOT NULL,
      mint TEXT NOT NULL,
      venue TEXT NOT NULL,          -- curve | amm
      user TEXT NOT NULL,
      is_buy INTEGER NOT NULL,
      sol TEXT NOT NULL,            -- lamports (pre-fee swap amount)
      tokens TEXT NOT NULL,         -- base units
      protocol_fee TEXT DEFAULT '0',
      creator_fee TEXT DEFAULT '0',
      price REAL NOT NULL,          -- lamports per whole token after the trade
      ts INTEGER NOT NULL,
      slot INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trades_mint_ts ON trades(mint, ts DESC);
    CREATE INDEX IF NOT EXISTS trades_ts ON trades(ts DESC);
    CREATE INDEX IF NOT EXISTS trades_user ON trades(user);

    CREATE TABLE IF NOT EXISTS cursors (program TEXT PRIMARY KEY, last_sig TEXT, backfilled INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pools (pool TEXT PRIMARY KEY, mint TEXT NOT NULL);
  `);
  return db;
}

export type Db = ReturnType<typeof openDb>;
