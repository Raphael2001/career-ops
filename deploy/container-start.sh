#!/usr/bin/env bash
# Container entrypoint: builds and starts the web UI in the background, then
# keeps the container alive with a long-running shell so `./cops exec ...`
# stays instant for CLI-only commands (scan, doctor, discover-ats, ...).
set -euo pipefail

# The container runs as pwuser (uid 1000, matches the host's `claw` user) by
# default now (Dockerfile `USER pwuser`) -- both this entrypoint and any
# `docker compose exec`/`./cops exec` get it automatically. Before this, the
# whole container ran as root and every file the app touched on the
# bind-mounted repo (output/, data/, portals.yml, ...) came out root-owned on
# the host, blocking the host user from writing those same paths outside
# Docker.
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
# `crontab -` needs no privilege at all -- any user manages their own
# crontab. Starting the daemon (`cron` below) is the one step that genuinely
# needs root (binding /var/run/crond.pid, reading every user's crontab), so
# that alone goes through the narrowly-scoped NOPASSWD sudo rule set up in
# the Dockerfile. The daemon then runs pwuser's jobs as pwuser, so
# discover-companies-native.sh's writes to data/ stay host-writable too.
#
# cron jobs do NOT inherit the environment of the process that installed the
# crontab -- they run with a minimal one cron constructs itself (roughly just
# PATH/HOME/SHELL/LOGNAME). discover-companies-native.sh needs
# LITELLM_MASTER_KEY (via claude-headless.sh) and a real PATH (node/npm/claude
# aren't on cron's default minimal one), so those get written as VAR=value
# lines into pwuser's actual crontab spool (an ephemeral, container-local
# file, never the git-tracked deploy/container-crontab) ahead of the job
# entries.
{
  echo "PATH=$PATH"
  echo "LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY:-}"
  cat deploy/container-crontab
} | crontab -
sudo /usr/sbin/cron

exec tail -f /dev/null
