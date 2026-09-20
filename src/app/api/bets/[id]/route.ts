import { NextRequest, NextResponse } from "next/server";
import { deleteBet, getBet, updateBet } from "@/lib/db";
import { isAuthorized } from "@/lib/auth";
import type { Bet } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = getBet(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Partial<Bet>;
  try {
    body = (await req.json()) as Partial<Bet>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // A Kalshi row's economics are re-derived on every sync, so editing them here
  // would silently revert. The note is the field a person owns on those rows.
  const patch: Partial<Bet> =
    existing.source === "kalshi" ? { note: body.note ?? existing.note } : body;

  // A hand-set result is a deliberate override: record who decided it.
  if (patch.status && patch.status !== existing.status && existing.source !== "kalshi") {
    patch.gradedBy = "manual";
    patch.settledAt = patch.status === "open" ? null : (patch.settledAt ?? new Date().toISOString());
    if (patch.status === "open") patch.payoutCents = null;
  }

  const bet = updateBet(id, patch);
  return NextResponse.json({ bet });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ deleted: deleteBet(id) });
}
