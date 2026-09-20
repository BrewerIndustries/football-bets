"use client";

import { useMemo, useState } from "react";
import { Empty, StatusPill, inputStyle } from "./ui";
import { fmtMoney } from "@/lib/money";
import { describeSelection } from "@/lib/grade";
import { team as teamOf } from "@/lib/teams";
import type { Bet, Game } from "@/lib/types";
import type { Valuation } from "@/lib/valuation";

/**
 * The ledger: one row per bet, read
 *
 *   who is playing -> what the score is -> what it cost -> what it pays -> what it's worth
 *
 * The team actually backed is set large and bold; its opponent stays small and
 * muted, so a column of rows scans as a list of your picks rather than a list
 * of fixtures.
 *
 * Two layouts, one dataset. A five-column table cannot fit a phone, and making
 * it scroll sideways is the wrong answer — on narrow screens each bet becomes a
 * stacked card so the page only ever scrolls vertically. The table appears at
 * `sm` and up, where it fits without scrolling.
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
  const [liveOnly, setLiveOnly] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [result, setResult] = useState("all");
  const [week, setWeek] = useState("all");

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const weeks = useMemo(
    () => [...new Set(bets.map((b) => b.week).filter((w): w is number => w !== null))].sort((a, b) => b - a),
    [bets],
  );

  const isLive = (b: Bet) => Boolean(b.gameId && gameById.get(b.gameId)?.state === "in");
  const liveCount = bets.filter(isLive).length;
  const openCount = bets.filter((b) => b.status === "open").length;

  const rows = useMemo(() => {
    const filtered = bets.filter(
      (b) =>
        (!liveOnly || isLive(b)) &&
        (!openOnly || b.status === "open") &&
        (result === "all" || b.status === result) &&
        (week === "all" || String(b.week) === week),
    );

    /**
     * Newest first: later seasons and weeks above earlier ones, and within a
     * week the later kickoff first. Season-long bets have no week to sort by
     * and outlive every game, so they sink to the bottom as their own group.
     */
    return [...filtered].sort((a, b) => {
      const seasonLong = (x: Bet) => (x.gameId ? 0 : 1);
      if (seasonLong(a) !== seasonLong(b)) return seasonLong(a) - seasonLong(b);

      if (seasonLong(a) === 1) {
        return (b.placedAt ?? "").localeCompare(a.placedAt ?? "");
      }

      if ((a.season ?? 0) !== (b.season ?? 0)) return (b.season ?? 0) - (a.season ?? 0);
      if ((a.week ?? 0) !== (b.week ?? 0)) return (b.week ?? 0) - (a.week ?? 0);
      return (b.eventDate ?? b.placedAt ?? "").localeCompare(a.eventDate ?? a.placedAt ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bets, gameById, liveOnly, openOnly, result, week]);

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
        <Toggle
          label="Live"
          count={liveCount}
          active={liveOnly}
          tone="live"
          disabled={liveCount === 0}
          onClick={() => setLiveOnly((v) => !v)}
        />
        <Toggle
          label="Open"
          count={openCount}
          active={openOnly}
          onClick={() => setOpenOnly((v) => !v)}
        />
        <select className={sel} style={inputStyle} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="all">Any result</option>
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
        <>
          {/* Phones: stacked cards, vertical scrolling only. */}
          <ul className="grid grid-cols-1 gap-2 lg:hidden">
            {rows.map((b) => (
              <MobileCard
                key={b.id}
                bet={b}
                game={b.gameId ? gameById.get(b.gameId) ?? null : null}
                v={valuations[b.id]}
              />
            ))}
            <li
              className="min-w-0 rounded-lg border px-3 py-2.5"
              style={{ background: "var(--surface-2)", borderColor: "var(--line-strong)" }}
            >
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Total
              </div>
              <Figures bet={totals.bet} win={totals.win} value={totals.value} unrealized={null} />
            </li>
          </ul>

          {/* Tablet and up: the column view. */}
          <table className="hidden w-full border-collapse lg:table">
            <thead>
              <tr className="text-xs" style={{ color: "var(--muted)" }}>
                <th className="px-2 py-2 text-left font-medium">Pick</th>
                <th className="px-2 py-2 text-left font-medium">Score</th>
                <th className="px-2 py-2 text-right font-medium">Bet</th>
                <th className="px-2 py-2 text-right font-medium">To win</th>
                <th className="px-2 py-2 text-right font-medium">Current value</th>
                <th className="px-2 py-2 text-left font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <DesktopRow
                  key={b.id}
                  bet={b}
                  game={b.gameId ? gameById.get(b.gameId) ?? null : null}
                  v={valuations[b.id]}
                />
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line-strong)" }}>
                <td className="px-2 py-2 text-xs font-medium" style={{ color: "var(--muted)" }}>Total</td>
                <td />
                <td className="px-2 py-2 text-right text-sm font-semibold tnum">{fmtMoney(totals.bet)}</td>
                <td className="px-2 py-2 text-right text-sm tnum" style={{ color: "var(--ink-2)" }}>
                  {fmtMoney(totals.win, { sign: true })}
                </td>
                <td className="px-2 py-2 text-right text-sm font-semibold tnum">{fmtMoney(totals.value)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}

/**
 * A filter toggle that carries its own count, so an empty result is visible
 * before you press it rather than after. "Live" disables itself when nothing
 * is in progress instead of offering a filter that can only return nothing.
 */
function Toggle({
  label,
  count,
  active,
  onClick,
  tone,
  disabled,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "live";
  disabled?: boolean;
}) {
  const accent = tone === "live" ? "var(--neg)" : "var(--accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        background: active ? `color-mix(in srgb, ${accent} 18%, transparent)` : "var(--surface-2)",
        borderColor: active ? accent : "var(--line-strong)",
        color: active ? accent : "var(--ink-2)",
      }}
    >
      {tone === "live" && (
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
      )}
      {label}
      <span className="tnum font-normal" style={{ color: "var(--muted)" }}>
        {count}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ mobile */

function MobileCard({ bet, game, v }: { bet: Bet; game: Game | null; v?: Valuation }) {
  return (
    <li
      className="min-w-0 rounded-lg border px-3 py-2.5"
      style={{ background: "var(--surface-2)", borderColor: "var(--line)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {game ? <Matchup bet={bet} game={game} /> : <FuturesSubject bet={bet} />}
        </div>
        <StatusPill status={bet.status} />
      </div>

      <div className="mt-1">
        {game ? <ScoreLine game={game} inline /> : <NonGameLine bet={bet} inline />}
      </div>

      <Figures
        bet={v?.amountBetCents ?? bet.stakeCents}
        win={v?.toWinCents ?? null}
        value={v?.currentValueCents ?? null}
        unrealized={v?.unrealizedCents ?? null}
        open={bet.status === "open"}
      />
    </li>
  );
}

/** The three figures as a row of labelled columns — fits a 375px screen. */
function Figures({
  bet,
  win,
  value,
  unrealized,
  open,
}: {
  bet: number;
  win: number | null;
  value: number | null;
  unrealized: number | null;
  open?: boolean;
}) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
      <Figure label="Bet" value={fmtMoney(bet)} />
      <Figure
        label="To win"
        value={win === null ? "—" : fmtMoney(win, { sign: true })}
        muted
      />
      <Figure
        label="Value"
        value={value === null ? "—" : fmtMoney(value)}
        sub={
          unrealized === null
            ? undefined
            : `${fmtMoney(unrealized, { sign: true })}${open ? "" : ""}`
        }
        subTone={unrealized === null ? undefined : unrealized >= 0 ? "pos" : "neg"}
      />
    </div>
  );
}

function Figure({
  label,
  value,
  sub,
  subTone,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "pos" | "neg";
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div
        className="truncate text-sm font-semibold tnum"
        style={{ color: muted ? "var(--ink-2)" : "var(--ink)" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="truncate text-[11px] tnum"
          style={{ color: subTone === "pos" ? "var(--pos)" : subTone === "neg" ? "var(--neg)" : "var(--muted)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- desktop */

function DesktopRow({ bet, game, v }: { bet: Bet; game: Game | null; v?: Valuation }) {
  const open = bet.status === "open";
  const unrealized = v?.unrealizedCents ?? null;

  return (
    <tr style={{ borderTop: "1px solid var(--line)" }}>
      <td className="px-2 py-2.5">
        {game ? <Matchup bet={bet} game={game} /> : <FuturesSubject bet={bet} />}
      </td>
      <td className="px-2 py-2.5">
        {game ? <ScoreLine game={game} /> : <NonGameLine bet={bet} />}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tnum">
        {fmtMoney(v?.amountBetCents ?? bet.stakeCents)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tnum" style={{ color: "var(--ink-2)" }}>
        {v ? fmtMoney(v.toWinCents, { sign: true }) : "—"}
      </td>
      <td className="px-2 py-2.5 text-right">
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
      <td className="px-2 py-2.5">
        <StatusPill status={bet.status} />
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ shared */

function Matchup({ bet, game }: { bet: Bet; game: Game }) {
  const backed = bet.team;
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <TeamName abbr={game.awayTeam} backed={backed === game.awayTeam} />
      <span className="text-xs" style={{ color: "var(--muted)" }}>@</span>
      <TeamName abbr={game.homeTeam} backed={backed === game.homeTeam} />
      {bet.side === "no" && (
        <span
          className="ml-0.5 rounded px-1 py-0.5 text-[10px] font-bold"
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
    <span className="inline-flex items-center gap-1">
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

function FuturesSubject({ bet }: { bet: Bet }) {
  const t = teamOf(bet.team);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ background: t?.color ?? "var(--muted)", outline: "1px solid var(--line-strong)" }}
      />
      <span className="shrink-0 text-lg font-bold tracking-tight" style={{ color: "var(--ink)" }}>
        {bet.team ?? "—"}
      </span>
      <span
        className="min-w-0 max-w-[14rem] truncate text-xs"
        style={{ color: "var(--muted)" }}
        title={describeSelection(bet)}
      >
        {describeSelection(bet)}
      </span>
    </div>
  );
}

/**
 * Score and state. Stacked in the table's own column; on a card the same
 * information reads better on one line, so `inline` lays it out horizontally.
 */
function ScoreLine({ game, inline }: { game: Game; inline?: boolean }) {
  const live = game.state === "in";
  const final = game.completed;
  const hasScore = game.awayScore !== null && game.homeScore !== null;

  const score = hasScore ? (
    <span className="text-sm font-semibold tnum" style={{ color: "var(--ink)" }}>
      {game.awayScore} <span style={{ color: "var(--muted)" }}>–</span> {game.homeScore}
    </span>
  ) : (
    <span className="text-sm" style={{ color: "var(--muted)" }}>—</span>
  );

  const state = (
    <span
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
    </span>
  );

  return inline ? (
    <div className="flex items-baseline gap-2">
      {score}
      {state}
    </div>
  ) : (
    <div className="whitespace-nowrap">
      <div>{score}</div>
      <div>{state}</div>
    </div>
  );
}

function NonGameLine({ bet, inline }: { bet: Bet; inline?: boolean }) {
  const text = bet.settledAt
    ? `Settled ${new Date(bet.settledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "Futures · open";
  return inline ? (
    <span className="text-[11px]" style={{ color: "var(--muted)" }}>{text}</span>
  ) : (
    <div className="whitespace-nowrap">
      <div className="text-sm" style={{ color: "var(--muted)" }}>—</div>
      <div className="text-[11px]" style={{ color: "var(--muted)" }}>{text}</div>
    </div>
  );
}
