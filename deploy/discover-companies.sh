#!/usr/bin/env bash
# Weekly company-discovery pipeline: surfaces recently-funded companies with an
# Israeli hub mention, resolves their ATS via discover-ats.mjs, appends
# verified entries to portals.yml, then runs a fresh scan.
#
# Runs on the host (not inside the container) so it can shell out to `./cops`
# for each step. Intended to be invoked from cron â€” see deploy/crontab.
set -euo pipefail
cd "$(dirname "$0")/.."

LOG_PREFIX="[discover-companies $(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$LOG_PREFIX starting"

TMP_COMPANIES="$(mktemp /tmp/career-ops-companies-XXXX.yml)"
trap 'rm -f "$TMP_COMPANIES"' EXIT

if ./cops node company-funded.mjs --json --months 2 --limit 60 \
    | ./cops node deploy/geo-filter.mjs portals.yml > "$TMP_COMPANIES"; then
  echo "$LOG_PREFIX resolving ATS for new candidates"
  ./cops node discover-ats.mjs --in "$TMP_COMPANIES" --write
else
  echo "$LOG_PREFIX no new candidates, skipping discover-ats"
fi

echo "$LOG_PREFIX running scan"
./cops scan

echo "$LOG_PREFIX done"
