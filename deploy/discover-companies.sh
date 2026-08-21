#!/usr/bin/env bash
# Weekly company-discovery pipeline:
#   1. Surfaces recently-funded companies with an Israeli hub mention
#      (company-funded.mjs, global feed) + a narrow headless search pass
#      (Playwright hitting a search engine directly -- broader net than the
#      funding feed alone) -- resolves ATS via discover-ats.mjs, appends
#      verified entries to portals.yml.
#   2. Headless-scans the no-ATS ("websearch handoff") tier ONE COMPANY AT A
#      TIME -- a single multi-step 122-company plan proved unreliable on the
#      free-tier model (it hallucinated completion without visiting any
#      page); a narrow single-company task is what actually works.
#   3. Runs the normal zero-token scan.
#   4. Commits + pushes any portals.yml changes back to the fork, so newly
#      discovered companies aren't only sitting on this one machine's disk.
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
TMP_SEARCH="$(mktemp /tmp/career-ops-search-XXXX.yml)"
trap 'rm -f "$TMP_COMPANIES" "$TMP_SEARCH"' EXIT

# -- 1a. Funding-feed discovery (company-funded.mjs, global, geo-filtered) --
if docker compose exec -T "$SERVICE" node company-funded.mjs --json --months 2 --limit 60 \
    | docker compose exec -T "$SERVICE" node deploy/geo-filter.mjs portals.yml > "$TMP_COMPANIES"; then
  echo "$LOG_PREFIX resolving ATS for funding-feed candidates"
  docker compose cp "$TMP_COMPANIES" "$SERVICE:/tmp/discover-companies.yml"
  docker compose exec -T "$SERVICE" node discover-ats.mjs --in /tmp/discover-companies.yml --write
else
  echo "$LOG_PREFIX no new funding-feed candidates"
fi

# -- 1b. Narrow search-engine discovery (single Playwright call, single
#         extraction -- the "narrow task" shape that actually works headless,
#         unlike Claude Code's Anthropic-hosted WebSearch tool which Nemotron
#         via LiteLLM can't use at all). Broadens beyond whatever the funding
#         feed happened to carry this week.
echo "$LOG_PREFIX narrow search pass for new Israeli tech companies"
if timeout 120 docker compose exec -T "$SERVICE" deploy/claude-headless.sh \
    'Use the Playwright browser_navigate tool to open https://www.google.com/search?q=%22raised%22+%22million%22+Israeli+tech+startup+2026&num=20 and take one page snapshot. From the visible search results ONLY, extract distinct company names that are plausibly a real Israeli tech/software company (skip news outlets like TechCrunch/Calcalist/Globes, skip generic terms, skip anything you are not reasonably confident is an actual company). Output ONLY a YAML document in exactly this format, nothing else -- no commentary, no code fences, no explanation:
companies:
  - name: "Example Corp"
  - name: "Another Inc"
If you find none, output exactly: companies: []' > "$TMP_SEARCH" 2>/dev/null; then
  if grep -q '^\s*-\s*name:' "$TMP_SEARCH"; then
    echo "$LOG_PREFIX resolving ATS for search-pass candidates"
    docker compose cp "$TMP_SEARCH" "$SERVICE:/tmp/discover-search.yml"
    docker compose exec -T "$SERVICE" node discover-ats.mjs --in /tmp/discover-search.yml --write \
      || echo "$LOG_PREFIX discover-ats failed on search-pass candidates (non-fatal)"
  else
    echo "$LOG_PREFIX search pass found no new candidates"
  fi
else
  echo "$LOG_PREFIX search pass failed or timed out (non-fatal, continuing)"
fi

# -- 2. Per-company headless Level-1 (Playwright) scan of the no-ATS tier --
echo "$LOG_PREFIX headless Level-1 (Playwright) scan, one company per call"
company_count=0
docker compose exec -T "$SERVICE" node deploy/list-websearch-companies.mjs | while IFS= read -r line; do
  name="$(echo "$line" | jq -r '.name')"
  url="$(echo "$line" | jq -r '.careers_url')"
  company_count=$((company_count + 1))
  echo "$LOG_PREFIX [$company_count] $name"
  timeout 90 docker compose exec -T "$SERVICE" deploy/claude-headless.sh \
    "Company: $name. Careers page: $url. Use Playwright to visit that URL and look for open roles matching portals.yml's title_filter.positive keywords (Full Stack, Backend, Software Engineer, etc.), excluding title_filter.negative matches, in a location passing portals.yml's location_filter (Israel / Tel Aviv / Ramat Gan / Herzliya / Petah Tikva / remote). Check data/pipeline.md's existing entries for the exact row format scan.mjs uses, then Edit that file to append any matching, currently-live posting you find in that same format -- do not change anything else in the file. If nothing matches, do nothing and just confirm you checked." \
    2>/dev/null \
    || echo "$LOG_PREFIX   -> failed/timed out for $name, continuing"
done

# -- 3. Normal zero-token scan --
echo "$LOG_PREFIX running zero-token scan"
docker compose exec -T "$SERVICE" npm run --silent scan

# -- 4. Persist any portals.yml growth back to the fork --
if ! git diff --quiet -- portals.yml 2>/dev/null; then
  echo "$LOG_PREFIX portals.yml changed, committing"
  git add portals.yml
  git commit -q -m "chore(portals): weekly company discovery ($(date -u +%Y-%m-%d))"
  git push origin main && echo "$LOG_PREFIX pushed" || echo "$LOG_PREFIX push failed (non-fatal, portals.yml still updated locally)"
else
  echo "$LOG_PREFIX portals.yml unchanged, nothing to commit"
fi

echo "$LOG_PREFIX done"
