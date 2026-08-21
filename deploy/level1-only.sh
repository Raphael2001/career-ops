#!/usr/bin/env bash
# One-off: runs ONLY the per-company Level-1 (Playwright) headless scan step
# from discover-companies.sh, without the funding-feed/search-pass discovery
# or the final zero-token scan/commit. For manually triggering just this
# piece on demand (e.g. "run the no-ATS scan now") without re-running the
# whole weekly pipeline.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE=career-ops
LOG_PREFIX="[level1-only $(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$LOG_PREFIX starting"

cleanup_browser() {
  docker compose exec -T "$SERVICE" sh -c \
    'pkill -9 -f "playwright-mcp|chrome.*ms-playwright-mcp|claude --print" 2>/dev/null; true' \
    >/dev/null 2>&1 || true
}

company_count=0
# `< <(...)` (process substitution), NOT `... | while read`: a plain pipe
# put the loop in a subshell whose stdin was the company list -- and the
# claude-headless.sh call inside the loop body, having no stdin of its own
# specified, silently drained THAT SAME stream instead of the prompt it
# actually needed. First run processed exactly 1 company then exited clean
# (no error -- just silently out of input). `< /dev/null` on the exec call
# below is belt-and-suspenders: even with process substitution, a command
# with no explicit stdin still inherits fd 0 from its caller by default.
while IFS= read -r line; do
  name="$(echo "$line" | jq -r '.name')"
  url="$(echo "$line" | jq -r '.careers_url')"
  company_count=$((company_count + 1))
  echo "$LOG_PREFIX [$company_count] $name"
  result="$(timeout 600 docker compose exec -T -e CLAUDE_HEADLESS_MODEL=agent-model "$SERVICE" deploy/claude-headless.sh \
    "Company: $name. Careers page: $url. Use Playwright to visit that URL. Find open roles matching portals.yml's title_filter.positive keywords (Full Stack, Backend, Software Engineer, etc.), excluding title_filter.negative matches, in a location passing portals.yml's location_filter (Israel / Tel Aviv / Ramat Gan / Herzliya / Petah Tikva / remote). Also check whether the page's job listings are served via Comeet (look for network requests or an iframe/script src pointing at www.comeet.co/careers-api/2.0/company/.../positions -- often visible by viewing the page source or the embedded widget's src attribute). Output ONLY raw JSON, nothing else -- no commentary, no markdown fences: {\"jobs\":[{\"url\":\"...\",\"title\":\"...\",\"location\":\"...\"}],\"comeet_api_url\":\"...\"}. Omit comeet_api_url entirely if you don't find one. If no jobs match, still output the object with an empty jobs array." \
    2>/dev/null < /dev/null)" || result=""
  cleanup_browser
  if [ -z "$result" ]; then
    echo "$LOG_PREFIX   -> failed/timed out for $name"
  elif echo "$result" | jq -e '.jobs' >/dev/null 2>&1; then
    echo "$result" | jq --arg company "$name" '.jobs |= map(. + {company: $company})' \
      | docker compose exec -T "$SERVICE" node deploy/append-pipeline-entry.mjs < /dev/null
    comeet_url="$(echo "$result" | jq -r '.comeet_api_url // empty')"
    if [ -n "$comeet_url" ]; then
      echo "$LOG_PREFIX   -> found Comeet API for $name, upgrading portals.yml"
      echo "$result" | jq --arg company "$name" '{company: $company, comeet_api_url: .comeet_api_url}' \
        | docker compose exec -T "$SERVICE" node deploy/upgrade-to-comeet.mjs < /dev/null
    fi
  else
    echo "$LOG_PREFIX   -> non-JSON output for $name, skipping"
  fi
done < <(docker compose exec -T "$SERVICE" node deploy/list-websearch-companies.mjs < /dev/null)

echo "$LOG_PREFIX done ($company_count companies processed)"
