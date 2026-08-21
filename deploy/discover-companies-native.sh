#!/usr/bin/env bash
# Container-native version of discover-companies.sh -- for the cron job that
# runs INSIDE this container (see deploy/container-crontab, loaded by
# container-start.sh) instead of being triggered from the host via `docker
# compose exec`. Same steps, minus the git commit+push at the end: that's
# deploy/git-sync-portals.sh, a separate HOST-level cron job, so the SSH
# deploy key stays on the host and is never mounted into this container.
#
# Being native (no docker compose exec wrapping anywhere) also sidesteps an
# entire class of bugs discover-companies.sh had to work around: nested
# `docker compose exec` calls inside a `while read` loop competing for the
# outer loop's stdin. There's no "outer" here -- everything's a plain local
# process, so cleanup_browser is just a local pkill, and no `< /dev/null`
# juggling is needed anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."

# At the observed pace (~6min/company worst-case-inclusive), a full 122-company
# pass can run close to a day -- with cron now daily, a slow run and the next
# day's kickoff can genuinely overlap. flock (not just a pidfile) makes a
# second concurrent invocation exit immediately instead of running two
# browsers/loops against the same portals.yml at once.
LOCK_FILE="/tmp/discover-companies-native.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[discover-native $(date -u +%Y-%m-%dT%H:%M:%SZ)] already running (lock held), skipping this run"
  exit 0
fi

LOG_PREFIX="[discover-native $(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$LOG_PREFIX starting"

cleanup_browser() {
  pkill -9 -f "playwright-mcp|chrome.*ms-playwright-mcp|claude --print" 2>/dev/null || true
}

echo "$LOG_PREFIX pre-run cleanup (in case a previous run left orphans)"
cleanup_browser

TMP_COMPANIES="$(mktemp /tmp/career-ops-companies-XXXX.yml)"
TMP_SEARCH="$(mktemp /tmp/career-ops-search-XXXX.yml)"
trap 'rm -f "$TMP_COMPANIES" "$TMP_SEARCH"' EXIT

# -- 1a. Funding-feed discovery (company-funded.mjs, global, geo-filtered) --
if node company-funded.mjs --json --months 2 --limit 60 \
    | node deploy/geo-filter.mjs portals.yml > "$TMP_COMPANIES"; then
  echo "$LOG_PREFIX resolving ATS for funding-feed candidates"
  node discover-ats.mjs --in "$TMP_COMPANIES" --write
else
  echo "$LOG_PREFIX no new funding-feed candidates"
fi

# -- 1b. Narrow search-engine discovery (single Playwright call, single
#         extraction -- Claude Code's Anthropic-hosted WebSearch tool can't
#         work through LiteLLM/Nemotron, so this is the substitute) --
echo "$LOG_PREFIX narrow search pass for new Israeli tech companies"
if timeout 120 deploy/claude-headless.sh \
    'Use the Playwright browser_navigate tool to open https://www.google.com/search?q=%22raised%22+%22million%22+Israeli+tech+startup+2026&num=20 and take one page snapshot. From the visible search results ONLY, extract distinct company names that are plausibly a real Israeli tech/software company (skip news outlets like TechCrunch/Calcalist/Globes, skip generic terms, skip anything you are not reasonably confident is an actual company). Output ONLY a YAML document in exactly this format, nothing else -- no commentary, no code fences, no explanation:
companies:
  - name: "Example Corp"
  - name: "Another Inc"
If you find none, output exactly: companies: []' > "$TMP_SEARCH" 2>/dev/null; then
  cleanup_browser
  if grep -q '^\s*-\s*name:' "$TMP_SEARCH"; then
    echo "$LOG_PREFIX resolving ATS for search-pass candidates"
    node discover-ats.mjs --in "$TMP_SEARCH" --write \
      || echo "$LOG_PREFIX discover-ats failed on search-pass candidates (non-fatal)"
  else
    echo "$LOG_PREFIX search pass found no new candidates"
  fi
else
  echo "$LOG_PREFIX search pass failed or timed out (non-fatal, continuing)"
  cleanup_browser
fi

# -- 2. Per-company headless Level-1 (Playwright) scan of the no-ATS tier --
echo "$LOG_PREFIX headless Level-1 (Playwright) scan, one company per call"
company_count=0
while IFS= read -r line; do
  name="$(echo "$line" | jq -r '.name')"
  url="$(echo "$line" | jq -r '.careers_url')"
  company_count=$((company_count + 1))
  echo "$LOG_PREFIX [$company_count] $name"
  result="$(CLAUDE_HEADLESS_MODEL=agent-model timeout 600 deploy/claude-headless.sh \
    "Company: $name. Careers page: $url. Use Playwright to visit that URL. Find open roles matching portals.yml's title_filter.positive keywords (Full Stack, Backend, Software Engineer, etc.), excluding title_filter.negative matches, in a location passing portals.yml's location_filter (Israel / Tel Aviv / Ramat Gan / Herzliya / Petah Tikva / remote). Also check whether the page's job listings are served via Comeet (look for network requests or an iframe/script src pointing at www.comeet.co/careers-api/2.0/company/.../positions -- often visible by viewing the page source or the embedded widget's src attribute). Output ONLY raw JSON, nothing else -- no commentary, no markdown fences: {\"jobs\":[{\"url\":\"...\",\"title\":\"...\",\"location\":\"...\"}],\"comeet_api_url\":\"...\"}. Omit comeet_api_url entirely if you don't find one. If no jobs match, still output the object with an empty jobs array." \
    2>/dev/null)" || result=""
  cleanup_browser
  if [ -z "$result" ]; then
    echo "$LOG_PREFIX   -> failed/timed out for $name"
  elif echo "$result" | jq -e '.jobs' >/dev/null 2>&1; then
    echo "$result" | jq --arg company "$name" '.jobs |= map(. + {company: $company})' \
      | node deploy/append-pipeline-entry.mjs
    comeet_url="$(echo "$result" | jq -r '.comeet_api_url // empty')"
    if [ -n "$comeet_url" ]; then
      echo "$LOG_PREFIX   -> found Comeet API for $name, upgrading portals.yml"
      echo "$result" | jq --arg company "$name" '{company: $company, comeet_api_url: .comeet_api_url}' \
        | node deploy/upgrade-to-comeet.mjs
    fi
  else
    echo "$LOG_PREFIX   -> non-JSON output for $name, skipping"
  fi
done < <(node deploy/list-websearch-companies.mjs)

# -- 3. Normal zero-token scan --
echo "$LOG_PREFIX running zero-token scan"
npm run --silent scan

echo "$LOG_PREFIX done ($company_count companies processed)"
