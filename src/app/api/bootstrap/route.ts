import { NextResponse } from "next/server";
import { gameCount, lastSync, listBets, listGames } from "@/lib/db";
import { computeStats } from "@/lib/stats";
import { configStatus } from "@/lib/kalshi";
import { tokenIsConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * One call for the whole page: bets, the schedule, the rollups, and the state
 * of both sync channels. Saves the client four round trips on load.
 */
export async function GET() {
  const bets = listBets();
  const games = listGames();

  return NextResponse.json({
    bets,
    games,
    stats: computeStats(bets),
    current: currentWeek(games),
    kalshi: configStatus(),
    sync: { games: lastSync("games"), kalshi: lastSync("kalshi") },
    hasSchedule: gameCount() > 0,
    writesLocked: tokenIsConfigured(),
  });
}

/**
 * The week the league is in right now: the one owning the game closest to this
 * moment. Derived from the cached schedule so a page load costs no network.
 */
function currentWeek(games: { season: number; seasonType: number; week: number; date: string }[]) {
  if (games.length === 0) return null;
  const now = Date.now();
  let best = games[0];
  let bestGap = Infinity;
  for (const g of games) {
    const gap = Math.abs(new Date(g.date).getTime() - now);
    if (gap < bestGap) {
      bestGap = gap;
      best = g;
    }
  }
  return { season: best.season, seasonType: best.seasonType, week: best.week };
}
