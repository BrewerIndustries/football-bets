"use client";

import { useMemo, useState } from "react";
import { Empty, StatusPill, inputStyle } from "./ui";
import { fmtMoney } from "@/lib/money";
import { describeSelection } from "@/lib/grade";
import { team as teamOf } from "@/lib/teams";
import type { Bet, Game } from "@/lib/types";
import type { Valuation } from "@/lib/valuation";

/**
 * The ledger: one row per bet, read left to right as
 *
 *   who is playing -> what the score is -> what it cost -> what it pays -> what it's worth
 *
 * The team actually backed is set large and bold; its opponent stays small and
 * muted, so a column of rows scans as a list of your picks rather than a list
 * of fixtures. Non-game bets (futures) keep the same columns, with the market's
 * subject in the team slot and its horizon where the box score would be.
 */
export default function BetLedger({
  bets,
  games,
  valuations,
}: {
  bets: Bet[];
  games: Game[];
  valuations: Record<string, Valuation>;
}) {
  const [status, setStatus] = useState("all");
  const [week, setWeek] = useState("all");

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const weeks = useMemo(
    () => [...new Set(bets.map((b) => b.week).filter((w): w is number => w !== null))].sort((a, b) => a - b),
    [bets],
  );

  const rows = bets.filter(
    (b) =>
      (status === "all" || b.status === status) &&
      (week === "all" || String(b.week) === week),
  );

  const totals = rows.reduce(
    (a, b) => {
      const v = valuations[b.id];
      return {
        bet: a.bet + (v?.amountBetCents ?? b.stakeCents),
        win: a.win + (v?.toWinCents ?? 0),
        value: a.value + (v?.currentValueCents ?? 0),
      };
    },
    { bet: 0, win: 0, value: 0 },
  );

  const sel = "rounded-lg border px-2 py-1 text-xs";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={sel} style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All bets</option>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="push">Push</option>
        </select>
        <select className={sel} style={inputStyle} value={week} onChange={(e) => setWeek(e.target.value)}>
          <option value="all">Any week</option>
          {weeks.map((w) => (
            <option key={w} value={String(w)}>Week {w}</option>
          ))}
        </select>
        <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
          {rows.length} bet{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty>No bets match these filters.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-xs" style={{ color: "var(--muted)" }}>
                <th className="px-3 py-2 text-left font-medium">Pick</th>
                <th className="px-3 py-2 text-left font-medium">Score</th>
                <th className="px-3 py-2 text-right font-medium">Bet</th>
                <th className="px-3 py-2 text-right font-medium">To win</th>
                <th className="px-3 py-2 text-right font-medium">Current value</th>
                <th className="px-3 py-2 text-left font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <Row
                  key={b.id}
                  bet={b}
                  game={b.gameId ? gameById.get(b.gameId) ?? null : null}
                  v={valuations[b.id]}
                />
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line-strong)" }}>
                <td className="px-3 py-2 text-xs font-medium" style={{ color: "var(--muted)" }}>
                  Total
                </td>
                <td />
                <td className="px-3 py-2 text-right text-sm font-semibold tnum">{fmtMoney(totals.bet)}</td>
                <td className="px-3 py-2 text-right text-sm tnum" style={{ color: "var(--ink-2)" }}>
                  {fmtMoney(totals.win, { sign: true })}
                </td>
                <td className="px-3 py-2 text-right text-sm font-semibold tnum">{fmtMoney(totals.value)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ bet, game, v }: { bet: Bet; game: Game | null; v?: Valuation }) {
  const open = bet.status === "open";
  const unrealized = v?.unrealizedCents ?? null;

  return (
    <tr style={{ borderTop: "1px solid var(--line)" }}>
      <td className="px-3 py-2.5">
        {game ? <Matchup bet={bet} game={game} /> : <FuturesSubject bet={bet} />}
      </td>

      <td className="px-3 py-2.5">
        {game ? <BoxScore game={game} /> : <NonGameStatus bet={bet} />}
      </td>

      <td className="px-3 py-2.5 text-right text-sm tnum">
        {fmtMoney(v?.amountBetCents ?? bet.stakeCents)}
      </td>

      <td className="px-3 py-2.5 text-right text-sm tnum" style={{ color: "var(--ink-2)" }}>
        {v ? fmtMoney(v.toWinCents, { sign: true }) : "—"}
      </td>

      <td className="px-3 py-2.5 text-right">
        {v?.currentValueCents === null || v === undefined ? (
          <span className="text-sm" style={{ color: "var(--muted)" }}>—</span>
        ) : (
          <>
            <div className="text-sm font-semibold tnum">{fmtMoney(v.currentValueCents)}</div>
            {unrealized !== null && (
              <div
                className="text-[11px] tnum"
                style={{ color: unrealized >= 0 ? "var(--pos)" : "var(--neg)" }}
              >
                {fmtMoney(unrealized, { sign: true })}
                {open ? " unrealized" : ""}
              </div>
            )}
          </>
        )}
      </td>

      <td className="px-3 py-2.5">
        <StatusPill status={bet.status} />
      </td>
    </tr>
  );
}

/** Away @ home, with the backed side carrying the visual weight. */
function Matchup({ bet, game }: { bet: Bet; game: Game }) {
  const backed = bet.team;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <TeamName abbr={game.awayTeam} backed={backed === game.awayTeam} />
      <span className="text-xs" style={{ color: "var(--muted)" }}>@</span>
      <TeamName abbr={game.homeTeam} backed={backed === game.homeTeam} />
      {bet.side === "no" && (
        <span
          className="ml-1 rounded px-1 py-0.5 text-[10px] font-bold"
          style={{ background: "color-mix(in srgb, var(--ink) 10%, transparent)", color: "var(--ink-2)" }}
          title="A NO position — this backs the other side"
        >
          NO
        </span>
      )}
    </div>
  );
}

function TeamName({ abbr, backed }: { abbr: string; backed: boolean }) {
  const t = teamOf(abbr);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={`inline-block shrink-0 rounded-full ${backed ? "h-3 w-3" : "h-2 w-2"}`}
        style={{ background: t?.color ?? "var(--muted)", outline: "1px solid var(--line-strong)" }}
      />
      <span
        className={backed ? "text-lg font-bold tracking-tight" : "text-sm"}
        style={{ color: backed ? "var(--ink)" : "var(--muted)" }}
        title={t ? `${t.location} ${t.name}` : abbr}
      >
        {abbr}
      </span>
    </span>
  );
}

/** Futures and anything else with no fixture behind it. */
function FuturesSubject({ bet }: { bet: Bet }) {
  const t = teamOf(bet.team);
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span
        aria-hidden
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ background: t?.color ?? "var(--muted)", outline: "1px solid var(--line-strong)" }}
      />
      <span className="text-lg font-bold tracking-tight" style={{ color: "var(--ink)" }}>
        {bet.team ?? "—"}
      </span>
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        {describeSelection(bet)}
      </span>
    </div>
  );
}

function BoxScore({ game }: { game: Game }) {
  const live = game.state === "in";
  const final = game.completed;
  const hasScore = game.awayScore !== null && game.homeScore !== null;

  return (
    <div className="whitespace-nowrap">
      {hasScore ? (
        <div className="text-sm font-semibold tnum" style={{ color: "var(--ink)" }}>
          {game.awayScore} <span style={{ color: "var(--muted)" }}>–</span> {game.homeScore}
        </div>
      ) : (
        <div className="text-sm" style={{ color: "var(--muted)" }}>—</div>
      )}
      <div
        className="text-[11px]"
        style={{ color: live ? "var(--neg)" : "var(--muted)", fontWeight: live ? 600 : 400 }}
      >
        {live || final
          ? game.statusDetail || (final ? "Final" : "In progress")
          : new Date(game.date).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
      </div>
    </div>
  );
}

function NonGameStatus({ bet }: { bet: Bet }) {
  return (
    <div className="whitespace-nowrap">
      <div className="text-sm" style={{ color: "var(--muted)" }}>—</div>
      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
        {bet.settledAt
          ? `Settled ${new Date(bet.settledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
          : "Futures · open"}
      </div>
    </div>
  );
}
