import {
  cacheMarket,
  createBet,
  finishSync,
  findGameByTeamsAndDate,
  findKalshiBet,
  gameCount,
  getCachedMarket,
  getGame,
  listBets,
  listGames,
  startSync,
  updateBet,
  upsertGames,
} from "./db";
import * as espn from "./espn";
import * as kalshi from "./kalshi";
import { gradeFromGame } from "./grade";
import { canonicalTeam, splitTeamPair, team as teamOf } from "./teams";
import type { Bet, Game } from "./types";

// --- ticker parsing ---------------------------------------------------------

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

export type ParsedTicker =
  | {
      type: "game";
      series: string;
      eventTicker: string;
      /** Kickoff date in the game's local calendar, as YYYY-MM-DD. */
      date: string;
      teams: [string, string] | null;
      pick: string | null;
    }
  | {
      type: "futures";
      series: string;
      eventTicker: string;
      pick: string | null;
    }
  | null;

/**
 * Kalshi NFL tickers come in two useful shapes:
 *   KXNFLGAME-26SEP20INDKC-KC   a single game, one market per team
 *   KXNFLAFCNORTH-27-PIT        a season-long futures market
 */
export function parseTicker(ticker: string): ParsedTicker {
  const game = /^(KXNFLGAME)-(\d{2})([A-Z]{3})(\d{2})([A-Z]{4,8})-([A-Z]{2,3})$/.exec(ticker);
  if (game) {
    const [, series, yy, mon, dd, pair, pick] = game;
    const month = MONTHS[mon];
    if (month) {
      const date = `20${yy}-${String(month).padStart(2, "0")}-${dd}`;
      return {
        type: "game",
        series,
        eventTicker: `${series}-${yy}${mon}${dd}${pair}`,
        date,
        teams: splitTeamPair(pair),
        pick: canonicalTeam(pick),
      };
    }
  }

  const futures = /^(KX[A-Z0-9]+?)-([A-Z0-9]+)-([A-Z]{2,3})$/.exec(ticker);
  if (futures) {
    const [, series, period, pick] = futures;
    return { type: "futures", series, eventTicker: `${series}-${period}`, pick: canonicalTeam(pick) };
  }

  const bare = /^(KX[A-Z0-9]+)-([A-Z0-9]+)$/.exec(ticker);
  if (bare) return { type: "futures", series: bare[1], eventTicker: ticker, pick: null };

  return null;
}

/** Which Kalshi series count as football. Extend with KALSHI_SERIES_PREFIXES. */
export function footballPrefixes(): string[] {
  const raw = process.env.KALSHI_SERIES_PREFIXES?.trim();
  if (raw) return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return ["KXNFL", "KXNCAAF", "KXCFB", "KXSUPERBOWL"];
}

export function isFootballTicker(ticker: string): boolean {
  const up = ticker.toUpperCase();
  return footballPrefixes().some((p) => up.startsWith(p));
}

// --- game schedule ----------------------------------------------------------

export type GamesSyncResult = { weeksFetched: number; games: number; season: number; week: number };

/** Refresh the current week (cheap) or backfill whole seasons. */
export async function syncGames(opts: { seasons?: number[]; full?: boolean } = {}): Promise<GamesSyncResult> {
  const logId = startSync("games");
  try {
    const current = await espn.fetchCurrent();
    let games: Game[] = current.games;
    let weeks = 1;

    const seasons = opts.seasons ?? (opts.full ? [current.season] : []);
    for (const season of seasons) {
      const seasonGames = await espn.fetchSeason(season);
      games = games.concat(seasonGames);
      weeks += 23;
    }

    // Later entries win, so a freshly-fetched current week overwrites the
    // copy the season backfill produced.
    const byId = new Map<string, Game>();
    for (const g of games) byId.set(g.id, g);
    const rows = [...byId.values()];
    upsertGames(rows);

    finishSync(logId, true, `${rows.length} games across ${weeks} fetch(es)`);
    return { weeksFetched: weeks, games: rows.length, season: current.season, week: current.week };
  } catch (e) {
    finishSync(logId, false, (e as Error).message);
    throw e;
  }
}

// --- Kalshi import ----------------------------------------------------------

export type KalshiSyncResult = {
  created: number;
  updated: number;
  skipped: number;
  positions: number;
  settlements: number;
  linkedGames: number;
  unlinked: string[];
};

type Candidate = {
  ticker: string;
  side: "yes" | "no";
  contracts: number;
  stakeCents: number;
  feesCents: number;
  status: Bet["status"];
  payoutCents: number | null;
  settledAt: string | null;
  placedAt: string;
};

export async function syncKalshi(): Promise<KalshiSyncResult> {
  const cfg = kalshi.loadConfig();
  if (!cfg) throw new kalshi.KalshiNotConfigured("Kalshi API credentials are not configured");

  const logId = startSync("kalshi");
  try {
    const [positions, settlements, fills] = await Promise.all([
      kalshi.fetchPositions(cfg),
      kalshi.fetchSettlements(cfg),
      kalshi.fetchFills(cfg),
    ]);

    // Earliest fill per ticker gives a real "placed at", and its side is the
    // original pick — which matters for a position that was later traded out
    // of, where the settlement's own counts are symmetric.
    const firstFill = new Map<string, kalshi.NormalizedFill>();
    for (const f of fills) {
      const prev = firstFill.get(f.ticker);
      if (!prev || f.createdTime < prev.createdTime) firstFill.set(f.ticker, f);
    }

    const candidates: Candidate[] = [];

    for (const s of settlements) {
      if (!isFootballTicker(s.ticker)) continue;
      const opened = firstFill.get(s.ticker);
      // Which side was actually backed: the opening fill if we have it,
      // otherwise whichever side carries the larger lifetime count.
      const side: "yes" | "no" = opened ? opened.side : s.noCount > s.yesCount ? "no" : "yes";
      const contracts = side === "yes" ? s.yesCount : s.noCount;
      const net = s.payoutCents - s.totalCostCents - s.feeCents;

      candidates.push({
        ticker: s.ticker,
        side,
        contracts: Math.max(contracts, side === "yes" ? s.yesCount : s.noCount),
        stakeCents: s.totalCostCents,
        feesCents: s.feeCents,
        // The pick, not the P/L, decides won vs lost — a winning pick that
        // fees ate into is still a winning pick, and the money is reported
        // separately.
        status: s.marketResult === side ? "won" : net === 0 ? "push" : "lost",
        payoutCents: s.payoutCents,
        settledAt: s.settledTime || null,
        placedAt: opened?.createdTime || s.settledTime || new Date().toISOString(),
      });
    }

    const settledTickers = new Set(settlements.map((s) => s.ticker));
    for (const p of positions) {
      if (!isFootballTicker(p.ticker)) continue;
      if (p.position === 0) continue;
      if (settledTickers.has(p.ticker)) continue;
      const opened = firstFill.get(p.ticker);
      candidates.push({
        ticker: p.ticker,
        side: p.position > 0 ? "yes" : "no",
        contracts: Math.abs(p.position),
        stakeCents: p.exposureCents,
        feesCents: p.feesCents,
        status: "open",
        payoutCents: null,
        settledAt: null,
        placedAt: opened?.createdTime || p.lastUpdated || new Date().toISOString(),
      });
    }

    // Make sure the schedule covers every season a bet touches, so the game
    // linkage below can actually find a match.
    const seasons = new Set<number>();
    for (const c of candidates) {
      const parsed = parseTicker(c.ticker);
      if (parsed?.type === "game") seasons.add(seasonForDate(parsed.date));
    }
    if (gameCount() === 0 || seasons.size > 0) {
      for (const season of seasons.size ? seasons : [new Date().getFullYear()]) {
        const rows = await espn.fetchSeason(season);
        if (rows.length) upsertGames(rows);
      }
    }

    let created = 0;
    let updated = 0;
    let linkedGames = 0;
    const unlinked: string[] = [];

    for (const c of candidates) {
      const parsed = parseTicker(c.ticker);
      const meta = await marketMeta(cfg.base, c.ticker);

      let game: Game | null = null;
      let pick = parsed && "pick" in parsed ? parsed.pick : null;

      if (parsed?.type === "game") {
        if (parsed.teams) {
          game = findGameByTeamsAndDate(parsed.teams[0], parsed.teams[1], parsed.date);
        }
        if (!game && pick) {
          // Fall back to the pick plus the date when the paired code couldn't
          // be split unambiguously.
          game = findGameByPickAndDate(pick, parsed.date);
        }
        if (!game) unlinked.push(c.ticker);
        else linkedGames++;
      }

      // A NO position is a bet against the named team, so the team actually
      // backed is the opponent.
      let backed = pick;
      if (c.side === "no" && game && pick) {
        backed = pick === game.homeTeam ? game.awayTeam : game.homeTeam;
      } else if (c.side === "no") {
        backed = null;
      }

      const entryPriceCents = c.contracts > 0 ? Math.round(c.stakeCents / c.contracts) : null;
      const selection = buildSelection(parsed, c.side, pick, meta?.title ?? "");

      const payload: Partial<Bet> = {
        source: "kalshi",
        kind: "contract",
        gameId: game?.id ?? null,
        season: game?.season ?? (parsed?.type === "game" ? seasonForDate(parsed.date) : null),
        seasonType: game?.seasonType ?? null,
        week: game?.week ?? null,
        eventDate: game?.date ?? (parsed?.type === "game" ? `${parsed.date}T00:00:00Z` : null),
        homeTeam: game?.homeTeam ?? null,
        awayTeam: game?.awayTeam ?? null,
        team: backed,
        marketType: parsed?.type === "game" ? "moneyline" : "other",
        selection,
        contracts: c.contracts,
        entryPriceCents,
        stakeCents: c.stakeCents,
        feesCents: c.feesCents,
        status: c.status,
        payoutCents: c.payoutCents,
        settledAt: c.settledAt,
        gradedBy: c.status === "open" ? null : "kalshi",
        kalshiTicker: c.ticker,
        kalshiEventTicker: parsed?.eventTicker ?? null,
        side: c.side,
        placedAt: c.placedAt,
      };

      const existing = findKalshiBet(c.ticker, c.side);
      if (existing) {
        // The note is the one field a person owns on an imported row, so the
        // sync must never stomp it.
        updateBet(existing.id, { ...payload, note: existing.note });
        updated++;
      } else {
        createBet(payload);
        created++;
      }
    }

    const detail = `${created} new, ${updated} updated, ${linkedGames} linked to games` +
      (unlinked.length ? `, ${unlinked.length} unlinked` : "");
    finishSync(logId, true, detail);

    return {
      created,
      updated,
      skipped: 0,
      positions: positions.length,
      settlements: settlements.length,
      linkedGames,
      unlinked,
    };
  } catch (e) {
    finishSync(logId, false, (e as Error).message);
    throw e;
  }
}

/** Cache-first market metadata: a listed market's title never changes. */
async function marketMeta(base: string, ticker: string) {
  const cached = getCachedMarket(ticker);
  if (cached && cached.title) return cached;
  const fresh = await kalshi.fetchMarket(base, ticker);
  if (fresh) {
    cacheMarket({
      ticker: fresh.ticker,
      eventTicker: fresh.eventTicker,
      title: fresh.title,
      yesSubTitle: fresh.yesSubTitle,
      closeTime: fresh.closeTime,
      result: fresh.result,
    });
    return fresh;
  }
  return cached;
}

function buildSelection(
  parsed: ParsedTicker,
  side: "yes" | "no",
  pick: string | null,
  title: string,
): string {
  if (parsed?.type === "game" && pick) {
    const t = teamOf(pick);
    const name = t ? t.name : pick;
    return side === "yes" ? `${name} to win` : `${name} NOT to win`;
  }
  if (title) return side === "yes" ? title : `NOT: ${title}`;
  return side === "yes" ? "Yes" : "No";
}

/** The NFL season a date belongs to — January and February are the prior year. */
function seasonForDate(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return m <= 2 ? y - 1 : y;
}

/**
 * Fallback linkage when the ticker's paired team code couldn't be split
 * unambiguously: only one team is known, so scan that day's games (plus the
 * neighbouring days, for the UTC boundary) for one the pick plays in.
 */
function findGameByPickAndDate(pick: string, isoDate: string): Game | null {
  const day = isoDate.slice(0, 10);
  const window = new Set([shiftDay(day, -1), day, shiftDay(day, 1)]);
  return (
    listGames().find(
      (g) => window.has(g.date.slice(0, 10)) && (g.homeTeam === pick || g.awayTeam === pick),
    ) ?? null
  );
}

function shiftDay(day: string, off: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Date(d.getTime() + off * 86400000).toISOString().slice(0, 10);
}

// --- auto-grading -----------------------------------------------------------

export type GradeSyncResult = { graded: number; details: { id: string; reason: string }[] };

/** Settle every open, game-linked manual bet whose game is now final. */
export function gradeOpenBets(): GradeSyncResult {
  const details: { id: string; reason: string }[] = [];
  for (const bet of listBets()) {
    if (bet.status !== "open" || !bet.gameId) continue;
    const game = getGame(bet.gameId);
    if (!game) continue;
    const grade = gradeFromGame(bet, game);
    if (!grade) continue;
    updateBet(bet.id, {
      status: grade.status,
      payoutCents: grade.payoutCents,
      settledAt: new Date().toISOString(),
      gradedBy: "scores",
    });
    details.push({ id: bet.id, reason: grade.reason });
  }
  return { graded: details.length, details };
}
