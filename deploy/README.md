# Deploy — Football Bets

**Private by design.** `sportsbook.dabrewer.dev` is a DNS-only `A` record pointing
at the box's **Tailscale** address (`100.102.159.57`). That address is not
routable from the public internet, so the hostname resolves for anyone but only
*connects* for devices on the tailnet. Nothing here is internet-facing.

| env | branch | clone | port | URL |
|---|---|---|---|---|
| prod | `main` | `/opt/football-bets` | 4780 | https://sportsbook.dabrewer.dev |
| dev | `dev` | `/opt/football-bets-dev` | 4790 | http://100.102.159.57:4790 |

TLS on the prod hostname comes from the existing wildcard cert
(`/etc/letsencrypt/live/dabrewer.dev`), which already covers `*.dabrewer.dev` —
no new certificate was issued.

## Secrets

The Kalshi credential is **not** in this repo. It lives in the shared secrets
directory and each clone's `.env` points at it:

```
/home/dan/.config/jarvis/kalshi.env             # KALSHI_API_KEY_ID
/home/dan/.config/jarvis/kalshi-private-key.pem # RSA private key, mode 600
```

`.env` in each clone is generated at install time and is gitignored.

The key is a **trading** credential. This app only calls read endpoints, but the
key itself can place orders — rotate it at kalshi.com if it ever leaks.

## First install

```bash
sudo mkdir -p /opt/football-bets && sudo chown dan:dan /opt/football-bets
git clone -b main git@github-football-bets:BrewerIndustries/football-bets.git /opt/football-bets
cd /opt/football-bets
cat ~/.config/jarvis/kalshi.env > .env && chmod 600 .env   # prod: no JARVIS_ENV
npm install && npm run build
sudo cp deploy/football-bets.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now football-bets
```

Dev is the same with the `dev` branch, `/opt/football-bets-dev`, the `-dev` unit,
and `JARVIS_ENV=dev` in `.env` (which turns on the amber banner).

## nginx

Prod is proxied by the `dabrewer.dev` site file; dev is reached on its raw port
and has no nginx block.

```nginx
server {
    listen 443 ssl;
    server_name sportsbook.dabrewer.dev;
    ssl_certificate     /etc/letsencrypt/live/dabrewer.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dabrewer.dev/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:4780;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Scheduled syncs (prod only)

`deploy/cron-sync.sh` drives both endpoints. Installed in `dan`'s crontab:

```cron
*/2  * * * * /opt/football-bets/deploy/cron-sync.sh scores 4780
*/15 * * * * /opt/football-bets/deploy/cron-sync.sh kalshi 4780
```

- **scores, every 2 min** — refreshes the scoreboard and settles anything now
  final. One small ESPN request; this is what makes in-progress scores feel live.
- **kalshi, every 15 min** — re-imports positions and settlements.

Both endpoints are idempotent, so a missed or doubled run costs nothing. Output
lands in `/opt/football-bets/data/cron.log` (self-trimming).

Dev is left un-croned on purpose: it is for development, and a second Kalshi
poller buys nothing.

## Update

```bash
/opt/football-bets/deploy/update.sh           # prod, from main
/opt/football-bets-dev/deploy/update-dev.sh   # dev, from dev
```

## Data

SQLite at `<clone>/data/bets.db`, WAL mode. **Dev and prod keep separate
ledgers** — different files in different clones. The nightly `backup.sh` picks up
`/opt/*/data/*.db`, so both are covered.

Re-running a Kalshi sync is safe: rows are keyed on `(kalshi_ticker, side)` and
upserted. Notes added to an imported bet survive a resync.
