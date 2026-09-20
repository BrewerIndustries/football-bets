"use client";

import { Card, Empty, StatTile } from "./ui";
import { EquityCurve, TeamBars, WeeklyPL } from "./Charts";
import { fmtMoney, fmtPct } from "@/lib/money";
import type { Stats } from "@/lib/stats";

export default function Dashboard({ stats }: { stats: Stats }) {
  const t = stats.totals;
  const tone = t.netCents > 0 ? "pos" : t.netCents < 0 ? "neg" : "neutral";

  if (t.bets === 0) {
    return (
      <Card title="Nothing tracked yet">
        <Empty>
          Sync your Kalshi positions, or add a bet by hand — the rollups fill in from there.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Exactly one hero figure on the view: the number the app exists for. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Net profit / loss"
          value={fmtMoney(t.netCents, { sign: true })}
          sub={`${t.settled} settled bet${t.settled === 1 ? "" : "s"} · ${fmtMoney(t.feesCents)} in fees`}
          tone={tone}
          hero
        />
        <StatTile
          label="Return on risk"
          value={t.wageredCents > 0 ? fmtPct(t.roi) : "—"}
          sub={`${fmtMoney(t.wageredCents)} wagered · ${fmtMoney(t.returnedCents)} back`}
          tone={tone}
        />
        <StatTile
          label="Record"
          value={`${t.won}–${t.lost}${t.push ? `–${t.push}` : ""}`}
          sub={t.won + t.lost > 0 ? `${fmtPct(t.winRate, 0)} of decided bets` : "No decided bets yet"}
        />
        <StatTile
          label="Open exposure"
          value={fmtMoney(t.openExposureCents)}
          sub={`${t.openBets} bet${t.openBets === 1 ? "" : "s"} still live`}
        />
      </div>

      <Card
        title="Net by week"
        subtitle="Settled bets only. Blue is a winning week, red a losing one; the best and worst are labelled."
      >
        <WeeklyPL buckets={stats.byWeek} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Running total" subtitle="Cumulative profit and loss in the order bets settled.">
          <EquityCurve points={stats.cumulative} />
        </Card>

        <Card title="Best and worst weeks" subtitle="Two extremes, plus what the rest cost.">
          <div className="grid gap-3">
            <StatTile
              label="Biggest single win"
              value={fmtMoney(t.biggestWinCents, { sign: true })}
              tone={t.biggestWinCents > 0 ? "pos" : "neutral"}
            />
            <StatTile
              label="Biggest single loss"
              value={fmtMoney(t.biggestLossCents, { sign: true })}
              tone={t.biggestLossCents < 0 ? "neg" : "neutral"}
            />
          </div>
        </Card>
      </div>

      <Card title="Net by team backed" subtitle="Which teams have actually paid — best to worst.">
        <TeamBars buckets={stats.byTeam} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="By market" subtitle="Where the money goes, by bet type.">
          <BucketTable rows={stats.byMarket} />
        </Card>
        <Card title="By source" subtitle="Imported from Kalshi versus entered by hand.">
          <BucketTable rows={stats.bySource} />
        </Card>
      </div>
    </div>
  );
}

/**
 * The table view that the color relief rule requires: every value the charts
 * encode is also readable as text.
 */
function BucketTable({ rows }: { rows: { key: string; label: string; bets: number; won: number; lost: number; wageredCents: number; netCents: number }[] }) {
  if (rows.length === 0) return <Empty>No settled bets yet.</Empty>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs" style={{ color: "var(--muted)" }}>
          <th className="py-1.5 font-medium">Type</th>
          <th className="py-1.5 text-right font-medium">Bets</th>
          <th className="py-1.5 text-right font-medium">Record</th>
          <th className="py-1.5 text-right font-medium">Wagered</th>
          <th className="py-1.5 text-right font-medium">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} style={{ borderTop: "1px solid var(--line)" }}>
            <td className="py-1.5">{r.label}</td>
            <td className="py-1.5 text-right tnum">{r.bets}</td>
            <td className="py-1.5 text-right tnum" style={{ color: "var(--ink-2)" }}>
              {r.won}–{r.lost}
            </td>
            <td className="py-1.5 text-right tnum" style={{ color: "var(--ink-2)" }}>
              {fmtMoney(r.wageredCents)}
            </td>
            <td
              className="py-1.5 text-right font-semibold tnum"
              style={{ color: r.netCents >= 0 ? "var(--pos)" : "var(--neg)" }}
            >
              {fmtMoney(r.netCents, { sign: true })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
