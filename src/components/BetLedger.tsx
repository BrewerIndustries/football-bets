"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, StatusPill, inputStyle } from "./ui";
import { fmtMoney } from "@/lib/money";
import { describeSelection } from "@/lib/grade";
import { team as teamOf } from "@/lib/teams";
import { BoxScore, GameState } from "./BoxScore";
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
const FILTER_KEY = "football-bets:filters:v1";
const RESULTS = ["all", "won", "lost", "push"] as const;

type Filters = {
  liveOnly: boolean;
  openOnly: boolean;
  result: string;
  week: string;
};

const DEFAULT_FILTERS: Filters = { liveOnly: false, openOnly: false, result: "all", week: "all" };

const isDefault = (f: Filters) =>
  !f.liveOnly && !f.openOnly && f.result === "all" && f.week === "all";

/**
 * Filters survive a reload, which is the point — but a stored filter can go
 * stale (a week that no longer has bets, "live" on a Tuesday) and silently
 * show an empty ledger that looks broken. Everything read back is validated
 * against the current data before it is trusted.
 */
function readStoredFilters(): Filters | null {
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Filters>;
    return {
      liveOnly: p.liveOnly === true,
      openOnly: p.openOnly === true,
      result: RESULTS.includes(p.result as (typeof RESULTS)[number]) ? (p.result as string) : "all",
      week: typeof p.week === "string" ? p.week : "all",
    };
  } catch {
    // Private windows and blocked site data both throw here; defaults are fine.
    return null;
  }
}

export default function BetLedger({
  bets,
  games,
  valuations,
}: {
  bets: Bet[];
  games: Game[];
  valuations: Record<string, Valuation>;
}) {
  // Start from the defaults so the server and the first client render agree,
  // then adopt anything stored once mounted.
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [restored, setRestored] = useState(false);
  const { liveOnly, openOnly, result, week } = filters;
  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const weeks = useMemo(
    () => [...new Set(bets.map((b) => b.week).filter((w): w is number => w !== null))].sort((a, b) => b - a),
    [bets],
  );

  const isLive = (b: Bet) => Boolean(b.gameId && gameById.get(b.gameId)?.state === "in");
  const liveCount = bets.filter(isLive).length;
  const openCount = bets.filter((b) => b.status === "open").length;

  useEffect(() => {
    const stored = readStoredFilters();
    if (stored) setFilters(stored);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      // Not being able to remember a filter is not worth surfacing.
    }
  }, [filters, restored]);

  // Drop a filter that can only return nothing: a week with no bets, or "live"
  // once every game has finished. Without this a restored filter would show an
  // empty ledger behind a disabled toggle you could not switch off.
  useEffect(() => {
    if (!restored) return;
    setFilters((f) => {
      const next = { ...f };
      if (f.week !== "all" && !weeks.includes(Number(f.week))) next.week = "all";
      if (f.liveOnly && liveCount === 0) next.liveOnly = false;
      return next.week === f.week && next.liveOnly === f.liveOnly ? f : next;
    });
  }, [restored, weeks, liveCount]);

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
          onClick={() => patch({ liveOnly: !liveOnly })}
        />
        <Toggle
          label="Open"
          count={openCount}
          active={openOnly}
          onClick={() => patch({ openOnly: !openOnly })}
        />
        <select className={sel} style={inputStyle} value={result} onChange={(e) => patch({ result: e.target.value })}>
          <option value="all">Any result</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="push">Push</option>
        </select>
        <select className={sel} style={inputStyle} value={week} onChange={(e) => patch({ week: e.target.value })}>
          <option value="all">Any week</option>
          {weeks.map((w) => (
            <option key={w} value={String(w)}>Week {w}</option>
          ))}
        </select>
        {!isDefault(filters) && (
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="rounded-lg px-2 py-1 text-xs font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--muted)" }}
          >
            Clear
          </button>
        )}
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
                <th className="px-2 py-2 text-left font-medium">Game</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
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
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {game ? (
          <>
            <BoxScore game={game} backedTeams={[bet.team]} noSide={bet.side === "no"} />
            <div className="min-w-0 flex-1 text-right">
              <GameState game={game} />
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <FuturesSubject bet={bet} />
            <NonGameLine bet={bet} inline />
          </div>
        )}
        <StatusPill status={bet.status} />
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
        sub={unrealized === null ? undefined : fmtMoney(unrealized, { sign: true })}
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
      <td className="px-2 py-2.5 align-top">
        {game ? <BoxScore game={game} backedTeams={[bet.team]} noSide={bet.side === "no"} /> : <FuturesSubject bet={bet} />}
      </td>
      <td className="px-2 py-2.5 align-top">
        {game ? <GameState game={game} /> : <NonGameLine bet={bet} />}
      </td>
      <td className="px-2 py-2.5 text-right align-top text-sm tnum">
        {fmtMoney(v?.amountBetCents ?? bet.stakeCents)}
      </td>
      <td className="px-2 py-2.5 text-right align-top text-sm tnum" style={{ color: "var(--ink-2)" }}>
        {v ? fmtMoney(v.toWinCents, { sign: true }) : "—"}
      </td>
      <td className="px-2 py-2.5 text-right align-top">
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
      <td className="px-2 py-2.5 align-top">
        <StatusPill status={bet.status} />
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ shared */

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

function NonGameLine({ bet, inline }: { bet: Bet; inline?: boolean }) {
  const text = bet.settledAt
    ? `Settled ${new Date(bet.settledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "Season long · open";
  return inline ? (
    <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>{text}</div>
  ) : (
    <div className="whitespace-nowrap text-xs" style={{ color: "var(--muted)" }}>{text}</div>
  );
}
