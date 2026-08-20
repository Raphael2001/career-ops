#!/usr/bin/env bash
# Container entrypoint: builds and starts the web UI in the background, then
# keeps the container alive with a long-running shell so `./cops exec ...`
# stays instant for CLI-only commands (scan, doctor, discover-ats, ...).
set -euo pipefail

cd /app/web
if [ ! -x node_modules/.bin/next ]; then
  npm ci --no-audit --no-fund
fi
npm run build
npm run start -- -p 3000 &

cd /app
exec tail -f /dev/null
