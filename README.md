# 🏈 Football Bets

A ledger for football bets: **which team you took, what you risked, what came
back, and whether it hit.** Kalshi positions import themselves over the
read-only trade API; anything placed at a book gets typed in once and then
grades itself from the live NFL scoreboard.

Private: **https://sportsbook.dabrewer.dev** is a DNS-only record pointing at the
box's Tailscale address, so the name resolves for anyone but only *connects* from
the tailnet. Nothing is internet-facing. Dev lives at `http://100.102.159.57:4790`.

---

## What it does

**Two bet shapes, per bet.**

| Shape | What it models | Economics |
|---|---|---|
| `contract` | A Kalshi-style position: N contracts of a side bought at a price in cents | Wager = contracts × price · each winning contract pays $1 |
| `odds` | A traditional sportsbook bet | Wager = stake · return = stake × American odds |

Contracts can be **fractional** — Kalshi fills them that way (2.72 shares is a
real position), so the column is a real, not an integer.

**Three ways a bet gets settled.**

1. **Kalshi settlement** — authoritative for imported bets. The app computes the
   payout as `yes_count × value + no_count × (100 − value)`, which is correct
   for a straight resolution, a scalar settlement, *and* a position traded out
   of before the close. (Kalshi's own `revenue` field reads 0 in that last case,
   so it is recorded but not used.)
2. **Final scores** — a manual bet linked to a game is graded from the box
   score: moneyline, spread (with push on the number), and totals.
3. **By hand** — W / L / P buttons on any manual bet, for props the feed can't
   answer.

**Live scoring.** While any game is in progress, a **Live now** panel shows the
running score, the clock, and where your open money stands *if it ended right
now* — per bet and as a projected swing. Nothing is settled until the game is
final; the panel is a projection, not a result.

ESPN's scoreboard changes about **every 10–11 seconds** during live play
(measured, not assumed), so a long-running worker polls it every **15s** while a
game is in progress and drops to a 2-minute heartbeat when none is. The page
reads the app back on the same 15s cadence — that request only touches local
SQLite, so the upstream feed is hit once per interval no matter how many tabs
are open.

**Three numbers on every bet.**

| Field | Meaning |
|---|---|
| **Amount bet** | What is at risk |
| **To win** | The *profit* if it wins — not the gross return |
| **Current value** | What the position is worth right now |

Current value is a live mark, not an estimate: a second worker holds Kalshi's
**websocket** open and streams every reprice on the markets you hold (~6 ticks a
second across a full Sunday slate). A YES holding is valued at the **bid** and a
NO holding at the complement of the **ask** — what you could actually exit at,
rather than a mid or last-trade price that would flatter a position you can't
sell there. Once a bet settles, its current value is simply what it paid.

Markets that aren't trading show `—` rather than a guess.

**Rollups.** Net P/L, return on risk, record, open exposure, net by week, the
running equity curve, net by team backed, and breakdowns by market and source —
plus current value, unrealized, and realized+unrealized across open positions.

---

## Data sources

| Source | Auth | Used for |
|---|---|---|
| [Kalshi trade API v2](https://docs.kalshi.com) | RSA-PSS signed, read-only | Open positions, settlements, fills, market titles |
| Kalshi websocket (`ticker`) | same headers, read-only | Live prices → current value |
| ESPN NFL scoreboard | none | Schedule, live and final scores |

### Kalshi request signing

Every authenticated call sends three headers — `KALSHI-ACCESS-KEY`,
`KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE` — where the signature is
RSA-PSS/SHA-256 (MGF1-SHA256, salt length = digest length) over
`timestampMs + METHOD + path`. The path **includes** the `/trade-api/v2` prefix
and **excludes** the query string. See [`src/lib/kalshi.ts`](src/lib/kalshi.ts).

The client reads `/portfolio/positions`, `/portfolio/settlements`,
`/portfolio/fills` and `/portfolio/balance`, plus the unauthenticated
`/markets/{ticker}` for titles. **It has no code path that can place, modify or
cancel an order.**

Kalshi is mid-migration between two numeric generations — legacy integer cents
(`yes_price`, `count`) and fixed-point decimal strings in dollars
(`yes_price_dollars`, `count_fp`). The normalizers read whichever is present, so
the sync survives the transition in either direction.

### Ticker parsing

```
KXNFLGAME-26SEP20INDKC-KC     one game, one market per team
└─ series   └─ date └─ pair └─ the team this contract backs

KXNFLAFCNORTH-27-PIT          a season-long futures market
```

Team codes are 2–3 characters, so `INDKC` is split by trying every split point
and accepting only the one where both halves are real teams. If it stays
ambiguous, the bet falls back to matching the schedule on date + the one known
team. Kalshi's `WAS`/`JAC` are folded onto ESPN's canonical `WSH`/`JAX`.

Kalshi dates are in the game's local calendar while ESPN stores kickoff in UTC,
so a night game lands on the next UTC day — game matching uses a ±1 day window.

---

## Running it

```bash
npm install
cp .env.example .env.local   # add KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY_PATH
npm run dev                  # http://localhost:4790
```

Then, in the app: **Sync → Full season** to cache the schedule, and
**Sync Kalshi** to pull positions. Both are also plain endpoints:

```bash
curl -X POST localhost:4790/api/sync/games?full=1
curl -X POST localhost:4790/api/sync/kalshi
curl -X POST localhost:4790/api/grade        # refresh scores, settle what's decided
```

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `KALSHI_API_KEY_ID` | — | Kalshi API key id |
| `KALSHI_PRIVATE_KEY` / `KALSHI_PRIVATE_KEY_PATH` | — | RSA private key, inline or by path |
| `KALSHI_API_BASE` | `https://api.elections.kalshi.com` | Set to the demo host to test |
| `KALSHI_SERIES_PREFIXES` | `KXNFL,KXNCAAF,KXCFB,KXSUPERBOWL` | Which series count as football |
| `BETS_DB_PATH` | `./data/bets.db` | SQLite location |
| `JARVIS_TOKEN` | unset | If set, every write needs it. Unset = open (right for a tailnet box) |
| `JARVIS_ENV` | unset | `dev` shows the amber banner |

---

## Layout

```
src/lib/
  kalshi.ts   signed read-only client + numeric normalizers
  valuation.ts  amount bet / to win / current value
  espn.ts     scoreboard feed -> Game rows
  sync.ts     ticker parsing, game matching, the importer, auto-grading
  grade.ts    score -> result rules (moneyline / spread / total)
  stats.ts    dashboard rollups
  db.ts       SQLite schema + CRUD
  money.ts    integer-cents arithmetic, American odds
  teams.ts    the 32 clubs, alias folding, ticker pair splitting
src/components/
  App.tsx     tabbed shell (Dashboard / Bets / Schedule / Sync)
  Charts.tsx  weekly P/L, equity curve, net by team
scripts/
  live-worker.mjs  adaptive ESPN score poller (15s live / 120s idle)
  ws-worker.mjs    Kalshi websocket -> live prices in SQLite
```

**Money is integer cents everywhere.** Floats appear only at the edges — parsing
a form field or rendering a string.

**Charts** follow the house data-viz rules: a blue↔red *diverging* pair for money
(the sign is the information, gray at zero) and the first three *categorical*
slots for identity. Both sets are validated for colorblind separation and
contrast in light and dark; every chart has a hover layer and a table view.

---

## Deploy

See [`deploy/README.md`](deploy/README.md). Short version: systemd on the box,
prod behind nginx on `sportsbook.dabrewer.dev` (wildcard cert, A record → the
Tailscale IP), dev on its raw port. Cron syncs scores every 2 min and Kalshi
every 15.

```bash
/opt/football-bets/deploy/update.sh           # prod
/opt/football-bets-dev/deploy/update-dev.sh   # dev
```

---

## Notes and gotchas

- **Re-syncing is safe.** Rows are keyed on `(kalshi_ticker, side)` and upserted.
  Notes you add to an imported bet are preserved; its economics are re-derived.
- **Imported rows are read-only apart from the note.** Editing the wager on a
  Kalshi bet would silently revert on the next sync, so the API refuses it.
- **Open bets contribute zero P/L**, and the schedule view says "at risk" rather
  than "+$0.00" for a game whose bets are all still live.
- **A tie** voids a moneyline at a book but settles Kalshi contracts at 50¢; the
  grader handles both.
- **Dev and prod keep separate ledgers** — different SQLite files in different
  clones.
