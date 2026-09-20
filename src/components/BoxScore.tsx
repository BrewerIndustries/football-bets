"use client";

import { team as teamOf } from "@/lib/teams";
import type { Game } from "@/lib/types";

/**
 * A box score: away over home, team on the left and score hard right inside a
 * fixed-width block, so scores form a clean column down the page instead of
 * drifting with the length of each team's name.
 *
 * The backed team carries the weight (larger, bold, full ink); the opponent
 * stays small and muted. Row height is fixed so the two type sizes still sit on
 * a shared grid and the scores line up across every row.
 */
export function BoxScore({
  game,
  backedTeams = [],
  noSide = false,
}: {
  game: Game;
  /** Teams the viewer has money on — set in bold. */
  backedTeams?: (string | null)[];
  /** Marks a NO position, where the backed team is the opponent. */
  noSide?: boolean;
}) {
  const backed = (abbr: string) => backedTeams.includes(abbr);
  const hasScore = game.awayScore !== null && game.homeScore !== null;
  const away = game.awayScore ?? 0;
  const home = game.homeScore ?? 0;

  return (
    <div className="w-[7.25rem] shrink-0 sm:w-[8.5rem]">
      <ScoreRow
        abbr={game.awayTeam}
        score={hasScore ? away : null}
        backed={backed(game.awayTeam)}
        leading={hasScore && away > home}
      />
      <ScoreRow
        abbr={game.homeTeam}
        score={hasScore ? home : null}
        backed={backed(game.homeTeam)}
        leading={hasScore && home > away}
      />
      {noSide && (
        <span
          className="mt-0.5 inline-block rounded px-1 py-0.5 text-[10px] font-bold"
          style={{ background: "color-mix(in srgb, var(--ink) 10%, transparent)", color: "var(--ink-2)" }}
          title="A NO position — this backs the other side"
        >
          NO
        </span>
      )}
    </div>
  );
}

function ScoreRow({
  abbr,
  score,
  backed,
  leading,
}: {
  abbr: string;
  score: number | null;
  backed: boolean;
  leading: boolean;
}) {
  const t = teamOf(abbr);
  return (
    <div className="flex h-6 items-center justify-between gap-2">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className={`inline-block shrink-0 rounded-full ${backed ? "h-2.5 w-2.5" : "h-2 w-2"}`}
          style={{ background: t?.color ?? "var(--muted)", outline: "1px solid var(--line-strong)" }}
        />
        <span
          className={backed ? "text-base font-bold leading-none tracking-tight" : "text-sm leading-none"}
          style={{ color: backed ? "var(--ink)" : "var(--muted)" }}
          title={t ? `${t.location} ${t.name}` : abbr}
        >
          {abbr}
        </span>
      </span>
      <span
        className="tnum text-base leading-none"
        style={{
          color: score === null ? "var(--line-strong)" : leading ? "var(--ink)" : "var(--ink-2)",
          fontWeight: leading ? 700 : 400,
        }}
      >
        {score === null ? "–" : score}
      </span>
    </div>
  );
}

/**
 * Game state beside the box score. A live detail like "14:14 - 2nd Quarter" is
 * split so the period sits on the first line and the clock on the second,
 * lining up with the two rows of the box score next to it.
 */
export function GameState({ game }: { game: Game }) {
  const live = game.state === "in";
  const final = game.completed;

  if (!live && !final) {
    return (
      <div className="text-xs" style={{ color: "var(--muted)" }}>
        {new Date(game.date).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}
      </div>
    );
  }

  const detail = game.statusDetail || (final ? "Final" : "In progress");
  // ESPN formats in-progress detail as "<clock> - <period>".
  const split = /^(.+?)\s+-\s+(.+)$/.exec(detail);
  const clock = split?.[1] ?? null;
  const period = split?.[2] ?? detail;

  return (
    <div className="whitespace-nowrap">
      <div
        className="flex h-6 items-center text-xs font-semibold"
        style={{ color: live ? "var(--neg)" : "var(--ink-2)" }}
      >
        {period}
      </div>
      {clock && (
        <div className="flex h-6 items-center tnum text-xs" style={{ color: "var(--muted)" }}>
          {clock}
        </div>
      )}
    </div>
  );
}

