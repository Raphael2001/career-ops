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

cleanup_browser() {
  # A `timeout`-killed claude-headless.sh call only kills the direct child;
  # the node/npx/playwright-mcp/chrome tree it spawned can orphan and hang
  # around holding CPU (and, without --isolated, a shared profile lock that
  # blocks the NEXT call from starting). Best-effort sweep, safe to run even
  # when nothing needs cleaning.
  #
  # < /dev/null matters here too (see the per-company loop below): this gets
  # called INSIDE that while loop, and without it, this exec call -- having
  # no stdin of its own -- silently drains the loop's process-substituted
  # company-list stdin, killing the loop after exactly 1 iteration.
  docker compose exec -T "$SERVICE" sh -c \
    'pkill -9 -f "playwright-mcp|chrome.*ms-playwright-mcp|claude --print" 2>/dev/null; true' \
    >/dev/null 2>&1 < /dev/null || true
}

echo "$LOG_PREFIX pre-run cleanup (in case a previous run left orphans)"
cleanup_browser

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
  cleanup_browser
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
  cleanup_browser
fi

# -- 2. Per-company headless Level-1 (Playwright) scan of the no-ATS tier --
echo "$LOG_PREFIX headless Level-1 (Playwright) scan, one company per call"
company_count=0
# `< <(...)` (process substitution), NOT `... | while read`: a plain pipe
# puts the loop in a subshell whose stdin IS the company list -- and the
# claude-headless.sh call inside the loop body, having no stdin of its own
# specified, silently drains THAT SAME stream instead of the prompt it
# actually needs, so the loop dies after exactly 1 iteration with no error.
# `< /dev/null` on the claude-headless.sh call below is belt-and-suspenders
# (a command with no explicit stdin still inherits fd 0 from its caller even
# under process substitution) -- but NOT on append-pipeline-entry.mjs /
# upgrade-to-comeet.mjs further down, which are each fed by their own
# `echo ... | jq ... | docker compose exec ...` pipe: `< /dev/null` there
# overrides that pipe instead of falling back to it, and silently breaks
# both ("Unexpected end of JSON input" -- found the hard way).
while IFS= read -r line; do
  name="$(echo "$line" | jq -r '.name')"
  url="$(echo "$line" | jq -r '.careers_url')"
  company_count=$((company_count + 1))
  echo "$LOG_PREFIX [$company_count] $name"
  # Model's ONLY job is to look and judge match/no-match, as plain JSON --
  # NOT to figure out pipeline.md's format or safely edit it itself. That
  # split (perception via the model, deterministic write via a script) is
  # what made this reliable -- asking the model to also read the file
  # format and Edit it consistently pushed the task past what it could
  # finish in any reasonable timeout.
  #
  # agent-model, not nemotron-lightning: this step needs genuine multi-step
  # tool orchestration (navigate, find listings, filter, extract).
  #
  # 600s, not something tighter: verified working end-to-end (real jobs,
  # correctly formatted JSON) at 4m19s -- the variable isn't task complexity,
  # it's NVIDIA NIM's free tier occasionally returning "Service temporarily
  # overloaded" mid-stream, which litellm retries through but which eats
  # unpredictable extra time. 600s leaves real headroom above the ~260s a
  # clean run takes.
  result="$(timeout 600 docker compose exec -T -e CLAUDE_HEADLESS_MODEL=agent-model "$SERVICE" deploy/claude-headless.sh \
    "Company: $name. Careers page: $url. Use Playwright to visit that URL. Find open roles matching portals.yml's title_filter.positive keywords (Full Stack, Backend, Software Engineer, etc.), excluding title_filter.negative matches, in a location passing portals.yml's location_filter (Israel / Tel Aviv / Ramat Gan / Herzliya / Petah Tikva / remote). Also check whether the page's job listings are served via Comeet (look for network requests or an iframe/script src pointing at www.comeet.co/careers-api/2.0/company/.../positions -- often visible by viewing the page source or the embedded widget's src attribute). Output ONLY raw JSON, nothing else -- no commentary, no markdown fences: {\"jobs\":[{\"url\":\"...\",\"title\":\"...\",\"location\":\"...\"}],\"comeet_api_url\":\"...\"}. Omit comeet_api_url entirely if you don't find one. If no jobs match, still output the object with an empty jobs array." \
    2>/dev/null < /dev/null)" || result=""
  cleanup_browser
  if [ -z "$result" ]; then
    echo "$LOG_PREFIX   -> failed/timed out for $name"
  elif echo "$result" | jq -e '.jobs' >/dev/null 2>&1; then
    echo "$result" | jq --arg company "$name" '.jobs |= map(. + {company: $company})' \
      | docker compose exec -T "$SERVICE" node deploy/append-pipeline-entry.mjs
    comeet_url="$(echo "$result" | jq -r '.comeet_api_url // empty')"
    if [ -n "$comeet_url" ]; then
      echo "$LOG_PREFIX   -> found Comeet API for $name, upgrading portals.yml"
      echo "$result" | jq --arg company "$name" '{company: $company, comeet_api_url: .comeet_api_url}' \
        | docker compose exec -T "$SERVICE" node deploy/upgrade-to-comeet.mjs
    fi
  else
    echo "$LOG_PREFIX   -> non-JSON output for $name, skipping"
  fi
done < <(docker compose exec -T "$SERVICE" node deploy/list-websearch-companies.mjs < /dev/null)

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
