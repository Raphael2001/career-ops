#!/usr/bin/env bash
# HOST-level companion to deploy/container-crontab's in-container discovery
# job. The scan/discovery itself runs entirely inside the container (needs
# no credentials -- just writes to bind-mounted files); this script is the
# other half, run on a separate HOST cron schedule, and does the one thing
# that genuinely needs the host's SSH deploy key: commit + push portals.yml
# if the container-side job grew it.
#
# Deliberately tiny and fast (no scanning, no Playwright, no LLM calls) so
# it's safe to run more often than the discovery job itself -- e.g. daily,
# to pick up whatever the weekly container run produced without a long wait.
set -euo pipefail
cd "$(dirname "$0")/.."

LOG_PREFIX="[git-sync-portals $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

if ! git diff --quiet -- portals.yml 2>/dev/null; then
  echo "$LOG_PREFIX portals.yml changed, committing"
  git add portals.yml
  git commit -q -m "chore(portals): weekly company discovery ($(date -u +%Y-%m-%d))"
  git push origin main && echo "$LOG_PREFIX pushed" || echo "$LOG_PREFIX push failed (non-fatal, portals.yml still updated locally)"
else
  echo "$LOG_PREFIX portals.yml unchanged, nothing to commit"
fi
