#!/usr/bin/env bash
# Weekly company-discovery pipeline: surfaces recently-funded companies with an
# Israeli hub mention, resolves their ATS via discover-ats.mjs, appends
# verified entries to portals.yml, headless-scans the no-ATS ("websearch
# handoff") tier for Playwright-reachable postings, then runs a fresh
# zero-token scan.
#
# Runs on the host (not inside the container) so it can shell out to `docker
# compose exec` for each step. Intended to be invoked from cron -- see
# deploy/crontab.
#
# Uses `docker compose exec -T` directly rather than `./cops`: cops always
# passes `-it`, which needs a TTY that cron doesn't have.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE=career-ops
LOG_PREFIX="[discover-companies $(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$LOG_PREFIX starting"

TMP_COMPANIES="$(mktemp /tmp/career-ops-companies-XXXX.yml)"
trap 'rm -f "$TMP_COMPANIES"' EXIT

if docker compose exec -T "$SERVICE" node company-funded.mjs --json --months 2 --limit 60 \
    | docker compose exec -T "$SERVICE" node deploy/geo-filter.mjs portals.yml > "$TMP_COMPANIES"; then
  echo "$LOG_PREFIX resolving ATS for new candidates"
  docker compose cp "$TMP_COMPANIES" "$SERVICE:/tmp/discover-companies.yml"
  docker compose exec -T "$SERVICE" node discover-ats.mjs --in /tmp/discover-companies.yml --write
else
  echo "$LOG_PREFIX no new candidates, skipping discover-ats"
fi

echo "$LOG_PREFIX headless Level-1 (Playwright) scan of no-ATS companies"
docker compose exec -T "$SERVICE" deploy/claude-headless.sh \
  "/career-ops scan — Level 1 (Playwright) ONLY. Scope to companies in portals.yml's tracked_companies that have no api/local_parser match (the ones scan.mjs reports under 'Agent/WebSearch handoff'). For each, visit careers_url directly with Playwright and extract matching postings per title_filter/location_filter. Do NOT attempt Level 3 (WebSearch) — the model behind this session doesn't support it. Append confirmed results the same way scan.mjs does (data/pipeline.md, data/scan-history.tsv)." \
  || echo "$LOG_PREFIX headless Level-1 scan failed (non-fatal, continuing)"

echo "$LOG_PREFIX running zero-token scan"
docker compose exec -T "$SERVICE" npm run --silent scan

echo "$LOG_PREFIX done"
