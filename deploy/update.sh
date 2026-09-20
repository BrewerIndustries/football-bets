#!/usr/bin/env bash
# Redeploy the PROD clone from main.
set -euo pipefail
cd /opt/football-bets
# The box's npm install rewrites package-lock.json differently from the macOS
# one, which makes the next ff-pull abort. Discard it before pulling.
git checkout -- package-lock.json 2>/dev/null || true
git pull --ff-only
npm install
npm run build
sudo systemctl restart football-bets
echo "prod redeployed -> http://100.102.159.57:4780"
