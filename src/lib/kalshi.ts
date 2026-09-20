import crypto from "crypto";
import { readFileSync } from "fs";

/**
 * Minimal, read-only Kalshi trade-api v2 client.
 *
 * This app never places, edits or cancels an order — it only reads fills,
 * settlements and positions. Requests are signed per Kalshi's API-key scheme:
 * an RSA-PSS/SHA-256 signature over `timestampMs + METHOD + path`, where the
 * path carries the `/trade-api/v2` prefix and excludes the query string.
 */

const DEFAULT_BASE = "https://api.elections.kalshi.com";
const PREFIX = "/trade-api/v2";

export type KalshiConfig = {
  keyId: string;
  privateKeyPem: string;
  base: string;
};

export class KalshiNotConfigured extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "KalshiNotConfigured";
  }
}

export function loadConfig(): KalshiConfig | null {
  const keyId = process.env.KALSHI_API_KEY_ID?.trim();
  const base = (process.env.KALSHI_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
  const inline = process.env.KALSHI_PRIVATE_KEY?.trim();
  const path = process.env.KALSHI_PRIVATE_KEY_PATH?.trim();
  if (!keyId) return null;

  let pem: string | null = null;
  if (inline) {
    // An inline PEM in an env var usually arrives with escaped newlines.
    pem = inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  } else if (path) {
    try {
      pem = readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }
  if (!pem) return null;
  return { keyId, privateKeyPem: pem, base };
}

/** True when both halves of the credential are present and the PEM parses. */
export function configStatus(): { configured: boolean; base: string; reason?: string } {
  const base = (process.env.KALSHI_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
  const cfg = loadConfig();
  if (!cfg) {
    return {
      configured: false,
      base,
      reason: process.env.KALSHI_API_KEY_ID
        ? "Private key missing or unreadable (set KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH)"
        : "KALSHI_API_KEY_ID is not set",
    };
  }
  try {
    crypto.createPrivateKey(cfg.privateKeyPem);
  } catch (e) {
    return { configured: false, base, reason: `Private key did not parse: ${(e as Error).message}` };
  }
  return { configured: true, base };
}

function sign(cfg: KalshiConfig, timestampMs: string, method: string, path: string): string {
  const message = `${timestampMs}${method.toUpperCase()}${path}`;
  return crypto
    .sign("sha256", Buffer.from(message, "utf8"), {
      key: crypto.createPrivateKey(cfg.privateKeyPem),
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");
}

async function signedGet<T>(cfg: KalshiConfig, path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const fullPath = `${PREFIX}${path}`;
  const ts = Date.now().toString();
  const res = await fetch(`${cfg.base}${fullPath}${qs.size ? `?${qs}` : ""}`, {
    method: "GET",
    headers: {
      "KALSHI-ACCESS-KEY": cfg.keyId,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      "KALSHI-ACCESS-SIGNATURE": sign(cfg, ts, "GET", fullPath),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kalshi ${res.status} ${res.statusText} on ${path}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** Public market data needs no signature. */
async function publicGet<T>(base: string, path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`${base}${PREFIX}${path}${qs.size ? `?${qs}` : ""}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Kalshi ${res.status} on ${path}`);
  return (await res.json()) as T;
}

// --- numeric coercion -------------------------------------------------------

/**
 * Kalshi has two generations of numeric fields in flight: legacy integer cents
 * (`yes_price`, `count`) and newer fixed-point decimal strings in dollars
 * (`yes_price_dollars`, `count_fp`). Read whichever is present so the sync
 * survives the transition in either direction.
 */
export function fpDollarsToCents(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fpCount(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

// --- shapes we actually read ------------------------------------------------

export type RawFill = Record<string, unknown>;
export type RawSettlement = Record<string, unknown>;

export type NormalizedFill = {
  ticker: string;
  /** Which outcome was traded — yes or no. */
  side: "yes" | "no";
  /** +1 bought, -1 sold. */
  direction: 1 | -1;
  count: number;
  /** Price paid per contract for `side`, in cents. */
  priceCents: number;
  feeCents: number;
  createdTime: string;
};

export function normalizeFill(f: RawFill): NormalizedFill | null {
  const ticker = String(f.ticker ?? f.market_ticker ?? "");
  if (!ticker) return null;

  const rawSide = String(f.outcome_side ?? f.side ?? "yes").toLowerCase();
  const side: "yes" | "no" = rawSide === "no" ? "no" : "yes";

  // Legacy fills carry action=buy|sell; the current schema carries
  // book_side=bid|ask, where resting on the bid is a buy.
  const action = String(f.action ?? "").toLowerCase();
  const bookSide = String(f.book_side ?? "").toLowerCase();
  const isSell = action === "sell" || bookSide === "ask";
  const direction: 1 | -1 = isSell ? -1 : 1;

  const count = f.count_fp !== undefined ? fpCount(f.count_fp) : fpCount(f.count);
  const priceCents =
    side === "yes"
      ? f.yes_price_dollars !== undefined
        ? fpDollarsToCents(f.yes_price_dollars)
        : fpCount(f.yes_price)
      : f.no_price_dollars !== undefined
        ? fpDollarsToCents(f.no_price_dollars)
        : fpCount(f.no_price);

  return {
    ticker,
    side,
    direction,
    count,
    priceCents,
    feeCents: f.fee_cost !== undefined ? fpDollarsToCents(f.fee_cost) : 0,
    createdTime: String(f.created_time ?? ""),
  };
}

export type NormalizedSettlement = {
  ticker: string;
  eventTicker: string;
  /** "yes" | "no" | "scalar" — which side of the market paid out. */
  marketResult: string;
  yesCount: number;
  noCount: number;
  /** Cost basis across both sides, in cents. */
  totalCostCents: number;
  /** What a single YES contract paid, in cents (100 on a YES resolution). */
  valueCents: number;
  /**
   * Kalshi's own `revenue` field. Unreliable as a payout: a position that was
   * closed out before the market resolved nets to cash immediately and reports
   * revenue 0 even though it paid. Kept for reference; `payoutCents` is what
   * the tracker uses.
   */
  revenueCents: number;
  /** Gross returned across both sides, in cents. */
  payoutCents: number;
  feeCents: number;
  settledTime: string;
};

export function normalizeSettlement(s: RawSettlement): NormalizedSettlement | null {
  const ticker = String(s.ticker ?? "");
  if (!ticker) return null;

  const marketResult = String(s.market_result ?? "").toLowerCase();
  const yesCount = s.yes_count_fp !== undefined ? fpCount(s.yes_count_fp) : fpCount(s.yes_count);
  const noCount = s.no_count_fp !== undefined ? fpCount(s.no_count_fp) : fpCount(s.no_count);
  const yesCost =
    s.yes_total_cost_dollars !== undefined
      ? fpDollarsToCents(s.yes_total_cost_dollars)
      : Math.round(fpCount(s.yes_total_cost));
  const noCost =
    s.no_total_cost_dollars !== undefined
      ? fpDollarsToCents(s.no_total_cost_dollars)
      : Math.round(fpCount(s.no_total_cost));

  // `value` is what one YES contract paid. When it's absent, a yes/no result
  // implies it exactly.
  const valueCents =
    s.value !== null && s.value !== undefined
      ? Math.round(fpCount(s.value))
      : marketResult === "yes"
        ? 100
        : 0;

  // Each YES contract pays `value`; each NO contract pays the complement. This
  // holds for a straight resolution, for a scalar settlement, and for a
  // position that was traded out of before the close.
  const payoutCents = Math.round(yesCount * valueCents + noCount * (100 - valueCents));

  return {
    ticker,
    eventTicker: String(s.event_ticker ?? ""),
    marketResult,
    yesCount,
    noCount,
    totalCostCents: yesCost + noCost,
    valueCents,
    revenueCents: Math.round(fpCount(s.revenue)),
    payoutCents,
    feeCents: s.fee_cost !== undefined ? fpDollarsToCents(s.fee_cost) : 0,
    settledTime: String(s.settled_time ?? ""),
  };
}

// --- paginated readers ------------------------------------------------------

async function paginate<T>(
  cfg: KalshiConfig,
  path: string,
  key: string,
  query: Record<string, string | number | undefined>,
  maxPages = 40,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const body = await signedGet<Record<string, unknown>>(cfg, path, { ...query, limit: 1000, cursor });
    const items = (body[key] as T[]) ?? [];
    out.push(...items);
    cursor = (body.cursor as string) || undefined;
    if (!cursor || items.length === 0) break;
  }
  return out;
}

export async function fetchFills(cfg: KalshiConfig, minTs?: number): Promise<NormalizedFill[]> {
  const raw = await paginate<RawFill>(cfg, "/portfolio/fills", "fills", { min_ts: minTs });
  return raw.map(normalizeFill).filter((f): f is NormalizedFill => f !== null);
}

export async function fetchSettlements(cfg: KalshiConfig, minTs?: number): Promise<NormalizedSettlement[]> {
  const raw = await paginate<RawSettlement>(cfg, "/portfolio/settlements", "settlements", { min_ts: minTs });
  return raw.map(normalizeSettlement).filter((s): s is NormalizedSettlement => s !== null);
}

export type NormalizedPosition = {
  ticker: string;
  /** Signed: positive is long YES, negative is long NO. */
  position: number;
  /** Cost currently at risk, in cents. */
  exposureCents: number;
  feesCents: number;
  realizedPnlCents: number;
  lastUpdated: string;
};

export function normalizePosition(p: Record<string, unknown>): NormalizedPosition | null {
  const ticker = String(p.ticker ?? "");
  if (!ticker) return null;
  return {
    ticker,
    position: p.position_fp !== undefined ? fpCount(p.position_fp) : fpCount(p.position),
    exposureCents:
      p.market_exposure_dollars !== undefined
        ? fpDollarsToCents(p.market_exposure_dollars)
        : Math.round(fpCount(p.market_exposure)),
    feesCents: p.fees_paid_dollars !== undefined ? fpDollarsToCents(p.fees_paid_dollars) : 0,
    realizedPnlCents:
      p.realized_pnl_dollars !== undefined
        ? fpDollarsToCents(p.realized_pnl_dollars)
        : Math.round(fpCount(p.realized_pnl)),
    lastUpdated: String(p.last_updated_ts ?? ""),
  };
}

export async function fetchPositions(cfg: KalshiConfig): Promise<NormalizedPosition[]> {
  const raw = await paginate<Record<string, unknown>>(cfg, "/portfolio/positions", "market_positions", {});
  return raw.map(normalizePosition).filter((p): p is NormalizedPosition => p !== null);
}

export type MarketMeta = {
  ticker: string;
  eventTicker: string;
  title: string;
  yesSubTitle: string;
  closeTime: string | null;
  result: string;
};

export async function fetchMarket(base: string, ticker: string): Promise<MarketMeta | null> {
  try {
    const body = await publicGet<{ market?: Record<string, unknown> }>(base, `/markets/${encodeURIComponent(ticker)}`);
    const m = body.market;
    if (!m) return null;
    return {
      ticker: String(m.ticker ?? ticker),
      eventTicker: String(m.event_ticker ?? ""),
      title: String(m.title ?? ""),
      yesSubTitle: String(m.yes_sub_title ?? ""),
      closeTime: (m.close_time as string) ?? null,
      result: String(m.result ?? ""),
    };
  } catch {
    return null;
  }
}

/** Confirms the credential works, without touching anything that can trade. */
export async function ping(cfg: KalshiConfig): Promise<{ ok: boolean; detail: string }> {
  try {
    const body = await signedGet<Record<string, unknown>>(cfg, "/portfolio/balance");
    const cents =
      body.balance_dollars !== undefined ? fpDollarsToCents(body.balance_dollars) : fpCount(body.balance);
    return { ok: true, detail: `balance ${(cents / 100).toFixed(2)} USD` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
