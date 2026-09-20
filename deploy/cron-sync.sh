#!/usr/bin/env bash
# Periodic sync driver. Called from cron; see deploy/README.md.
#
#   cron-sync.sh scores [port]   refresh the scoreboard and settle what's final
#   cron-sync.sh kalshi [port]   re-import positions and settlements
#
# Both endpoints are idempotent, so a missed or doubled run costs nothing.
set -uo pipefail

MODE="${1:-scores}"
PORT="${2:-4780}"
LOG="/opt/football-bets/data/cron.log"
[ -d "$(dirname "$LOG")" ] || LOG=/tmp/football-bets-cron.log

case "$MODE" in
  scores) PATH_="/api/grade";       TIMEOUT=60  ;;
  kalshi) PATH_="/api/sync/kalshi"; TIMEOUT=180 ;;
  *) echo "usage: $0 {scores|kalshi} [port]" >&2; exit 2 ;;
esac

AUTH=()
# Honour a token if the deployment sets one.
if [ -f "/opt/football-bets/.env" ]; then
  TOKEN="$(grep -E '^JARVIS_TOKEN=' /opt/football-bets/.env | cut -d= -f2-)"
  [ -n "${TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $TOKEN")
fi

RESP="$(curl -fsS -m "$TIMEOUT" -X POST "${AUTH[@]}" "http://localhost:${PORT}${PATH_}" 2>&1)"
STATUS=$?

printf '%s  %-6s %s\n' "$(date -Is)" "$MODE" \
  "$([ $STATUS -eq 0 ] && echo "$RESP" || echo "FAILED: $RESP")" >> "$LOG"

# Keep the log from growing without bound.
if [ "$(wc -l < "$LOG")" -gt 5000 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

exit $STATUS
