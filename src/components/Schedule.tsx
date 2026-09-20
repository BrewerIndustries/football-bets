"use client";

import { useMemo, useState } from "react";
import { Card, Empty, inputStyle } from "./ui";
import { BoxScore, GameState } from "./BoxScore";
import { fmtMoney } from "@/lib/money";
import { team as teamOf } from "@/lib/teams";
import type { Bet, Game } from "@/lib/types";
import { profitCents } from "@/lib/types";
import type { Valuation } from "@/lib/valuation";

/**
 * The week as a personal scoreboard: every game, with the team you backed set
 * bold in the box score and what the bet is worth to you beside it. Games you
 * had no money on stay deliberately quiet, so the week reads as "where am I"
 * rather than "what's on".
 */
export default function Schedule({
  games,
  bets,
  valuations,
  current,
}: {
  games: Game[];
  bets: Bet[];
  valuations: Record<string, Valuation>;
  current: { season: number; seasonType: number; week: number } | null;
}) {
  const weeks = useMemo(
    () => [...new Set(games.filter((g) => g.seasonType === 2).map((g) => g.week))].sort((a, b) => b - a),
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

  // Week total across the games shown, so the header answers the obvious
  // question without making you add the rows up.
  const weekTotals = rows.reduce(
    (a, g) => {
      for (const b of betsByGame.get(g.id) ?? []) {
        const { amount, settled } = entryResult(b, valuations[b.id]);
        a.staked += b.stakeCents;
        if (amount !== null) {
          a.net += amount;
          if (settled) a.settled += amount;
          else a.unrealized += amount;
        }
        a.count++;
      }
      return a;
    },
    { staked: 0, net: 0, settled: 0, unrealized: 0, count: 0 },
  );

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
      subtitle={
        weekTotals.count > 0
          ? `${weekTotals.count} bet${weekTotals.count === 1 ? "" : "s"} · ${fmtMoney(
              weekTotals.staked,
            )} staked`
          : "No bets this week."
      }
      right={
        <div className="flex items-center gap-3">
          {weekTotals.count > 0 && (
            <span className="text-sm font-semibold tnum"
                  style={{ color: weekTotals.net >= 0 ? "var(--pos)" : "var(--neg)" }}>
              {fmtMoney(weekTotals.net, { sign: true })}
            </span>
          )}
          <select
            className="rounded-lg border px-2 py-1 text-xs"
            style={inputStyle}
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            {weeks.map((w) => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty>No games in this week.</Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {rows.map((g) => {
            const gameBets = betsByGame.get(g.id) ?? [];
            const backedTeams = gameBets.map((b) => b.team);
            const hasBet = gameBets.length > 0;

            return (
              <li
                key={g.id}
                className="rounded-lg border px-3 py-2.5"
                style={{
                  background: hasBet ? "var(--surface-2)" : "transparent",
                  borderColor: hasBet ? "var(--line-strong)" : "var(--line)",
                }}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <BoxScore game={g} backedTeams={backedTeams} />
                  <div className="min-w-[5.5rem]">
                    <GameState game={g} />
                  </div>

                  {hasBet ? (
                    <div className="ml-auto flex flex-wrap items-start gap-x-4 gap-y-1">
                      {gameBets.map((b) => (
                        <Entry key={b.id} bet={b} v={valuations[b.id]} />
                      ))}
                    </div>
                  ) : (
                    <span className="ml-auto self-center text-xs" style={{ color: "var(--muted)" }}>
                      No bet
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

/** One bet on this game: who was picked, what it cost, what it made or lost. */
function Entry({ bet, v }: { bet: Bet; v?: Valuation }) {
  const t = teamOf(bet.team);
  const { amount, settled } = entryResult(bet, v);

  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Picked
        </span>
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: t?.color ?? "var(--muted)", outline: "1px solid var(--line-strong)" }}
        />
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>
          {bet.team ?? "—"}
        </span>
        {bet.side === "no" && (
          <span className="text-[10px] font-bold" style={{ color: "var(--ink-2)" }}>NO</span>
        )}
      </div>

      <div className="mt-0.5 flex items-baseline justify-end gap-2">
        <span className="text-xs tnum" style={{ color: "var(--muted)" }}>
          {fmtMoney(bet.stakeCents)}
        </span>
        {amount === null ? (
          <span className="text-sm" style={{ color: "var(--muted)" }}>—</span>
        ) : (
          <span
            className="text-base font-bold tnum"
            style={{ color: amount >= 0 ? "var(--pos)" : "var(--neg)" }}
          >
            {fmtMoney(amount, { sign: true })}
          </span>
        )}
      </div>

      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {amount === null
          ? "not priced"
          : settled
            ? "final"
            : v?.pendingSettlement
              ? "pending settlement"
              : "unrealized"}
      </div>
    </div>
  );
}

/**
 * What this bet is worth to you: the realised profit once it has settled, and
 * the mark-to-market swing while it is still live. Null when neither is
 * knowable (an open position in a market that is not trading).
 */
function entryResult(bet: Bet, v?: Valuation): { amount: number | null; settled: boolean } {
  if (bet.status !== "open") return { amount: profitCents(bet), settled: true };
  return { amount: v?.unrealizedCents ?? null, settled: false };
}
