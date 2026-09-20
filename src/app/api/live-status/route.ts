import { NextResponse } from "next/server";
import { listGames } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * A cheap "is anything happening" check, answered entirely from the cached
 * schedule — it makes no upstream request.
 *
 * The live worker calls this to decide whether to bother fetching the
 * scoreboard at all. Kickoff times are known in advance, so outside a game
 * window the worker can sleep instead of downloading a 224KB scoreboard every
 * two minutes to be told nothing has changed.
 */
export async function GET() {
  const games = listGames();
  const now = Date.now();

  const live = games.filter((g) => g.state === "in").length;

  const nextKickoff = games
    .filter((g) => g.state === "pre" && new Date(g.date).getTime() > now)
    .map((g) => g.date)
    .sort()[0] ?? null;

  // A game whose kickoff has passed but which the cache still calls "pre" means
  // the schedule is behind reality — the worker should go look.
  const overdue = games.some(
    (g) => g.state === "pre" && new Date(g.date).getTime() <= now,
  );

  return NextResponse.json({ live, nextKickoff, overdue, games: games.length });
}
