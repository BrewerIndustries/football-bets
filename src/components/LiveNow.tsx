"use client";

import { Card, TeamChip } from "./ui";
import { fmtMoney } from "@/lib/money";
import { provisionalResult } from "@/lib/grade";
import type { Bet, Game } from "@/lib/types";
import type { Valuation } from "@/lib/valuation";

/**
 * In-progress games and where your open money stands "if it ended right now".
 * Nothing here is settled — it's a projection off the live scoreboard, and it
 * disappears the moment no game is in progress.
 */
export default function LiveNow({
  games,
  bets,
  valuations,
}: {
  games: Game[];
  bets: Bet[];
  valuations: Record<string, Valuation>;
}) {
  const live = games
    .filter((g) => g.state === "in")
    .sort((a, b) => a.date.localeCompare(b.date));
  if (live.length === 0) return null;

  const liveIds = new Set(live.map((g) => g.id));
  const liveBets = bets.filter((b) => b.status === "open" && b.gameId && liveIds.has(b.gameId));

  const gameById = new Map(live.map((g) => [g.id, g]));
  let winning = 0;
  let losing = 0;
  let projected = 0;

  for (const b of liveBets) {
    const g = gameById.get(b.gameId!);
    if (!g) continue;
    const r = provisionalResult(b, g);
    if (r === "winning") {
      winning++;
      // If it held: the win pays out, so the swing is the profit.
      const payout = b.kind === "contract" ? Math.round((b.contracts ?? 0) * 100) : b.stakeCents;
      projected += payout - b.stakeCents - b.feesCents;
    } else if (r === "losing") {
      losing++;
      projected -= b.stakeCents + b.feesCents;
    }
  }

  return (
    <Card
      title="Live now"
      subtitle="Projected from the current score — nothing is settled until the game is final."
      className="mb-4"
      right={
        <span
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide"
          style={{ background: "color-mix(in srgb, var(--neg) 16%, transparent)", color: "var(--neg)" }}
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--neg)" }}
          />
          Live
        </span>
      }
    >
      {liveBets.length > 0 && (
        <p className="mb-3 text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="tnum">{winning}</strong> of{" "}
          <strong className="tnum">{liveBets.length}</strong> open bet
          {liveBets.length === 1 ? "" : "s"} currently winning
          {losing > 0 && <> · {losing} behind</>} · if it all held,{" "}
          <strong
            className="tnum"
            style={{ color: projected >= 0 ? "var(--pos)" : "var(--neg)" }}
          >
            {fmtMoney(projected, { sign: true })}
          </strong>
        </p>
      )}

      <ul className="grid gap-2">
        {live.map((g) => {
          const gb = liveBets.filter((b) => b.gameId === g.id);
          const awayAhead = (g.awayScore ?? 0) > (g.homeScore ?? 0);
          const homeAhead = (g.homeScore ?? 0) > (g.awayScore ?? 0);
          return (
            <li
              key={g.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2"
              style={{ background: "var(--surface-2)", borderColor: "var(--line)" }}
            >
              <div className="flex min-w-[190px] items-center gap-2">
                <TeamChip abbr={g.awayTeam} muted={!awayAhead} />
                <span className="tnum text-sm font-semibold"
                      style={{ color: awayAhead ? "var(--ink)" : "var(--ink-2)" }}>
                  {g.awayScore ?? 0}
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>@</span>
                <TeamChip abbr={g.homeTeam} muted={!homeAhead} />
                <span className="tnum text-sm font-semibold"
                      style={{ color: homeAhead ? "var(--ink)" : "var(--ink-2)" }}>
                  {g.homeScore ?? 0}
                </span>
              </div>

              <span className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                {g.statusDetail || "In progress"}
              </span>

              {gb.map((b) => {
                const r = provisionalResult(b, g);
                const tone =
                  r === "winning" ? "var(--pos)" : r === "losing" ? "var(--neg)" : "var(--muted)";
                return (
                  <span key={b.id} className="text-xs" style={{ color: "var(--ink-2)" }}>
                    {b.team ?? b.selection} {fmtMoney(b.stakeCents)}{" "}
                    <strong style={{ color: tone }}>
                      {r === "winning" ? "ahead" : r === "losing" ? "behind" : "level"}
                    </strong>
                    {valuations[b.id]?.currentValueCents !== null &&
                      valuations[b.id] !== undefined && (
                        <span style={{ color: "var(--muted)" }}>
                          {" · now "}
                          {fmtMoney(valuations[b.id].currentValueCents!)}
                        </span>
                      )}
                  </span>
                );
              })}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
