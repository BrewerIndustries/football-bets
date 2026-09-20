import type { Bet, Game } from "./types";
import type { MarketPrice } from "./db";
import { americanProfitCents } from "./money";
import { resultFromScore } from "./grade";

/**
 * The three numbers a bettor actually wants on every row:
 *
 *   Amount bet    — what is at risk
 *   To win        — the profit if it wins (not the gross return)
 *   Current value — what the position is worth right now
 *
 * "Current value" is only knowable while a market is trading, so it comes from
 * the live Kalshi price and is null for anything we have no price for. A
 * settled bet's current value is simply what it paid.
 */
export type Valuation = {
  amountBetCents: number;
  toWinCents: number;
  currentValueCents: number | null;
  /** Current value minus what was put in. Null when value is unknown. */
  unrealizedCents: number | null;
  /** The per-contract price behind the valuation, in cents. */
  priceCents: number | null;
  priceAt: string | null;
  /**
   * True when the game is over and the outcome is known, but the position has
   * not been settled yet. The value shown is the settlement the score implies,
   * not a market price.
   */
  pendingSettlement: boolean;
};

/** Profit if the bet wins — the "to win" figure books quote. */
export function toWinCents(bet: Bet): number {
  if (bet.kind === "contract") {
    // Each winning contract returns $1; the profit is that less what it cost.
    return Math.max(0, Math.round((bet.contracts ?? 0) * 100) - bet.stakeCents);
  }
  if (bet.americanOdds) return americanProfitCents(bet.americanOdds, bet.stakeCents);
  return 0;
}

export function valueBet(
  bet: Bet,
  prices: Map<string, MarketPrice>,
  game?: Game | null,
): Valuation {
  const amountBetCents = bet.stakeCents;
  const win = toWinCents(bet);

  // Settled: the position is worth exactly what it returned.
  if (bet.status !== "open") {
    const payout = bet.payoutCents ?? 0;
    return {
      amountBetCents,
      toWinCents: win,
      currentValueCents: payout,
      unrealizedCents: payout - amountBetCents - bet.feesCents,
      priceCents: null,
      priceAt: null,
      pendingSettlement: false,
    };
  }

  // The game is over but the position has not settled yet — Kalshi settlements
  // import on their own schedule. A closed market has no bid, so marking to the
  // order book here would value every position at zero and show a winning bet
  // as a total loss. The final score already decides it, so use that.
  if (game?.completed) {
    const decided = resultFromScore(bet, game);
    if (decided) {
      return {
        amountBetCents,
        toWinCents: win,
        currentValueCents: decided.payoutCents,
        unrealizedCents: decided.payoutCents - amountBetCents - bet.feesCents,
        priceCents: null,
        priceAt: null,
        pendingSettlement: true,
      };
    }
  }

  const p = bet.kalshiTicker ? prices.get(bet.kalshiTicker) : undefined;
  if (!p || bet.contracts === null) {
    return {
      amountBetCents,
      toWinCents: win,
      currentValueCents: null,
      unrealizedCents: null,
      priceCents: null,
      priceAt: null,
      pendingSettlement: false,
    };
  }

  // Value the position at what it could actually be sold for — the bid for a
  // YES holding, and the complement of the ask for a NO holding. Using the
  // mid or the last trade would flatter a position you can't exit at that
  // price.
  const bid = p.yesBidCents;
  const ask = p.yesAskCents;
  const last = p.priceCents;

  let exitCents: number | null;
  if (bet.side === "no") {
    exitCents = ask !== null ? 100 - ask : last !== null ? 100 - last : null;
  } else {
    exitCents = bid ?? last;
  }
  if (exitCents === null) {
    return {
      amountBetCents,
      toWinCents: win,
      currentValueCents: null,
      unrealizedCents: null,
      priceCents: null,
      priceAt: p.updatedAt,
      pendingSettlement: false,
    };
  }

  const currentValueCents = Math.round(bet.contracts * exitCents);
  return {
    amountBetCents,
    toWinCents: win,
    currentValueCents,
    unrealizedCents: currentValueCents - amountBetCents - bet.feesCents,
    priceCents: exitCents,
    priceAt: p.updatedAt,
    pendingSettlement: false,
  };
}

export function valueAll(
  bets: Bet[],
  prices: MarketPrice[],
  games: Game[] = [],
): Record<string, Valuation> {
  const byTicker = new Map(prices.map((p) => [p.ticker, p]));
  const byGame = new Map(games.map((g) => [g.id, g]));
  const out: Record<string, Valuation> = {};
  for (const b of bets) out[b.id] = valueBet(b, byTicker, b.gameId ? byGame.get(b.gameId) : null);
  return out;
}

/** Portfolio-level marks across open positions we have a price for. */
export function openPortfolio(bets: Bet[], valuations: Record<string, Valuation>) {
  let costCents = 0;
  let valueCents = 0;
  let priced = 0;
  let unpriced = 0;
  for (const b of bets) {
    if (b.status !== "open") continue;
    const v = valuations[b.id];
    if (!v || v.currentValueCents === null) {
      unpriced++;
      continue;
    }
    priced++;
    costCents += v.amountBetCents + b.feesCents;
    valueCents += v.currentValueCents;
  }
  return { costCents, valueCents, unrealizedCents: valueCents - costCents, priced, unpriced };
}
