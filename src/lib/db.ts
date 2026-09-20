import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import type { Bet, BetKind, BetStatus, Game, MarketType } from "./types";
import { canonicalTeam } from "./teams";

const DB_PATH =
  process.env.BETS_DB_PATH ?? join(process.cwd(), "data", "bets.db");

// Next reloads modules on every edit in dev; cache the handle so we don't open
// a new connection (and re-run migrations) per request.
const globalForDb = globalThis as unknown as { _betsDb?: Database.Database };

function init(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS bets (
      id                TEXT PRIMARY KEY,
      source            TEXT NOT NULL DEFAULT 'manual',
      kind              TEXT NOT NULL DEFAULT 'odds',

      game_id           TEXT,
      season            INTEGER,
      season_type       INTEGER,
      week              INTEGER,
      event_date        TEXT,
      home_team         TEXT,
      away_team         TEXT,
      team              TEXT,
      market_type       TEXT NOT NULL DEFAULT 'moneyline',
      line              REAL,
      over_under        TEXT,
      selection         TEXT NOT NULL DEFAULT '',

      contracts         REAL,
      entry_price_cents INTEGER,
      american_odds     INTEGER,
      stake_cents       INTEGER NOT NULL DEFAULT 0,
      fees_cents        INTEGER NOT NULL DEFAULT 0,

      status            TEXT NOT NULL DEFAULT 'open',
      payout_cents      INTEGER,
      settled_at        TEXT,
      graded_by         TEXT,

      kalshi_ticker       TEXT,
      kalshi_event_ticker TEXT,
      side                TEXT,

      placed_at         TEXT NOT NULL,
      note              TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    -- One row per Kalshi position (ticker + side). The sync owns these rows and
    -- upserts on this key, so re-running it never duplicates a position.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_kalshi
      ON bets(kalshi_ticker, side) WHERE kalshi_ticker IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_bets_game   ON bets(game_id);
    CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
    CREATE INDEX IF NOT EXISTS idx_bets_week   ON bets(season, week);

    CREATE TABLE IF NOT EXISTS games (
      id            TEXT PRIMARY KEY,
      season        INTEGER NOT NULL,
      season_type   INTEGER NOT NULL,
      week          INTEGER NOT NULL,
      date          TEXT NOT NULL,
      short_name    TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL DEFAULT '',
      home_team     TEXT NOT NULL,
      away_team     TEXT NOT NULL,
      home_score    INTEGER,
      away_score    INTEGER,
      state         TEXT NOT NULL DEFAULT 'pre',
      completed     INTEGER NOT NULL DEFAULT 0,
      status_detail TEXT NOT NULL DEFAULT '',
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_games_week ON games(season, season_type, week);
    CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);

    -- Kalshi market metadata cache: the public /markets endpoint is the only
    -- place a ticker's human title lives, and it never changes once listed.
    CREATE TABLE IF NOT EXISTS kalshi_markets (
      ticker       TEXT PRIMARY KEY,
      event_ticker TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      yes_sub_title TEXT NOT NULL DEFAULT '',
      close_time   TEXT,
      result       TEXT NOT NULL DEFAULT '',
      fetched_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      ok          INTEGER NOT NULL DEFAULT 0,
      detail      TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

export function getDb(): Database.Database {
  if (!globalForDb._betsDb) globalForDb._betsDb = init();
  return globalForDb._betsDb;
}

// --- coercion ---------------------------------------------------------------

const now = () => new Date().toISOString();

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = str(v) as T;
  return allowed.includes(s) ? s : fallback;
}

const KINDS = ["contract", "odds"] as const;
const STATUSES = ["open", "won", "lost", "push", "void"] as const;
const MARKETS = ["moneyline", "spread", "total", "prop", "other"] as const;

// --- row <-> object ---------------------------------------------------------

type Row = Record<string, unknown>;

function toBet(r: Row): Bet {
  return {
    id: r.id as string,
    source: r.source as Bet["source"],
    kind: r.kind as BetKind,
    gameId: (r.game_id as string) ?? null,
    season: r.season as number | null,
    seasonType: r.season_type as number | null,
    week: r.week as number | null,
    eventDate: (r.event_date as string) ?? null,
    homeTeam: (r.home_team as string) ?? null,
    awayTeam: (r.away_team as string) ?? null,
    team: (r.team as string) ?? null,
    marketType: r.market_type as MarketType,
    line: r.line as number | null,
    overUnder: (r.over_under as "over" | "under") ?? null,
    selection: str(r.selection),
    contracts: r.contracts as number | null,
    entryPriceCents: r.entry_price_cents as number | null,
    americanOdds: r.american_odds as number | null,
    stakeCents: int(r.stake_cents),
    feesCents: int(r.fees_cents),
    status: r.status as BetStatus,
    payoutCents: r.payout_cents as number | null,
    settledAt: (r.settled_at as string) ?? null,
    gradedBy: (r.graded_by as Bet["gradedBy"]) ?? null,
    kalshiTicker: (r.kalshi_ticker as string) ?? null,
    kalshiEventTicker: (r.kalshi_event_ticker as string) ?? null,
    side: (r.side as "yes" | "no") ?? null,
    placedAt: str(r.placed_at),
    note: str(r.note),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function toGame(r: Row): Game {
  return {
    id: r.id as string,
    season: int(r.season),
    seasonType: int(r.season_type),
    week: int(r.week),
    date: str(r.date),
    shortName: str(r.short_name),
    name: str(r.name),
    homeTeam: str(r.home_team),
    awayTeam: str(r.away_team),
    homeScore: r.home_score as number | null,
    awayScore: r.away_score as number | null,
    state: str(r.state),
    completed: Boolean(r.completed),
    statusDetail: str(r.status_detail),
    updatedAt: str(r.updated_at),
  };
}

// --- bets -------------------------------------------------------------------

export function listBets(): Bet[] {
  return (getDb()
    .prepare(
      `SELECT * FROM bets
        ORDER BY COALESCE(event_date, placed_at) DESC, created_at DESC`,
    )
    .all() as Row[]).map(toBet);
}

export function getBet(id: string): Bet | null {
  const r = getDb().prepare(`SELECT * FROM bets WHERE id = ?`).get(id) as Row | undefined;
  return r ? toBet(r) : null;
}

/**
 * Derive the amount at risk. A contract position risks what it paid; an odds
 * bet risks its stake. Keeping this in one place means the dashboard never has
 * to branch on `kind` to answer "how much is on the table".
 */
export function deriveStakeCents(input: {
  kind: BetKind;
  contracts?: number | null;
  entryPriceCents?: number | null;
  stakeCents?: number | null;
}): number {
  if (input.kind === "contract") {
    return Math.round((input.contracts ?? 0) * (input.entryPriceCents ?? 0));
  }
  return Math.max(0, int(input.stakeCents ?? 0));
}

export type BetInput = Partial<Bet> & { kind?: BetKind };

/** Normalize a client payload into DB columns, clamping anything unexpected. */
function normalize(input: BetInput, existing?: Bet) {
  const kind = oneOf(input.kind ?? existing?.kind, KINDS, "odds");
  const marketType = oneOf(
    input.marketType ?? existing?.marketType,
    MARKETS,
    kind === "contract" ? "moneyline" : "moneyline",
  );
  // Kalshi supports fractional contracts (a fill can be 2.72 shares), so this
  // is a real, not an integer.
  const contracts = input.contracts !== undefined ? numOrNull(input.contracts) : existing?.contracts ?? null;
  const entryPriceCents =
    input.entryPriceCents !== undefined ? intOrNull(input.entryPriceCents) : existing?.entryPriceCents ?? null;
  const stakeRaw = input.stakeCents !== undefined ? intOrNull(input.stakeCents) : existing?.stakeCents ?? 0;
  const stake = deriveStakeCents({ kind, contracts, entryPriceCents, stakeCents: stakeRaw });

  const status = oneOf(input.status ?? existing?.status, STATUSES, "open");
  const team = input.team !== undefined ? canonicalTeam(input.team) : existing?.team ?? null;

  return {
    source: oneOf(input.source ?? existing?.source, ["manual", "kalshi"] as const, "manual"),
    kind,
    game_id: input.gameId !== undefined ? (input.gameId || null) : existing?.gameId ?? null,
    season: input.season !== undefined ? intOrNull(input.season) : existing?.season ?? null,
    season_type: input.seasonType !== undefined ? intOrNull(input.seasonType) : existing?.seasonType ?? null,
    week: input.week !== undefined ? intOrNull(input.week) : existing?.week ?? null,
    event_date: input.eventDate !== undefined ? (input.eventDate || null) : existing?.eventDate ?? null,
    home_team: input.homeTeam !== undefined ? canonicalTeam(input.homeTeam) : existing?.homeTeam ?? null,
    away_team: input.awayTeam !== undefined ? canonicalTeam(input.awayTeam) : existing?.awayTeam ?? null,
    team,
    market_type: marketType,
    line: input.line !== undefined ? numOrNull(input.line) : existing?.line ?? null,
    over_under:
      input.overUnder !== undefined
        ? (input.overUnder === "over" || input.overUnder === "under" ? input.overUnder : null)
        : existing?.overUnder ?? null,
    selection: input.selection !== undefined ? str(input.selection).trim() : existing?.selection ?? "",
    contracts,
    entry_price_cents: entryPriceCents,
    american_odds: input.americanOdds !== undefined ? intOrNull(input.americanOdds) : existing?.americanOdds ?? null,
    stake_cents: stake,
    fees_cents: input.feesCents !== undefined ? int(input.feesCents) : existing?.feesCents ?? 0,
    status,
    payout_cents: input.payoutCents !== undefined ? intOrNull(input.payoutCents) : existing?.payoutCents ?? null,
    settled_at: input.settledAt !== undefined ? (input.settledAt || null) : existing?.settledAt ?? null,
    graded_by: input.gradedBy !== undefined ? (input.gradedBy || null) : existing?.gradedBy ?? null,
    kalshi_ticker: input.kalshiTicker !== undefined ? (input.kalshiTicker || null) : existing?.kalshiTicker ?? null,
    kalshi_event_ticker:
      input.kalshiEventTicker !== undefined ? (input.kalshiEventTicker || null) : existing?.kalshiEventTicker ?? null,
    side: input.side !== undefined ? (input.side === "yes" || input.side === "no" ? input.side : null) : existing?.side ?? null,
    placed_at: input.placedAt !== undefined ? (input.placedAt || now()) : existing?.placedAt ?? now(),
    note: input.note !== undefined ? str(input.note) : existing?.note ?? "",
  };
}

export function createBet(input: BetInput): Bet {
  const db = getDb();
  const id = randomUUID();
  const c = normalize(input);
  const ts = now();
  db.prepare(
    `INSERT INTO bets (id, source, kind, game_id, season, season_type, week, event_date,
        home_team, away_team, team, market_type, line, over_under, selection,
        contracts, entry_price_cents, american_odds, stake_cents, fees_cents,
        status, payout_cents, settled_at, graded_by,
        kalshi_ticker, kalshi_event_ticker, side, placed_at, note, created_at, updated_at)
     VALUES (@id, @source, @kind, @game_id, @season, @season_type, @week, @event_date,
        @home_team, @away_team, @team, @market_type, @line, @over_under, @selection,
        @contracts, @entry_price_cents, @american_odds, @stake_cents, @fees_cents,
        @status, @payout_cents, @settled_at, @graded_by,
        @kalshi_ticker, @kalshi_event_ticker, @side, @placed_at, @note, @created_at, @updated_at)`,
  ).run({ ...c, id, created_at: ts, updated_at: ts });
  return getBet(id)!;
}

export function updateBet(id: string, input: BetInput): Bet | null {
  const existing = getBet(id);
  if (!existing) return null;
  const c = normalize(input, existing);
  getDb()
    .prepare(
      `UPDATE bets SET source=@source, kind=@kind, game_id=@game_id, season=@season,
        season_type=@season_type, week=@week, event_date=@event_date, home_team=@home_team,
        away_team=@away_team, team=@team, market_type=@market_type, line=@line,
        over_under=@over_under, selection=@selection, contracts=@contracts,
        entry_price_cents=@entry_price_cents, american_odds=@american_odds,
        stake_cents=@stake_cents, fees_cents=@fees_cents, status=@status,
        payout_cents=@payout_cents, settled_at=@settled_at, graded_by=@graded_by,
        kalshi_ticker=@kalshi_ticker, kalshi_event_ticker=@kalshi_event_ticker, side=@side,
        placed_at=@placed_at, note=@note, updated_at=@updated_at
       WHERE id=@id`,
    )
    .run({ ...c, id, updated_at: now() });
  return getBet(id);
}

export function deleteBet(id: string): boolean {
  return getDb().prepare(`DELETE FROM bets WHERE id = ?`).run(id).changes > 0;
}

/** Find the row the Kalshi sync owns for a (ticker, side) position. */
export function findKalshiBet(ticker: string, side: "yes" | "no"): Bet | null {
  const r = getDb()
    .prepare(`SELECT * FROM bets WHERE kalshi_ticker = ? AND side = ?`)
    .get(ticker, side) as Row | undefined;
  return r ? toBet(r) : null;
}

// --- games ------------------------------------------------------------------

export function upsertGames(games: Game[]): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO games (id, season, season_type, week, date, short_name, name,
        home_team, away_team, home_score, away_score, state, completed, status_detail, updated_at)
     VALUES (@id, @season, @season_type, @week, @date, @short_name, @name,
        @home_team, @away_team, @home_score, @away_score, @state, @completed, @status_detail, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
        season=excluded.season, season_type=excluded.season_type, week=excluded.week,
        date=excluded.date, short_name=excluded.short_name, name=excluded.name,
        home_team=excluded.home_team, away_team=excluded.away_team,
        home_score=excluded.home_score, away_score=excluded.away_score,
        state=excluded.state, completed=excluded.completed,
        status_detail=excluded.status_detail, updated_at=excluded.updated_at`,
  );
  const run = db.transaction((rows: Game[]) => {
    for (const g of rows) {
      stmt.run({
        id: g.id,
        season: g.season,
        season_type: g.seasonType,
        week: g.week,
        date: g.date,
        short_name: g.shortName,
        name: g.name,
        home_team: g.homeTeam,
        away_team: g.awayTeam,
        home_score: g.homeScore,
        away_score: g.awayScore,
        state: g.state,
        completed: g.completed ? 1 : 0,
        status_detail: g.statusDetail,
        updated_at: now(),
      });
    }
  });
  run(games);
  return games.length;
}

export function listGames(filter: { season?: number; seasonType?: number; week?: number } = {}): Game[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.season) { where.push("season = ?"); args.push(filter.season); }
  if (filter.seasonType) { where.push("season_type = ?"); args.push(filter.seasonType); }
  if (filter.week) { where.push("week = ?"); args.push(filter.week); }
  const sql = `SELECT * FROM games ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date ASC`;
  return (getDb().prepare(sql).all(...args) as Row[]).map(toGame);
}

export function getGame(id: string): Game | null {
  const r = getDb().prepare(`SELECT * FROM games WHERE id = ?`).get(id) as Row | undefined;
  return r ? toGame(r) : null;
}

export function gameCount(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM games`).get() as { n: number }).n;
}

/**
 * Match a game by kickoff date and the pair of teams involved. Kalshi's ticker
 * carries a date in the game's local (US) calendar while ESPN stores kickoff in
 * UTC, so a night game lands on the next UTC day — hence the +/- 1 day window.
 */
export function findGameByTeamsAndDate(a: string, b: string, isoDate: string): Game | null {
  const day = isoDate.slice(0, 10);
  const d = new Date(`${day}T12:00:00Z`);
  const around = [-1, 0, 1].map((off) => {
    const x = new Date(d.getTime() + off * 86400000);
    return x.toISOString().slice(0, 10);
  });
  const rows = getDb()
    .prepare(
      `SELECT * FROM games
        WHERE ((home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?))
          AND substr(date, 1, 10) IN (?, ?, ?)
        ORDER BY date ASC LIMIT 1`,
    )
    .get(a, b, b, a, around[0], around[1], around[2]) as Row | undefined;
  return rows ? toGame(rows) : null;
}

// --- kalshi market cache ----------------------------------------------------

export type KalshiMarketMeta = {
  ticker: string;
  eventTicker: string;
  title: string;
  yesSubTitle: string;
  closeTime: string | null;
  result: string;
};

export function getCachedMarket(ticker: string): KalshiMarketMeta | null {
  const r = getDb().prepare(`SELECT * FROM kalshi_markets WHERE ticker = ?`).get(ticker) as Row | undefined;
  if (!r) return null;
  return {
    ticker: str(r.ticker),
    eventTicker: str(r.event_ticker),
    title: str(r.title),
    yesSubTitle: str(r.yes_sub_title),
    closeTime: (r.close_time as string) ?? null,
    result: str(r.result),
  };
}

export function cacheMarket(m: KalshiMarketMeta): void {
  getDb()
    .prepare(
      `INSERT INTO kalshi_markets (ticker, event_ticker, title, yes_sub_title, close_time, result, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ticker) DO UPDATE SET event_ticker=excluded.event_ticker, title=excluded.title,
         yes_sub_title=excluded.yes_sub_title, close_time=excluded.close_time,
         result=excluded.result, fetched_at=excluded.fetched_at`,
    )
    .run(m.ticker, m.eventTicker, m.title, m.yesSubTitle, m.closeTime, m.result, now());
}

// --- sync log ---------------------------------------------------------------

export function startSync(kind: "games" | "kalshi"): number {
  return Number(
    getDb().prepare(`INSERT INTO sync_log (kind, started_at) VALUES (?, ?)`).run(kind, now())
      .lastInsertRowid,
  );
}

export function finishSync(id: number, ok: boolean, detail: string): void {
  getDb()
    .prepare(`UPDATE sync_log SET finished_at = ?, ok = ?, detail = ? WHERE id = ?`)
    .run(now(), ok ? 1 : 0, detail.slice(0, 2000), id);
}

export function lastSync(kind: "games" | "kalshi") {
  const r = getDb()
    .prepare(`SELECT * FROM sync_log WHERE kind = ? ORDER BY id DESC LIMIT 1`)
    .get(kind) as Row | undefined;
  if (!r) return null;
  return {
    kind,
    startedAt: str(r.started_at),
    finishedAt: (r.finished_at as string) ?? null,
    ok: Boolean(r.ok),
    detail: str(r.detail),
  };
}
