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
# Weekly discovery cron, loaded from the repo (part of the Docker config
# itself -- no separate host-side `crontab deploy/crontab` step needed for
# this half). See deploy/container-crontab and deploy/discover-companies-native.sh.
#
# cron jobs do NOT inherit the environment of the process that installed the
# crontab -- they run with a minimal one cron constructs itself (roughly just
# PATH/HOME/SHELL/LOGNAME). discover-companies-native.sh needs
# LITELLM_MASTER_KEY (via claude-headless.sh) and a real PATH (node/npm/claude
# aren't on cron's default minimal one), so those get written as VAR=value
# lines into root's actual crontab spool (an ephemeral, container-local file,
# never the git-tracked deploy/container-crontab) ahead of the job entries.
{
  echo "PATH=$PATH"
  echo "LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY:-}"
  cat deploy/container-crontab
} | crontab -
cron

exec tail -f /dev/null
