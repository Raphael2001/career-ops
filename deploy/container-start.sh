#!/usr/bin/env bash
# Container entrypoint: builds and starts the web UI in the background, then
# keeps the container alive with a long-running shell so `./cops exec ...`
# stays instant for CLI-only commands (scan, doctor, discover-ats, ...).
set -euo pipefail

cd /app/web
if [ ! -x node_modules/.bin/next ]; then
  npm ci --no-audit --no-fund
fi
# The main service's NODE_ENV=development (docker-compose.yml, meant for the
# CLI/scan tooling) leaking into `next build` corrupts React's dev/prod bundle
# selection during static prerender of internal boundary pages (/_global-error,
# /_not-found) -- crashes with a null useContext error. `next start` needs
# production too. Override just for this subshell; the CLI shell below (and
# `./cops exec`) keeps the compose-level NODE_ENV untouched.
NODE_ENV=production npm run build
NODE_ENV=production npm run start -- -p 3000 -H 0.0.0.0 &

cd /app
exec tail -f /dev/null
