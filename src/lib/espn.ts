import type { Game } from "./types";
import { canonicalTeam } from "./teams";

/**
 * ESPN's public scoreboard feed. No key, no auth, and it carries both the
 * schedule and live/final scores — which is all the auto-grader needs.
 */
const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export const SEASON_TYPE = { PRE: 1, REGULAR: 2, POST: 3 } as const;

type EspnResponse = {
  season?: { year?: number; type?: number };
  week?: { number?: number };
  events?: EspnEvent[];
};

type EspnEvent = {
  id: string;
  date: string;
  name?: string;
  shortName?: string;
  season?: { year?: number; type?: number };
  week?: { number?: number };
  competitions?: {
    status?: { type?: { state?: string; completed?: boolean; detail?: string } };
    competitors?: {
      homeAway?: string;
      score?: string;
      team?: { abbreviation?: string };
    }[];
  }[];
};

async function fetchScoreboard(params: Record<string, string | number>): Promise<EspnResponse> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  );
  qs.set("limit", "1000");
  const res = await fetch(`${BASE}?${qs}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} ${res.statusText}`);
  return (await res.json()) as EspnResponse;
}

function toGames(body: EspnResponse): Game[] {
  const out: Game[] = [];
  for (const e of body.events ?? []) {
    const comp = e.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    const homeAbbr = canonicalTeam(home?.team?.abbreviation);
    const awayAbbr = canonicalTeam(away?.team?.abbreviation);
    if (!homeAbbr || !awayAbbr) continue;

    const st = comp.status?.type;
    const completed = Boolean(st?.completed);
    const parseScore = (s: string | undefined) => {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    out.push({
      id: e.id,
      season: e.season?.year ?? body.season?.year ?? 0,
      seasonType: e.season?.type ?? body.season?.type ?? 2,
      week: e.week?.number ?? body.week?.number ?? 0,
      date: e.date,
      shortName: e.shortName ?? "",
      name: e.name ?? "",
      homeTeam: homeAbbr,
      awayTeam: awayAbbr,
      // A game that hasn't kicked off reports "0" for both sides; keep those
      // null so the grader can't read an unplayed game as a 0-0 tie.
      homeScore: st?.state === "pre" ? null : parseScore(home?.score),
      awayScore: st?.state === "pre" ? null : parseScore(away?.score),
      state: st?.state ?? "pre",
      completed,
      statusDetail: st?.detail ?? "",
      updatedAt: new Date().toISOString(),
    });
  }
  return out;
}

/** The league's current week, as ESPN sees it right now. */
export async function fetchCurrent(): Promise<{
  season: number;
  seasonType: number;
  week: number;
  games: Game[];
}> {
  const body = await fetchScoreboard({});
  return {
    season: body.season?.year ?? new Date().getFullYear(),
    seasonType: body.season?.type ?? SEASON_TYPE.REGULAR,
    week: body.week?.number ?? 1,
    games: toGames(body),
  };
}

export async function fetchWeek(season: number, seasonType: number, week: number): Promise<Game[]> {
  const body = await fetchScoreboard({ dates: season, seasontype: seasonType, week });
  return toGames(body);
}

/**
 * Whole season: 18 regular-season weeks plus the 5 postseason rounds. Fetched
 * with a small concurrency cap so a full backfill is a couple of seconds
 * without hammering the feed.
 */
export async function fetchSeason(season: number): Promise<Game[]> {
  const jobs: [number, number][] = [];
  for (let w = 1; w <= 18; w++) jobs.push([SEASON_TYPE.REGULAR, w]);
  for (let w = 1; w <= 5; w++) jobs.push([SEASON_TYPE.POST, w]);

  const out: Game[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const chunk = jobs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(([t, w]) => fetchWeek(season, t, w).catch(() => [] as Game[])),
    );
    for (const r of results) out.push(...r);
  }
  return out;
}
