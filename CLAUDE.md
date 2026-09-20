# Football Bets — working notes

Personal, tailnet-only bet ledger. Next.js 16 + better-sqlite3, same shape as
`savings-tracker` and `soundboard`.

## Ground rules

- **Read-only against Kalshi.** `src/lib/kalshi.ts` has no order path and must
  not grow one. The stored credential *can* trade, which is exactly why the code
  must not.
- **Money is integer cents.** Convert at the edges only (`src/lib/money.ts`).
- **Don't trust `settlement.revenue`.** It reads 0 for a position that was
  closed before the market resolved. Payout is
  `yes_count × value + no_count × (100 − value)` — see `normalizeSettlement`.
- **Kalshi contracts are fractional.** `contracts` is a REAL. Don't "fix" it.
- **Kalshi rows are owned by the sync.** Keyed `(kalshi_ticker, side)`, upserted
  every run. Only `note` is user-owned; the PATCH route enforces that.
- **Charts** follow the `dataviz` skill: diverging blue↔red for money,
  categorical slots 1–3 for identity, validated palette, hover + table view.
  Don't introduce a second y-axis or a cycled hue.

## Two numeric generations in the Kalshi API

Legacy integer cents (`count`, `yes_price`) and newer fixed-point dollar strings
(`count_fp`, `yes_price_dollars`) are both in flight. The normalizers read
whichever is present — keep it that way until the legacy fields are gone.

## Testing against real data

The account has live NFL positions. A sync is non-destructive and idempotent, so
running it twice is the cheapest regression test:

```bash
curl -X POST localhost:4790/api/sync/kalshi   # second run: created 0, updated N
```

## Deploy

Tailnet only — systemd, **no nginx block, no DNS record**. dev `:4790`,
prod `:4780`. `deploy/update-dev.sh` / `deploy/update.sh`.
Secrets live in `/home/dan/.config/jarvis/`, never in the repo.
