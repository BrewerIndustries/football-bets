/**
 * NFL team table. ESPN abbreviations are the canonical key everywhere in this
 * app; Kalshi's tickers use a near-identical set with a handful of exceptions
 * (WAS/WSH, JAC/JAX), which ALIASES folds back onto the canonical code.
 */

export type Team = {
  /** Canonical (ESPN) abbreviation — the key used in the DB and the UI. */
  abbr: string;
  location: string;
  name: string;
  /** Primary club color, used only for the team chip — never for chart series. */
  color: string;
};

export const TEAMS: Team[] = [
  { abbr: "ARI", location: "Arizona", name: "Cardinals", color: "#97233F" },
  { abbr: "ATL", location: "Atlanta", name: "Falcons", color: "#A71930" },
  { abbr: "BAL", location: "Baltimore", name: "Ravens", color: "#241773" },
  { abbr: "BUF", location: "Buffalo", name: "Bills", color: "#00338D" },
  { abbr: "CAR", location: "Carolina", name: "Panthers", color: "#0085CA" },
  { abbr: "CHI", location: "Chicago", name: "Bears", color: "#0B162A" },
  { abbr: "CIN", location: "Cincinnati", name: "Bengals", color: "#FB4F14" },
  { abbr: "CLE", location: "Cleveland", name: "Browns", color: "#311D00" },
  { abbr: "DAL", location: "Dallas", name: "Cowboys", color: "#041E42" },
  { abbr: "DEN", location: "Denver", name: "Broncos", color: "#FB4F14" },
  { abbr: "DET", location: "Detroit", name: "Lions", color: "#0076B6" },
  { abbr: "GB", location: "Green Bay", name: "Packers", color: "#203731" },
  { abbr: "HOU", location: "Houston", name: "Texans", color: "#03202F" },
  { abbr: "IND", location: "Indianapolis", name: "Colts", color: "#002C5F" },
  { abbr: "JAX", location: "Jacksonville", name: "Jaguars", color: "#006778" },
  { abbr: "KC", location: "Kansas City", name: "Chiefs", color: "#E31837" },
  { abbr: "LAC", location: "Los Angeles", name: "Chargers", color: "#0080C6" },
  { abbr: "LAR", location: "Los Angeles", name: "Rams", color: "#003594" },
  { abbr: "LV", location: "Las Vegas", name: "Raiders", color: "#000000" },
  { abbr: "MIA", location: "Miami", name: "Dolphins", color: "#008E97" },
  { abbr: "MIN", location: "Minnesota", name: "Vikings", color: "#4F2683" },
  { abbr: "NE", location: "New England", name: "Patriots", color: "#002244" },
  { abbr: "NO", location: "New Orleans", name: "Saints", color: "#D3BC8D" },
  { abbr: "NYG", location: "New York", name: "Giants", color: "#0B2265" },
  { abbr: "NYJ", location: "New York", name: "Jets", color: "#125740" },
  { abbr: "PHI", location: "Philadelphia", name: "Eagles", color: "#004C54" },
  { abbr: "PIT", location: "Pittsburgh", name: "Steelers", color: "#FFB612" },
  { abbr: "SEA", location: "Seattle", name: "Seahawks", color: "#002244" },
  { abbr: "SF", location: "San Francisco", name: "49ers", color: "#AA0000" },
  { abbr: "TB", location: "Tampa Bay", name: "Buccaneers", color: "#D50A0A" },
  { abbr: "TEN", location: "Tennessee", name: "Titans", color: "#0C2340" },
  { abbr: "WSH", location: "Washington", name: "Commanders", color: "#5A1414" },
];

const BY_ABBR = new Map(TEAMS.map((t) => [t.abbr, t]));

/** Non-canonical codes seen in the wild (Kalshi tickers, older feeds). */
const ALIASES: Record<string, string> = {
  WAS: "WSH",
  WFT: "WSH",
  JAC: "JAX",
  LA: "LAR",
  SD: "LAC",
  OAK: "LV",
  STL: "LAR",
  ARZ: "ARI",
  CLV: "CLE",
  HST: "HOU",
  BLT: "BAL",
};

export function canonicalTeam(code: string | null | undefined): string | null {
  if (!code) return null;
  const up = code.trim().toUpperCase();
  const mapped = ALIASES[up] ?? up;
  return BY_ABBR.has(mapped) ? mapped : null;
}

export function team(abbr: string | null | undefined): Team | null {
  const c = canonicalTeam(abbr);
  return c ? BY_ABBR.get(c)! : null;
}

export function teamLabel(abbr: string | null | undefined): string {
  const t = team(abbr);
  return t ? `${t.location} ${t.name}` : (abbr ?? "—");
}

/**
 * Split a Kalshi event ticker's concatenated team pair ("PHICHI", "NESEA",
 * "LARDEN") into its two codes. Code lengths vary 2–3, so every split point is
 * tried and only one where BOTH halves are real teams is accepted; a pair that
 * stays ambiguous returns null and the caller falls back to schedule matching.
 */
export function splitTeamPair(pair: string): [string, string] | null {
  const s = pair.trim().toUpperCase();
  const hits: [string, string][] = [];
  for (let i = 2; i <= s.length - 2; i++) {
    const a = canonicalTeam(s.slice(0, i));
    const b = canonicalTeam(s.slice(i));
    if (a && b && a !== b) hits.push([a, b]);
  }
  return hits.length === 1 ? hits[0] : null;
}
