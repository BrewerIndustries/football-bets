"use client";

import { Card, Empty, StatTile } from "./ui";
import { EquityCurve, TeamBars, WeeklyPL } from "./Charts";
import { fmtMoney, fmtPct } from "@/lib/money";
import type { Stats, Totals } from "@/lib/stats";
import type { openPortfolio } from "@/lib/valuation";

type Portfolio = ReturnType<typeof openPortfolio>;

export default function Dashboard({
  stats,
  portfolio,
  pricedAt,
}: {
  stats: Stats;
  portfolio: Portfolio;
  pricedAt: string | null;
}) {
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
    <div className="grid grid-cols-1 gap-4">
      {/* Exactly one hero figure on the view: the number the app exists for. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      {/* Mark to market: only meaningful while positions are still trading. */}
      {portfolio.priced > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label="Current value of open bets"
            value={fmtMoney(portfolio.valueCents)}
            sub={`${fmtMoney(portfolio.costCents)} in · ${portfolio.priced} position${
              portfolio.priced === 1 ? "" : "s"
            } priced${portfolio.unpriced ? ` · ${portfolio.unpriced} not trading` : ""}`}
          />
          <StatTile
            label="Unrealized"
            value={fmtMoney(portfolio.unrealizedCents, { sign: true })}
            sub="If every open position were sold at the current bid"
            tone={portfolio.unrealizedCents > 0 ? "pos" : portfolio.unrealizedCents < 0 ? "neg" : "neutral"}
          />
          <StatTile
            label="Realized + unrealized"
            value={fmtMoney(t.netCents + portfolio.unrealizedCents, { sign: true })}
            sub={
              pricedAt
                ? `Priced ${new Date(pricedAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}`
                : "No live prices yet"
            }
            tone={
              t.netCents + portfolio.unrealizedCents > 0
                ? "pos"
                : t.netCents + portfolio.unrealizedCents < 0
                  ? "neg"
                  : "neutral"
            }
          />
        </div>
      )}

      <div className="hidden lg:block">
        <Card
          title="Net by week"
          subtitle="Settled bets only. Blue is a winning week, red a losing one; the best and worst are labelled."
        >
          <WeeklyPL buckets={stats.byWeek} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="hidden lg:block">
          <Card title="Running total" subtitle="Cumulative profit and loss in the order bets settled.">
            <EquityCurve points={stats.cumulative} />
          </Card>
        </div>

        <Card title="Best and worst weeks" subtitle="Two extremes, plus what the rest cost.">
          <div className="grid grid-cols-1 gap-3">
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

      <div className="hidden lg:block">
        <Card title="Net by team backed" subtitle="Which teams have actually paid — best to worst.">
          <TeamBars buckets={stats.byTeam} />
        </Card>
      </div>

      <Card title="By market" subtitle="Where the money goes, by bet type.">
        <BucketTable rows={stats.byMarket} />
      </Card>

      <Card
        title="Results week by week"
        subtitle="Every settled bet, grouped by the week it was played."
      >
        <WeekByWeek weeks={stats.byWeek} totals={t} />
      </Card>
    </div>
  );
}

/**
 * The week-by-week ledger, closed by a summary line. Running net is carried
 * across rows so the last one reconciles to the headline number at the top of
 * the page — if those two ever disagree, something is wrong.
 */
function WeekByWeek({ weeks, totals }: { weeks: Stats["byWeek"]; totals: Totals }) {
  if (weeks.length === 0) return <Empty>No settled bets yet.</Empty>;

  let running = 0;
  const rows = weeks.map((w) => {
    running += w.netCents;
    return { ...w, running };
  });

  return (
    <>
      {/* Bets / Bet / Returned drop away on a phone so the table fits without
          scrolling sideways; week, record, net and running always survive. */}
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs" style={{ color: "var(--muted)" }}>
              <th className="py-2 font-medium">Week</th>
              <th className="hidden py-2 text-right font-medium sm:table-cell">Bets</th>
              <th className="py-2 text-right font-medium">Record</th>
              <th className="hidden py-2 text-right font-medium sm:table-cell">Bet</th>
              <th className="hidden py-2 text-right font-medium md:table-cell">Returned</th>
              <th className="py-2 text-right font-medium">Net</th>
              <th className="py-2 text-right font-medium">Running</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.key} style={{ borderTop: "1px solid var(--line)" }}>
                <td className="py-2 font-medium">{w.label}</td>
                <td className="hidden py-2 text-right tnum sm:table-cell" style={{ color: "var(--ink-2)" }}>
                  {w.bets}
                </td>
                <td className="py-2 text-right tnum" style={{ color: "var(--ink-2)" }}>
                  {w.won}–{w.lost}
                  {w.push ? `–${w.push}` : ""}
                </td>
                <td className="hidden py-2 text-right tnum sm:table-cell" style={{ color: "var(--ink-2)" }}>
                  {fmtMoney(w.wageredCents)}
                </td>
                <td className="hidden py-2 text-right tnum md:table-cell" style={{ color: "var(--ink-2)" }}>
                  {fmtMoney(w.returnedCents)}
                </td>
                <td
                  className="py-2 text-right font-semibold tnum"
                  style={{ color: w.netCents >= 0 ? "var(--pos)" : "var(--neg)" }}
                >
                  {fmtMoney(w.netCents, { sign: true })}
                </td>
                <td
                  className="py-2 text-right tnum"
                  style={{ color: w.running >= 0 ? "var(--pos)" : "var(--neg)" }}
                >
                  {fmtMoney(w.running, { sign: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div
        className="mt-4 rounded-lg border px-4 py-3"
        style={{ background: "var(--surface-2)", borderColor: "var(--line)" }}
      >
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Summary
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          <SummaryLine label="Weeks played" value={String(weeks.length)} />
          <SummaryLine
            label="Record"
            value={`${totals.won}–${totals.lost}${totals.push ? `–${totals.push}` : ""}`}
            sub={totals.won + totals.lost > 0 ? `${fmtPct(totals.winRate, 0)} of decided` : undefined}
          />
          <SummaryLine label="Total bet" value={fmtMoney(totals.wageredCents)} />
          <SummaryLine label="Total returned" value={fmtMoney(totals.returnedCents)} />
          <SummaryLine
            label="Winning weeks"
            value={`${weeks.filter((w) => w.netCents > 0).length} of ${weeks.length}`}
          />
          <SummaryLine label="Fees paid" value={fmtMoney(totals.feesCents)} />
          <SummaryLine
            label="Return on risk"
            value={totals.wageredCents > 0 ? fmtPct(totals.roi) : "—"}
            tone={totals.roi > 0 ? "pos" : totals.roi < 0 ? "neg" : undefined}
          />
          <SummaryLine
            label="Net profit / loss"
            value={fmtMoney(totals.netCents, { sign: true })}
            tone={totals.netCents > 0 ? "pos" : totals.netCents < 0 ? "neg" : undefined}
          />
        </div>
      </div>
    </>
  );
}

function SummaryLine({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--muted)" }}>{label}</div>
      <div
        className="text-base font-semibold tnum"
        style={{ color: tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : "var(--ink)" }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px]" style={{ color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

/**
 * The table view that the color relief rule requires: every value the charts
 * encode is also readable as text.
 */
function BucketTable({ rows }: { rows: Stats["byMarket"] }) {
  if (rows.length === 0) return <Empty>No settled bets yet.</Empty>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs" style={{ color: "var(--muted)" }}>
          <th className="py-1.5 font-medium">Type</th>
          <th className="hidden py-1.5 text-right font-medium sm:table-cell">Bets</th>
          <th className="py-1.5 text-right font-medium">Record</th>
          <th className="hidden py-1.5 text-right font-medium sm:table-cell">Wagered</th>
          <th className="py-1.5 text-right font-medium">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} style={{ borderTop: "1px solid var(--line)" }}>
            <td className="py-1.5">{r.label}</td>
            <td className="hidden py-1.5 text-right tnum sm:table-cell">{r.bets}</td>
            <td className="py-1.5 text-right tnum" style={{ color: "var(--ink-2)" }}>
              {r.won}–{r.lost}
            </td>
            <td className="hidden py-1.5 text-right tnum sm:table-cell" style={{ color: "var(--ink-2)" }}>
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
