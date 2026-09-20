import { NextRequest, NextResponse } from "next/server";
import { syncKalshi } from "@/lib/sync";
import { KalshiNotConfigured } from "@/lib/kalshi";
import { isAuthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncKalshi();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const status = e instanceof KalshiNotConfigured ? 503 : 502;
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status });
  }
}
