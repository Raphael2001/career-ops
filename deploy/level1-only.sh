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
  # < /dev/null matters here: this runs INSIDE the per-company while loop
  # below, and without it this exec call -- having no stdin of its own --
  # inherits the loop's stdin (the process-substituted company list) and
  # silently drains it, killing the loop after exactly 1 iteration. Verified
  # by isolating this function alone in a stub loop (no Playwright/claude
  # involved at all) and watching it die at company 1 too.
  docker compose exec -T "$SERVICE" sh -c \
    'pkill -9 -f "playwright-mcp|chrome.*ms-playwright-mcp|claude --print" 2>/dev/null; true' \
    >/dev/null 2>&1 < /dev/null || true
}

company_count=0
# `< <(...)` (process substitution), NOT `... | while read`: a plain pipe
# put the loop in a subshell whose stdin was the company list -- and the
# claude-headless.sh call inside the loop body, having no stdin of its own
# specified, silently drained THAT SAME stream instead of the prompt it
# actually needed. First run processed exactly 1 company then exited clean
# (no error -- just silently out of input). `< /dev/null` on THAT ONE exec
# call is belt-and-suspenders: even with process substitution, a command
# with no explicit stdin still inherits fd 0 from its caller by default.
#
# The append-pipeline-entry.mjs / upgrade-to-comeet.mjs calls below are
# different -- they're each fed by their own `echo ... | jq ... | docker
# compose exec ...` pipe, and stdin IS how they receive their JSON payload.
# A second run added `< /dev/null` there too "for consistency" and broke
# both silently (append-pipeline-entry errored "Unexpected end of JSON
# input" -- the redirect overrides the pipe, not falls back to it). Only
# add `< /dev/null` to a command that has no pipe already feeding it.
while IFS= read -r line; do
  name="$(echo "$line" | jq -r '.name')"
  url="$(echo "$line" | jq -r '.careers_url')"
  company_count=$((company_count + 1))
  echo "$LOG_PREFIX [$company_count] $name"
  # career-ops/top3 (see deploy/litellm/config.yaml): load-balanced across
  # nvidia/nemotron-3-ultra-550b-a55b, OpenRouter stealth/ox-alpha, and
  # Cloudflare glm-4.7-flash. See discover-companies.sh for the same call's
  # rationale/caveat -- glm-4.7-flash is unverified on this exact
  # tool-orchestration workload.
  result="$(timeout 600 docker compose exec -T -e CLAUDE_HEADLESS_MODEL=career-ops/top3 "$SERVICE" deploy/claude-headless.sh \
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

echo "$LOG_PREFIX done ($company_count companies processed)"
