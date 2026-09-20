/** Where the row came from. Kalshi rows are owned by the sync and re-derived. */
export type BetSource = "manual" | "kalshi";

/**
 * The two bet shapes the tracker understands, per bet:
 *  - `contract` — a Kalshi-style position: N contracts of a side bought at a
 *    price in cents; each winning contract pays $1.
 *  - `odds` — a traditional sportsbook bet: a stake at American odds.
 */
export type BetKind = "contract" | "odds";

export type MarketType = "moneyline" | "spread" | "total" | "prop" | "other";

export type BetStatus = "open" | "won" | "lost" | "push" | "void";

/** Which channel decided the result. */
export type GradedBy = "manual" | "kalshi" | "scores";

export type Bet = {
  id: string;
  source: BetSource;
  kind: BetKind;

  // --- what the bet is on -------------------------------------------------
  /** ESPN event id, once the bet is linked to a real game. */
  gameId: string | null;
  season: number | null;
  seasonType: number | null;
  week: number | null;
  /** Kickoff, ISO. Null for a bet not tied to a scheduled game. */
  eventDate: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  /** The team backed. Null for a total (over/under) or a non-team prop. */
  team: string | null;
  marketType: MarketType;
  /** Spread or total line; sign is from the backed team's perspective. */
  line: number | null;
  /** For a total: which way. */
  overUnder: "over" | "under" | null;
  /** Human-readable selection, e.g. "BUF -3.5" or "Over 47.5". */
  selection: string;

  // --- the economics (integer cents) --------------------------------------
  /** `contract` bets: contracts held (Kalshi allows fractions) and the
   *  average price paid per contract, in cents. */
  contracts: number | null;
  entryPriceCents: number | null;
  /** `odds` bets: the American price. */
  americanOdds: number | null;
  /** What's at risk. For contracts this is contracts x price. */
  stakeCents: number;
  feesCents: number;

  // --- the result ---------------------------------------------------------
  status: BetStatus;
  /** Gross returned, including the stake. 0 on a loss, stake back on a push. */
  payoutCents: number | null;
  settledAt: string | null;
  gradedBy: GradedBy | null;

  // --- Kalshi linkage -----------------------------------------------------
  kalshiTicker: string | null;
  kalshiEventTicker: string | null;
  /** Which side of the Kalshi contract is held. */
  side: "yes" | "no" | null;

  placedAt: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

/** Net profit/loss in cents. Open bets contribute 0 — they are not results. */
export function profitCents(b: Bet): number {
  if (b.status === "open") return 0;
  if (b.status === "void") return 0;
  const payout = b.payoutCents ?? 0;
  return payout - b.stakeCents - b.feesCents;
}

/** Money currently at risk on unresolved bets. */
export function exposureCents(b: Bet): number {
  return b.status === "open" ? b.stakeCents : 0;
}

export type Game = {
  /** ESPN event id. */
  id: string;
  season: number;
  seasonType: number;
  week: number;
  date: string;
  shortName: string;
  name: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  /** "pre" | "in" | "post" */
  state: string;
  completed: boolean;
  statusDetail: string;
  updatedAt: string;
};

export type SyncLog = {
  id: number;
  kind: "games" | "kalshi";
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  detail: string;
};

export const STATUS_LABEL: Record<BetStatus, string> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  push: "Push",
  void: "Void",
};
