"use client";

import { fmtMoney } from "@/lib/money";
import { provisionalResult } from "@/lib/grade";
import type { Bet, Game } from "@/lib/types";

/**
 * A single live banner. The ledger below already carries every box score, so
 * this deliberately does not repeat them — it answers only "how am I doing
 * right now", projected from the current scores. Nothing here is settled.
 */
export default function LiveNow({ games, bets }: { games: Game[]; bets: Bet[] }) {
  const live = games.filter((g) => g.state === "in");
  if (live.length === 0) return null;

  const gameById = new Map(live.map((g) => [g.id, g]));
  const liveBets = bets.filter((b) => b.status === "open" && b.gameId && gameById.has(b.gameId));

  let winning = 0;
  let losing = 0;
  let projected = 0;
  for (const b of liveBets) {
    const g = gameById.get(b.gameId!);
    if (!g) continue;
    const r = provisionalResult(b, g);
    if (r === "winning") {
      winning++;
      const payout = b.kind === "contract" ? Math.round((b.contracts ?? 0) * 100) : b.stakeCents;
      projected += payout - b.stakeCents - b.feesCents;
    } else if (r === "losing") {
      losing++;
      projected -= b.stakeCents + b.feesCents;
    }
  }

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3"
      style={{ background: "var(--surface)", borderColor: "var(--line)" }}
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide"
        style={{ background: "color-mix(in srgb, var(--neg) 16%, transparent)", color: "var(--neg)" }}
      >
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--neg)" }} />
        Live
      </span>

      <span className="text-sm" style={{ color: "var(--ink-2)" }}>
        {live.length} game{live.length === 1 ? "" : "s"} in progress
      </span>

      {liveBets.length > 0 && (
        <span className="text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="tnum">{winning}</strong> of{" "}
          <strong className="tnum">{liveBets.length}</strong> bet
          {liveBets.length === 1 ? "" : "s"} ahead
          {losing > 0 && <> · {losing} behind</>} · if it all held,{" "}
          <strong className="tnum" style={{ color: projected >= 0 ? "var(--pos)" : "var(--neg)" }}>
            {fmtMoney(projected, { sign: true })}
          </strong>
        </span>
      )}
    </div>
  );
}
