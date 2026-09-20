import type { Bet } from "./types";
import { profitCents } from "./types";

export type Totals = {
  bets: number;
  settled: number;
  wageredCents: number;
  returnedCents: number;
  netCents: number;
  feesCents: number;
  /** Net divided by money actually put at risk on settled bets. */
  roi: number;
  openExposureCents: number;
  openBets: number;
  won: number;
  lost: number;
  push: number;
  voided: number;
  /** Wins over decided bets (pushes and voids excluded). */
  winRate: number;
  biggestWinCents: number;
  biggestLossCents: number;
};

export type Bucket = {
  key: string;
  label: string;
  bets: number;
  won: number;
  lost: number;
  wageredCents: number;
  netCents: number;
};

export type Stats = {
  totals: Totals;
  byWeek: Bucket[];
  byTeam: Bucket[];
  byMarket: Bucket[];
  bySource: Bucket[];
  /** Running net P/L in settle order — the equity curve. */
  cumulative: { at: string; netCents: number }[];
};

const isSettled = (b: Bet) => b.status === "won" || b.status === "lost" || b.status === "push";

export function computeStats(bets: Bet[]): Stats {
  const settled = bets.filter(isSettled);

  let wagered = 0;
  let returned = 0;
  let fees = 0;
  let biggestWin = 0;
  let biggestLoss = 0;

  for (const b of settled) {
    wagered += b.stakeCents;
    returned += b.payoutCents ?? 0;
    fees += b.feesCents;
    const p = profitCents(b);
    if (p > biggestWin) biggestWin = p;
    if (p < biggestLoss) biggestLoss = p;
  }

  const net = returned - wagered - fees;
  const won = settled.filter((b) => b.status === "won").length;
  const lost = settled.filter((b) => b.status === "lost").length;
  const push = settled.filter((b) => b.status === "push").length;
  const voided = bets.filter((b) => b.status === "void").length;
  const open = bets.filter((b) => b.status === "open");
  const decided = won + lost;

  const totals: Totals = {
    bets: bets.length,
    settled: settled.length,
    wageredCents: wagered,
    returnedCents: returned,
    netCents: net,
    feesCents: fees,
    roi: wagered > 0 ? net / wagered : 0,
    openExposureCents: open.reduce((a, b) => a + b.stakeCents, 0),
    openBets: open.length,
    won,
    lost,
    push,
    voided,
    winRate: decided > 0 ? won / decided : 0,
    biggestWinCents: biggestWin,
    biggestLossCents: biggestLoss,
  };

  return {
    totals,
    byWeek: bucket(settled, (b) => (b.week ? [`w${b.week}`, `Week ${b.week}`] : ["none", "No week"]))
      .sort((a, b) => weekNum(a.key) - weekNum(b.key)),
    byTeam: bucket(settled, (b) => (b.team ? [b.team, b.team] : null))
      .sort((a, b) => b.netCents - a.netCents),
    byMarket: bucket(settled, (b) => [b.marketType, marketLabel(b.marketType)]),
    bySource: bucket(settled, (b) => [b.source, b.source === "kalshi" ? "Kalshi" : "Manual"]),
    cumulative: cumulative(settled),
  };
}

function marketLabel(m: string): string {
  return (
    { moneyline: "Moneyline", spread: "Spread", total: "Total", prop: "Prop", other: "Other" }[m] ?? m
  );
}

function weekNum(key: string): number {
  return key.startsWith("w") ? Number(key.slice(1)) : 999;
}

function bucket(bets: Bet[], keyOf: (b: Bet) => [string, string] | null): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const b of bets) {
    const k = keyOf(b);
    if (!k) continue;
    const [key, label] = k;
    const cur =
      map.get(key) ?? { key, label, bets: 0, won: 0, lost: 0, wageredCents: 0, netCents: 0 };
    cur.bets++;
    if (b.status === "won") cur.won++;
    if (b.status === "lost") cur.lost++;
    cur.wageredCents += b.stakeCents;
    cur.netCents += profitCents(b);
    map.set(key, cur);
  }
  return [...map.values()];
}

function cumulative(settled: Bet[]): { at: string; netCents: number }[] {
  const ordered = [...settled].sort((a, b) =>
    (a.settledAt ?? a.placedAt).localeCompare(b.settledAt ?? b.placedAt),
  );
  let running = 0;
  return ordered.map((b) => {
    running += profitCents(b);
    return { at: b.settledAt ?? b.placedAt, netCents: running };
  });
}
