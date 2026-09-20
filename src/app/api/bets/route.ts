import { NextRequest, NextResponse } from "next/server";
import { createBet, listBets } from "@/lib/db";
import { isAuthorized } from "@/lib/auth";
import type { Bet } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ bets: listBets() });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Partial<Bet>;
  try {
    body = (await req.json()) as Partial<Bet>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Imported rows belong to the sync; a hand-made one is always 'manual'.
  const bet = createBet({ ...body, source: "manual", kalshiTicker: null });
  return NextResponse.json({ bet }, { status: 201 });
}
