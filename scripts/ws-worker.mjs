#!/usr/bin/env node
/**
 * Live market prices over Kalshi's websocket.
 *
 * This is the one genuinely push-based feed in the app: Kalshi's `ticker`
 * channel streams a message every time one of our markets reprices (~6/sec
 * across a full Sunday slate). It exists so open positions can be marked to
 * market — "what is this worth right now" — rather than only at settlement.
 *
 * Read-only: it subscribes and writes prices to SQLite. It sends no orders.
 *
 *   node scripts/ws-worker.mjs [--db path] [--flush-ms 2000]
 */

import crypto from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import WebSocket from "ws";

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const DB_PATH = arg("db", process.env.BETS_DB_PATH || join(process.cwd(), "data", "bets.db"));
const FLUSH_MS = Number(arg("flush-ms", 2000));
const RESUB_MS = Number(arg("resub-ms", 60000));
const BASE = (process.env.KALSHI_API_BASE || "https://api.elections.kalshi.com")
  .replace(/^http/, "ws")
  .replace(/\/+$/, "");
const WS_PATH = "/trade-api/ws/v2";

const log = (...m) => console.log(new Date().toISOString(), ...m);

// --- credentials ------------------------------------------------------------

/**
 * systemd hands this process its environment via EnvironmentFile, but a local
 * run has the credential sitting in .env.local (which only Next reads). Load
 * those files when the variables are absent so the worker behaves the same on
 * a laptop as on the box. Existing environment always wins.
 */
function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    let text;
    try { text = readFileSync(join(process.cwd(), name), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, k, rawV] = m;
      if (process.env[k]) continue;
      process.env[k] = rawV.trim().replace(/^["']|["']$/g, "");
    }
  }
}

function loadKey() {
  const keyId = process.env.KALSHI_API_KEY_ID?.trim();
  const inline = process.env.KALSHI_PRIVATE_KEY?.trim();
  const path = process.env.KALSHI_PRIVATE_KEY_PATH?.trim();
  let pem = null;
  if (inline) pem = inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  else if (path) pem = readFileSync(path, "utf8");
  if (!keyId || !pem) throw new Error("KALSHI_API_KEY_ID and a private key are required");
  return { keyId, pem };
}

function authHeaders({ keyId, pem }) {
  const ts = Date.now().toString();
  const sig = crypto
    .sign("sha256", Buffer.from(`${ts}GET${WS_PATH}`), {
      key: crypto.createPrivateKey(pem),
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": sig,
  };
}

// --- database ---------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(`CREATE TABLE IF NOT EXISTS market_prices (
  ticker TEXT PRIMARY KEY, price_cents INTEGER, yes_bid_cents INTEGER,
  yes_ask_cents INTEGER, updated_at TEXT NOT NULL)`);

const upsert = db.prepare(
  `INSERT INTO market_prices (ticker, price_cents, yes_bid_cents, yes_ask_cents, updated_at)
   VALUES (@ticker, @price, @bid, @ask, @at)
   ON CONFLICT(ticker) DO UPDATE SET price_cents=excluded.price_cents,
     yes_bid_cents=excluded.yes_bid_cents, yes_ask_cents=excluded.yes_ask_cents,
     updated_at=excluded.updated_at`,
);
const writeBatch = db.transaction((rows) => { for (const r of rows) upsert.run(r); });

/** Tickers of every open, Kalshi-sourced bet — what we care about pricing. */
function openTickers() {
  return db
    .prepare(`SELECT DISTINCT kalshi_ticker AS t FROM bets
              WHERE status = 'open' AND kalshi_ticker IS NOT NULL`)
    .all()
    .map((r) => r.t)
    .filter(Boolean);
}

// --- price coercion ---------------------------------------------------------

/** Kalshi quotes dollars as fixed-point strings; this app stores cents. */
const toCents = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
/** Legacy integer-cent fields, kept for the transition. */
const asCents = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

// --- the socket -------------------------------------------------------------

const pending = new Map();
let ws = null;
let attempt = 0;
let subscribed = [];
let msgCount = 0;

function flush() {
  if (pending.size === 0) return;
  const rows = [...pending.values()];
  pending.clear();
  try {
    writeBatch(rows);
  } catch (e) {
    log("write failed:", e.message);
  }
}

function subscribe(tickers) {
  if (!ws || ws.readyState !== WebSocket.OPEN || tickers.length === 0) return;
  ws.send(
    JSON.stringify({ id: Date.now() % 100000, cmd: "subscribe",
      params: { channels: ["ticker"], market_tickers: tickers } }),
  );
  subscribed = tickers;
  log(`subscribed to ${tickers.length} market(s)`);
}

function connect(creds) {
  const tickers = openTickers();
  if (tickers.length === 0) {
    log("no open Kalshi positions — retrying in 5m");
    setTimeout(() => connect(creds), 300000);
    return;
  }

  ws = new WebSocket(`${BASE}${WS_PATH}`, { headers: authHeaders(creds) });

  ws.on("open", () => {
    attempt = 0;
    log("websocket open");
    subscribe(tickers);
  });

  ws.on("message", (raw) => {
    let j;
    try { j = JSON.parse(raw.toString()); } catch { return; }
    if (j.type === "error") { log("kalshi error:", JSON.stringify(j.msg)); return; }
    if (j.type !== "ticker") return;

    const m = j.msg || {};
    const ticker = m.market_ticker || m.ticker;
    if (!ticker) return;
    msgCount++;

    // Coalesce: the socket sends far more updates than are worth writing, so
    // keep only the newest per ticker between flushes.
    pending.set(ticker, {
      ticker,
      price: m.price_dollars !== undefined ? toCents(m.price_dollars) : asCents(m.price),
      bid: m.yes_bid_dollars !== undefined ? toCents(m.yes_bid_dollars) : asCents(m.yes_bid),
      ask: m.yes_ask_dollars !== undefined ? toCents(m.yes_ask_dollars) : asCents(m.yes_ask),
      at: new Date().toISOString(),
    });
  });

  const reconnect = (why) => {
    if (ws) { ws.removeAllListeners(); try { ws.close(); } catch {} ws = null; }
    attempt++;
    const wait = Math.min(60000, 1000 * 2 ** Math.min(attempt, 6));
    log(`${why} — reconnecting in ${wait / 1000}s`);
    setTimeout(() => connect(creds), wait);
  };

  ws.on("close", (code) => reconnect(`closed (${code})`));
  ws.on("error", (e) => reconnect(`error: ${e.message}`));
}

function main() {
  loadEnvFiles();
  const creds = loadKey();
  log(`ws worker up — ${BASE}${WS_PATH}, db ${DB_PATH}`);

  setInterval(flush, FLUSH_MS);

  // Positions change as bets settle or new ones are imported; re-subscribe when
  // the set actually differs rather than on a timer for its own sake.
  setInterval(() => {
    const now = openTickers();
    const changed =
      now.length !== subscribed.length || now.some((t) => !subscribed.includes(t));
    if (changed && ws?.readyState === WebSocket.OPEN) subscribe(now);
  }, RESUB_MS);

  setInterval(() => {
    if (msgCount) { log(`${msgCount} ticks in the last 5m`); msgCount = 0; }
  }, 300000);

  connect(creds);
}

process.on("SIGTERM", () => { flush(); process.exit(0); });
process.on("SIGINT", () => { flush(); process.exit(0); });

main();
