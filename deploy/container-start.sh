#!/usr/bin/env bash
# Container entrypoint: builds and starts the web UI in the background, then
# keeps the container alive with a long-running shell so `./cops exec ...`
# stays instant for CLI-only commands (scan, doctor, discover-ats, ...).
set -euo pipefail

cd /app/web
if [ ! -x node_modules/.bin/next ]; then
  npm ci --no-audit --no-fund
fi
# `next build`'s static prerender of /_global-error crashes in this container's
# environment (works fine on macOS) with a null useContext error inside React
# -- unrelated to career-ops itself. Dev mode (Turbopack) sidesteps that
# prerender step entirely and is what upstream's own README uses to run this,
# so it's a fine way to serve this alpha-status app persistently on the LAN.
npm run dev -- -p 3000 -H 0.0.0.0 &

cd /app
exec tail -f /dev/null
