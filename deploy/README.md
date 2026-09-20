# Deploy — Football Bets

Tailnet-only by design: **no nginx block and no public DNS record.** The app is
reached over Tailscale at `http://100.102.159.57:<port>`, the same way the
dashboard is on `:4500`. Nothing about this app is exposed to the internet.

| env | branch | clone | port | URL |
|---|---|---|---|---|
| dev | `dev` | `/opt/football-bets-dev` | 4790 | http://100.102.159.57:4790 |
| prod | `main` | `/opt/football-bets` | 4780 | http://100.102.159.57:4780 |

## Secrets

The Kalshi credential is **not** in this repo. It lives in the shared secrets
directory on the box and each clone's `.env` points at it:

```
/home/dan/.config/jarvis/kalshi.env             # KALSHI_API_KEY_ID
/home/dan/.config/jarvis/kalshi-private-key.pem # RSA private key, mode 600
```

`.env` in each clone is generated at install time from `.env.example` and is
gitignored. It carries `KALSHI_API_KEY_ID` and
`KALSHI_PRIVATE_KEY_PATH=/home/dan/.config/jarvis/kalshi-private-key.pem`.

The key is a **trading** credential. This app only calls read endpoints, but the
key itself can place orders — treat it accordingly, and rotate it at
kalshi.com if it is ever pasted anywhere it shouldn't be.

## First install

```bash
sudo mkdir -p /opt/football-bets-dev && sudo chown dan:dan /opt/football-bets-dev
git clone -b dev git@github-football-bets:BrewerIndustries/football-bets.git /opt/football-bets-dev
cd /opt/football-bets-dev
cp .env.example .env && $EDITOR .env      # fill KALSHI_API_KEY_ID, set JARVIS_ENV=dev
npm install && npm run build
sudo cp deploy/football-bets-dev.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now football-bets-dev
```

Prod is the same with the `main` branch, `/opt/football-bets`, and the
non-`-dev` unit.

## Update

```bash
/opt/football-bets-dev/deploy/update-dev.sh   # dev
/opt/football-bets/deploy/update.sh           # prod
```

## Data

SQLite at `<clone>/data/bets.db`, WAL mode. **Dev and prod keep separate
ledgers** — they are different files in different clones. The nightly
`backup.sh` picks up `/opt/*/data/*.db`, so both are covered.

Re-running a Kalshi sync is safe: rows are keyed on `(kalshi_ticker, side)` and
upserted, so positions update in place rather than duplicating. Notes you add to
an imported bet survive a resync.
