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

# -- 1c. Re-probe existing no-ATS companies against slug-guessable vendors --
#         (Workable/Recruitee/BambooHR/Breezy/Pinpoint/Rippling/Join) --
#         zero-token, HTTP only, no Playwright/LLM. Runs BEFORE the expensive
#         Level-1 loop below so anything it upgrades today skips that pass
#         today too, not just from tomorrow onward.
echo "$LOG_PREFIX re-probing websearch-tier companies for slug-guessable ATS vendors"
node deploy/upgrade-websearch-tier.mjs \
  || echo "$LOG_PREFIX upgrade-websearch-tier failed (non-fatal, continuing)"

# -- 2. Per-company headless Level-1 (Playwright) scan of the no-ATS tier --
echo "$LOG_PREFIX headless Level-1 (Playwright) scan, one company per call"

# Read once, not per company: the prompt below used to just SAY "portals.yml's
# title_filter.negative" without ever showing the agent what that list
# actually contains -- trusting a single-shot headless call on a slow/free
# model to independently go read and correctly apply a list it was never
# shown. Confirmed live: Staff/Principal/Lead-titled roles kept landing in
# data/pipeline.md despite Staff/Principal/Lead all being configured negative
# keywords. Interpolating the real lists removes the guesswork entirely.
POSITIVE_KEYWORDS="$(node -e '
  const yaml = require("js-yaml");
  const fs = require("fs");
  const cfg = yaml.load(fs.readFileSync("portals.yml", "utf8"));
  console.log((cfg?.title_filter?.positive || []).join(", "));
')"
NEGATIVE_KEYWORDS="$(node -e '
  const yaml = require("js-yaml");
  const fs = require("fs");
  const cfg = yaml.load(fs.readFileSync("portals.yml", "utf8"));
  console.log((cfg?.title_filter?.negative || []).join(", "));
')"
LOCATION_ALLOW="$(node -e '
  const yaml = require("js-yaml");
  const fs = require("fs");
  const cfg = yaml.load(fs.readFileSync("portals.yml", "utf8"));
  const lf = cfg?.location_filter || {};
  console.log([...(lf.always_allow || []), ...(lf.allow || [])].join(", "));
')"
company_count=0
while IFS= read -r line; do
  # `|| true` / explicit fallbacks on every step below: this loop has died
  # silently mid-run more than once in practice (no error text logged, just
  # stops) -- almost certainly some step in here failing unprotected under
  # `set -e` + `pipefail` (a jq transform choking on an unexpected shape,
  # e.g.), which kills the WHOLE script instead of just that one company.
  # One company's weird output must never be able to take down the other
  # ~100 companies' worth of progress, so every risky command in this body
  # now degrades to "skip this company, log it, keep going" instead.
  name="$(echo "$line" | jq -r '.name' 2>/dev/null)" || name=""
  url="$(echo "$line" | jq -r '.careers_url' 2>/dev/null)" || url=""
  company_count=$((company_count + 1))
  if [ -z "$name" ] || [ -z "$url" ]; then
    echo "$LOG_PREFIX [$company_count] (unparseable line, skipping): $line"
    continue
  fi
  echo "$LOG_PREFIX [$company_count] $name"
  # NOT `result="$(timeout 600 deploy/claude-headless.sh ... )"`: `timeout`
  # only signals its DIRECT child. claude-headless.sh execs into `claude`
  # (same PID, fine), but `claude` itself forks real children of its own
  # (npx/playwright-mcp/chrome) that timeout never touches. If those survive
  # past the 600s cutoff, they keep this command's stdout pipe open, and
  # `$(...)` blocks forever waiting for EOF that never comes -- confirmed
  # live: a run hung for 45+ minutes past its 600s budget with the script
  # process sitting in `anon_pipe_read`, looking dead but never actually
  # exiting or erroring.
  #
  # Fix: run it in its own process group (setsid) so the WHOLE tree can be
  # killed together, redirect to a file instead of capturing via a pipe (a
  # file doesn't have the same "wait for EOF" blocking behavior), and sweep
  # the group after `wait` returns regardless of how it exited.
  OUT_FILE="$(mktemp /tmp/career-ops-result-XXXX.json)"
  # career-ops/top3 (see deploy/litellm/config.yaml): load-balanced across
  # nvidia/nemotron-3-ultra-550b-a55b, OpenRouter stealth/ox-alpha, and
  # Cloudflare glm-4.7-flash. See discover-companies.sh for the same call's
  # rationale/caveat -- glm-4.7-flash is unverified on this exact
  # tool-orchestration workload.
  setsid env CLAUDE_HEADLESS_MODEL=career-ops/top3 timeout -k 15 600 deploy/claude-headless.sh \
    "Company: $name. Careers page: $url. Use Playwright to visit that URL. Find open roles whose title contains at least one of these keywords: $POSITIVE_KEYWORDS. REJECT any role whose title contains any of these words, even if it also matches a keyword above: $NEGATIVE_KEYWORDS. Only include a role if its location plausibly matches one of: $LOCATION_ALLOW. Do NOT include a role whose location is a different country, or whose title/description says Remote/Anywhere without also naming one of those places. Also check whether the page's job listings are served via Comeet (look for network requests or an iframe/script src pointing at www.comeet.co/careers-api/2.0/company/.../positions -- often visible by viewing the page source or the embedded widget's src attribute). Output ONLY raw JSON, nothing else -- no commentary, no markdown fences: {\"jobs\":[{\"url\":\"...\",\"title\":\"...\",\"location\":\"...\"}],\"comeet_api_url\":\"...\"}. Omit comeet_api_url entirely if you don't find one. If no jobs match, still output the object with an empty jobs array." \
    > "$OUT_FILE" 2>/dev/null &
  child_pid=$!
  wait "$child_pid" || true
  pkill -9 -g "$child_pid" 2>/dev/null || true
  result="$(cat "$OUT_FILE" 2>/dev/null)" || result=""
  rm -f "$OUT_FILE"
  cleanup_browser
  if [ -z "$result" ]; then
    echo "$LOG_PREFIX   -> failed/timed out for $name"
  elif echo "$result" | jq -e '.jobs' >/dev/null 2>&1; then
    echo "$result" | jq --arg company "$name" '.jobs |= map(. + {company: $company})' 2>/dev/null \
      | node deploy/append-pipeline-entry.mjs \
      || echo "$LOG_PREFIX   -> append-pipeline-entry failed for $name, continuing"
    comeet_url="$(echo "$result" | jq -r '.comeet_api_url // empty' 2>/dev/null)" || comeet_url=""
    if [ -n "$comeet_url" ]; then
      echo "$LOG_PREFIX   -> found Comeet API for $name, upgrading portals.yml"
      echo "$result" | jq --arg company "$name" '{company: $company, comeet_api_url: .comeet_api_url}' 2>/dev/null \
        | node deploy/upgrade-to-comeet.mjs \
        || echo "$LOG_PREFIX   -> upgrade-to-comeet failed for $name, continuing"
    fi
  else
    echo "$LOG_PREFIX   -> non-JSON output for $name, skipping"
  fi
done < <(node deploy/list-websearch-companies.mjs)

# -- 3. Normal zero-token scan --
echo "$LOG_PREFIX running zero-token scan"
npm run --silent scan

echo "$LOG_PREFIX done ($company_count companies processed)"
