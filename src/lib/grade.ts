import type { Bet, BetStatus, Game } from "./types";
import { americanPayoutCents } from "./money";

export type Grade = {
  status: BetStatus;
  /** Gross returned, including the stake. */
  payoutCents: number;
  reason: string;
};

/**
 * Decide a bet from a finished game's score. Returns null when the bet can't be
 * settled from the box score alone — the game isn't final, the bet isn't linked
 * to a game, or it's a prop the feed can't answer. Kalshi-sourced bets are
 * never graded here: their own settlement record is authoritative.
 */
export function gradeFromGame(bet: Bet, game: Game): Grade | null {
  if (bet.source === "kalshi") return null;
  if (bet.status !== "open") return null;
  if (!game.completed) return null;
  if (game.homeScore === null || game.awayScore === null) return null;

  const { homeScore, awayScore } = game;
  const total = homeScore + awayScore;

  // --- total (over/under) — the one market with no team ---------------------
  if (bet.marketType === "total") {
    if (bet.line === null || !bet.overUnder) return null;
    const diff = total - bet.line;
    if (diff === 0) return { status: "push", payoutCents: bet.stakeCents, reason: `Total ${total} landed on ${bet.line}` };
    const hit = bet.overUnder === "over" ? diff > 0 : diff < 0;
    return hit
      ? { status: "won", payoutCents: winPayout(bet), reason: `Total ${total} ${bet.overUnder} ${bet.line}` }
      : { status: "lost", payoutCents: 0, reason: `Total ${total} missed ${bet.overUnder} ${bet.line}` };
  }

  // Everything below needs to know which side was backed.
  if (!bet.team) return null;
  const isHome = bet.team === game.homeTeam;
  const isAway = bet.team === game.awayTeam;
  if (!isHome && !isAway) return null;

  const teamScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;

  // --- spread ---------------------------------------------------------------
  if (bet.marketType === "spread") {
    if (bet.line === null) return null;
    const margin = teamScore + bet.line - oppScore;
    if (margin === 0) {
      return { status: "push", payoutCents: bet.stakeCents, reason: `${bet.team} ${fmtLine(bet.line)} landed exactly on the number` };
    }
    return margin > 0
      ? { status: "won", payoutCents: winPayout(bet), reason: `${bet.team} ${fmtLine(bet.line)} covered (${teamScore}-${oppScore})` }
      : { status: "lost", payoutCents: 0, reason: `${bet.team} ${fmtLine(bet.line)} did not cover (${teamScore}-${oppScore})` };
  }

  // --- moneyline (and a manually-entered contract on a team to win) ---------
  if (bet.marketType === "moneyline") {
    if (teamScore === oppScore) {
      // A tie voids a moneyline at a book; Kalshi splits the contract at 50c.
      return bet.kind === "contract"
        ? {
            status: "push",
            payoutCents: Math.round((bet.contracts ?? 0) * 50),
            reason: `Tie ${teamScore}-${oppScore} — contracts settle at 50¢`,
          }
        : { status: "push", payoutCents: bet.stakeCents, reason: `Tie ${teamScore}-${oppScore}` };
    }
    return teamScore > oppScore
      ? { status: "won", payoutCents: winPayout(bet), reason: `${bet.team} won ${teamScore}-${oppScore}` }
      : { status: "lost", payoutCents: 0, reason: `${bet.team} lost ${teamScore}-${oppScore}` };
  }

  // props and anything else need a human
  return null;
}

/** Gross return on a winning bet, by shape. */
export function winPayout(bet: Bet): number {
  if (bet.kind === "contract") {
    // Each winning contract pays $1.
    return Math.round((bet.contracts ?? 0) * 100);
  }
  if (bet.americanOdds) return americanPayoutCents(bet.americanOdds, bet.stakeCents);
  // No price recorded — the stake comes back and nothing more, which at least
  // never invents profit that didn't happen.
  return bet.stakeCents;
}

function fmtLine(line: number): string {
  return line > 0 ? `+${line}` : `${line}`;
}

/** A human-readable description of what a bet is on. */
export function describeSelection(bet: Bet): string {
  if (bet.selection) return bet.selection;
  if (bet.marketType === "total" && bet.overUnder && bet.line !== null) {
    return `${bet.overUnder === "over" ? "Over" : "Under"} ${bet.line}`;
  }
  if (bet.marketType === "spread" && bet.team && bet.line !== null) {
    return `${bet.team} ${fmtLine(bet.line)}`;
  }
  if (bet.team) return `${bet.team} ML`;
  return "—";
}
