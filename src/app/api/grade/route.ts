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
    await syncGames();
    const result = gradeOpenBets();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
