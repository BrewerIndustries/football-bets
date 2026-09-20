/**
 * Every monetary value in this app is an integer number of **cents**. Floats are
 * only allowed at the edges (parsing a form field, rendering a string). Kalshi
 * itself quotes contract prices in cents, so cents is the natural unit here.
 */

export function dollarsToCents(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : fallback;
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** "$1,234.56" / "-$12.00" — the sign leads, so a loss never reads as a total. */
export function fmtMoney(cents: number, opts: { sign?: boolean } = {}): string {
  const neg = cents < 0;
  const body = (Math.abs(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  if (neg) return `-${body}`;
  return opts.sign ? `+${body}` : body;
}

/** Contract prices display as cents: 62¢. */
export function fmtPrice(cents: number): string {
  return `${Math.round(cents)}¢`;
}

export function fmtPct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** American odds → profit on a winning stake (excludes the returned stake). */
export function americanProfitCents(odds: number, stakeCents: number): number {
  if (!odds || !Number.isFinite(odds)) return 0;
  return odds > 0
    ? Math.round((stakeCents * odds) / 100)
    : Math.round((stakeCents * 100) / Math.abs(odds));
}

/** American odds → gross return on a win (stake + profit). */
export function americanPayoutCents(odds: number, stakeCents: number): number {
  return stakeCents + americanProfitCents(odds, stakeCents);
}

/** American odds → break-even (vig-inclusive) implied probability. */
export function impliedProbability(odds: number): number {
  if (!odds || !Number.isFinite(odds)) return NaN;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Contract price in cents → implied probability (a $1 contract at 62¢ = 62%). */
export function priceProbability(priceCents: number): number {
  return priceCents / 100;
}

/** American odds formatted the way a book shows them: -110 / +150. */
export function fmtAmerican(odds: number): string {
  if (!Number.isFinite(odds) || odds === 0) return "—";
  return odds > 0 ? `+${Math.round(odds)}` : `${Math.round(odds)}`;
}

export function fmtSigned(n: number, digits = 1): string {
  const s = n.toFixed(digits).replace(/\.0$/, "");
  return n > 0 ? `+${s}` : s;
}
