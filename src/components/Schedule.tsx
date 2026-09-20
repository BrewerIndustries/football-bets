"use client";

import { useMemo, useState } from "react";
import { Button, Card, Empty, TeamChip, inputStyle } from "./ui";
import { fmtMoney } from "@/lib/money";
import type { Bet, Game } from "@/lib/types";
import { profitCents } from "@/lib/types";

/**
 * The week's card. Each game shows its score once final and any bets riding on
 * it, with a one-click path into the bet form pre-linked to that game.
 */
export default function Schedule({
  games,
  bets,
  current,
  onAddForGame,
  locked,
}: {
  games: Game[];
  bets: Bet[];
  current: { season: number; seasonType: number; week: number } | null;
  onAddForGame: (gameId: string) => void;
  locked: boolean;
}) {
  const weeks = useMemo(
    () =>
      [...new Set(games.filter((g) => g.seasonType === 2).map((g) => g.week))].sort((a, b) => a - b),
    [games],
  );
  const [week, setWeek] = useState<number>(current?.week ?? weeks[0] ?? 1);

  const rows = games
    .filter((g) => g.seasonType === 2 && g.week === week)
    .sort((a, b) => a.date.localeCompare(b.date));

  const betsByGame = useMemo(() => {
    const m = new Map<string, Bet[]>();
    for (const b of bets) {
      if (!b.gameId) continue;
      m.set(b.gameId, [...(m.get(b.gameId) ?? []), b]);
    }
    return m;
  }, [bets]);

  if (games.length === 0) {
    return (
      <Card title="No schedule yet">
        <Empty>Run a schedule sync to pull the season from ESPN.</Empty>
      </Card>
    );
  }

  return (
    <Card
      title={`Week ${week}`}
      subtitle="Final scores come from the live NFL feed and drive automatic grading."
      right={
        <select
          className="rounded-lg border px-2 py-1 text-xs"
          style={inputStyle}
          value={week}
          onChange={(e) => setWeek(Number(e.target.value))}
        >
          {weeks.map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      }
    >
      {rows.length === 0 ? (
        <Empty>No games in this week.</Empty>
      ) : (
        <ul className="grid gap-2">
          {rows.map((g) => {
            const gameBets = betsByGame.get(g.id) ?? [];
            const net = gameBets.reduce((a, b) => a + profitCents(b), 0);
            const staked = gameBets.reduce((a, b) => a + b.stakeCents, 0);
            // A game whose bets are all still open has no P/L to show — "+$0.00"
            // there reads as "broke even" rather than "not decided yet".
            const anySettled = gameBets.some((b) => b.status !== "open");
            const final = g.completed && g.homeScore !== null && g.awayScore !== null;
            const awayWon = final && (g.awayScore ?? 0) > (g.homeScore ?? 0);
            const homeWon = final && (g.homeScore ?? 0) > (g.awayScore ?? 0);

            return (
              <li
                key={g.id}
                className="rounded-lg border px-3 py-2"
                style={{ background: "var(--surface-2)", borderColor: "var(--line)" }}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="flex min-w-[190px] items-center gap-2">
                    <TeamChip abbr={g.awayTeam} muted={final && !awayWon} />
                    <span className="tnum text-sm font-semibold"
                          style={{ color: final ? (awayWon ? "var(--ink)" : "var(--muted)") : "var(--muted)" }}>
                      {g.awayScore ?? "–"}
                    </span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>@</span>
                    <TeamChip abbr={g.homeTeam} muted={final && !homeWon} />
                    <span className="tnum text-sm font-semibold"
                          style={{ color: final ? (homeWon ? "var(--ink)" : "var(--muted)") : "var(--muted)" }}>
                      {g.homeScore ?? "–"}
                    </span>
                  </div>

                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {g.statusDetail ||
                      new Date(g.date).toLocaleString(undefined, {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                  </span>

                  {gameBets.length > 0 && (
                    <span className="text-xs tnum" style={{ color: "var(--ink-2)" }}>
                      {gameBets.length} bet{gameBets.length === 1 ? "" : "s"} · {fmtMoney(staked)}{" "}
                      {anySettled ? (
                        <>
                          on{" "}
                          <strong style={{ color: net >= 0 ? "var(--pos)" : "var(--neg)" }}>
                            {fmtMoney(net, { sign: true })}
                          </strong>
                        </>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>at risk</span>
                      )}
                    </span>
                  )}

                  {!locked && (
                    <span className="ml-auto">
                      <Button onClick={() => onAddForGame(g.id)}>Add bet</Button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
