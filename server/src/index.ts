import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import path from "node:path";
import { Connection } from "@solana/web3.js";
import { WebSocketServer, WebSocket } from "ws";
import { openDb } from "./db";
import { Indexer } from "./indexer";
import { apiRouter } from "./api";
import { uploadRouter } from "./upload";
import { HolderCrank } from "./crank";

const PORT = Number(process.env.PORT || 8787);
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

const db = openDb(process.env.DB_PATH || "./data/openpump.sqlite");
const conn = new Connection(RPC_URL, { commitment: "confirmed", wsEndpoint: process.env.RPC_WS_URL || undefined });

const app = express();
const origins = process.env.WEB_ORIGIN || "*";
app.use(cors({ origin: origins === "*" ? true : origins.split(",").map((o) => o.trim()) }));
app.use(express.json({ limit: "1mb" }));
app.get("/health", (_req, res) => res.json({ ok: true, rpc: RPC_URL }));
app.use(uploadRouter());
app.use(apiRouter(db, conn));

if (process.env.SERVE_WEB) {
  const dist = path.resolve(process.env.SERVE_WEB);
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const broadcast = (msg: any) => {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s);
};
wss.on("connection", (ws) => ws.send(JSON.stringify({ type: "hello", ts: Date.now() })));

const indexer = new Indexer(conn, db, broadcast);
const crank = new HolderCrank(conn, db, broadcast);
server.listen(PORT, () => {
  console.log(`[openpump] api http://localhost:${PORT}  rpc ${RPC_URL}`);
  indexer.start();
  crank.start();
});
process.on("SIGTERM", () => {
  indexer.stop();
  crank.stop();
  server.close();
});
