import { NextRequest, NextResponse } from "next/server";
import { gradeOpenBets, syncGames } from "@/lib/sync";
import { isAuthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Refresh scores, then settle every open bet the box score can decide.
 * Kalshi-sourced bets are left alone — their settlement record wins.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const games = await syncGames();
    const result = gradeOpenBets();
    // `live` lets the caller pace itself: the live worker polls fast while a
    // game is running and backs off to a slow heartbeat when none is.
    return NextResponse.json({ ok: true, ...result, live: games.live, week: games.week });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
