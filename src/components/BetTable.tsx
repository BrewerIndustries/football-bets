"use client";

import { useMemo, useState } from "react";
import { Button, Empty, StatusPill, TeamChip, inputCls, inputStyle } from "./ui";
import { fmtAmerican, fmtMoney, fmtPrice } from "@/lib/money";
import { describeSelection } from "@/lib/grade";
import type { Bet, BetStatus } from "@/lib/types";
import { profitCents } from "@/lib/types";

type Filters = {
  status: string;
  source: string;
  week: string;
  team: string;
};

export default function BetTable({
  bets,
  onEdit,
  onDelete,
  onGrade,
  locked,
}: {
  bets: Bet[];
  onEdit: (b: Bet) => void;
  onDelete: (b: Bet) => void;
  onGrade: (b: Bet, status: BetStatus) => void;
  locked: boolean;
}) {
  const [f, setF] = useState<Filters>({ status: "all", source: "all", week: "all", team: "all" });

  const weeks = useMemo(
    () => [...new Set(bets.map((b) => b.week).filter((w): w is number => w !== null))].sort((a, b) => a - b),
    [bets],
  );
  const teams = useMemo(
    () => [...new Set(bets.map((b) => b.team).filter((t): t is string => Boolean(t)))].sort(),
    [bets],
  );

  const rows = bets.filter(
    (b) =>
      (f.status === "all" || b.status === f.status) &&
      (f.source === "all" || b.source === f.source) &&
      (f.week === "all" || String(b.week) === f.week) &&
      (f.team === "all" || b.team === f.team),
  );

  const shown = rows.reduce(
    (a, b) => ({
      stake: a.stake + b.stakeCents,
      net: a.net + profitCents(b),
    }),
    { stake: 0, net: 0 },
  );

  const sel = "rounded-lg border px-2 py-1 text-xs";

  return (
    <div>
      {/* Filters sit in one row above the table. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={sel} style={inputStyle} value={f.status}
                onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="all">All results</option>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="push">Push</option>
          <option value="void">Void</option>
        </select>
        <select className={sel} style={inputStyle} value={f.source}
                onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="all">Any source</option>
          <option value="kalshi">Kalshi</option>
          <option value="manual">Manual</option>
        </select>
        <select className={sel} style={inputStyle} value={f.week}
                onChange={(e) => setF({ ...f, week: e.target.value })}>
          <option value="all">Any week</option>
          {weeks.map((w) => (
            <option key={w} value={String(w)}>Week {w}</option>
          ))}
        </select>
        <select className={sel} style={inputStyle} value={f.team}
                onChange={(e) => setF({ ...f, team: e.target.value })}>
          <option value="all">Any team</option>
          {teams.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="ml-auto text-xs tnum" style={{ color: "var(--muted)" }}>
          {rows.length} bet{rows.length === 1 ? "" : "s"} · {fmtMoney(shown.stake)} wagered ·{" "}
          <strong style={{ color: shown.net >= 0 ? "var(--pos)" : "var(--neg)" }}>
            {fmtMoney(shown.net, { sign: true })}
          </strong>
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty>No bets match these filters.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ color: "var(--muted)" }} className="text-left text-xs">
                <th className="px-2 py-2 font-medium">Game</th>
                <th className="px-2 py-2 font-medium">Pick</th>
                <th className="px-2 py-2 font-medium">Position</th>
                <th className="px-2 py-2 text-right font-medium">Wager</th>
                <th className="px-2 py-2 text-right font-medium">Return</th>
                <th className="px-2 py-2 text-right font-medium">P/L</th>
                <th className="px-2 py-2 font-medium">Result</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const pl = profitCents(b);
                const isKalshi = b.source === "kalshi";
                return (
                  <tr key={b.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="px-2 py-2 align-top">
                      <div className="flex items-center gap-1.5">
                        {b.awayTeam && b.homeTeam ? (
                          <>
                            <TeamChip abbr={b.awayTeam} muted />
                            <span className="text-xs" style={{ color: "var(--muted)" }}>@</span>
                            <TeamChip abbr={b.homeTeam} muted />
                          </>
                        ) : (
                          <span className="text-xs" style={{ color: "var(--muted)" }}>Futures</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
                        {b.week ? `Week ${b.week} · ` : ""}
                        {b.eventDate
                          ? new Date(b.eventDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                          : new Date(b.placedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </div>
                    </td>

                    <td className="px-2 py-2 align-top">
                      <div className="flex items-center gap-2">
                        {b.team && <TeamChip abbr={b.team} />}
                        <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                          {describeSelection(b)}
                        </span>
                      </div>
                      {b.note && (
                        <div className="mt-0.5 max-w-[22ch] truncate text-[11px]" style={{ color: "var(--muted)" }}
                             title={b.note}>
                          {b.note}
                        </div>
                      )}
                    </td>

                    <td className="px-2 py-2 align-top text-xs tnum" style={{ color: "var(--ink-2)" }}>
                      {b.kind === "contract" ? (
                        <>
                          {(b.contracts ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} @{" "}
                          {fmtPrice(b.entryPriceCents ?? 0)}
                        </>
                      ) : (
                        <>{fmtAmerican(b.americanOdds ?? 0)}</>
                      )}
                      <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
                        {isKalshi ? "Kalshi" : "Manual"}
                        {b.side === "no" ? " · NO" : ""}
                      </div>
                    </td>

                    <td className="px-2 py-2 text-right align-top tnum">{fmtMoney(b.stakeCents)}</td>

                    <td className="px-2 py-2 text-right align-top tnum" style={{ color: "var(--ink-2)" }}>
                      {b.status === "open" ? "—" : fmtMoney(b.payoutCents ?? 0)}
                    </td>

                    <td
                      className="px-2 py-2 text-right align-top font-semibold tnum"
                      style={{ color: b.status === "open" ? "var(--muted)" : pl >= 0 ? "var(--pos)" : "var(--neg)" }}
                    >
                      {b.status === "open" ? "—" : fmtMoney(pl, { sign: true })}
                    </td>

                    <td className="px-2 py-2 align-top">
                      <StatusPill status={b.status} />
                      {b.gradedBy && (
                        <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
                          by {b.gradedBy}
                        </div>
                      )}
                    </td>

                    <td className="px-2 py-2 align-top">
                      <div className="flex justify-end gap-1">
                        {!isKalshi && b.status === "open" && !locked && (
                          <>
                            <MiniBtn label="W" title="Mark won" onClick={() => onGrade(b, "won")} tone="pos" />
                            <MiniBtn label="L" title="Mark lost" onClick={() => onGrade(b, "lost")} tone="neg" />
                            <MiniBtn label="P" title="Mark push" onClick={() => onGrade(b, "push")} />
                          </>
                        )}
                        {!locked && (
                          <MiniBtn label="✎" title="Edit" onClick={() => onEdit(b)} />
                        )}
                        {!isKalshi && !locked && (
                          <MiniBtn label="✕" title="Delete" onClick={() => onDelete(b)} tone="neg" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MiniBtn({
  label,
  title,
  onClick,
  tone,
}: {
  label: string;
  title: string;
  onClick: () => void;
  tone?: "pos" | "neg";
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded border px-1.5 py-0.5 text-xs font-semibold leading-none"
      style={{
        borderColor: "var(--line-strong)",
        color: tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : "var(--ink-2)",
        background: "var(--surface-2)",
        minWidth: 24,
        minHeight: 24,
      }}
    >
      {label}
    </button>
  );
}
