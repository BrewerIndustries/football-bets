#!/usr/bin/env bash
# Redeploy the DEV clone from dev.
set -euo pipefail
cd /opt/football-bets-dev
git checkout -- package-lock.json 2>/dev/null || true
git pull --ff-only
npm install
npm run build
sudo systemctl restart football-bets-dev
echo "dev redeployed -> http://100.102.159.57:4790"
