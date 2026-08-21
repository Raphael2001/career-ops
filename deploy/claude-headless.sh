#!/usr/bin/env bash
# Runs `claude` headlessly against the LiteLLM proxy (NVIDIA NIM's free-tier
# Nemotron) instead of a real Anthropic login -- for automation with no human
# at the keyboard (cron, discover-companies.sh). Mirrors the LiteLLM toggle
# pattern from ~/.zshrc, just non-interactive.
#
# Does NOT affect a normal interactive `claude` session elsewhere in this
# container -- these env vars are scoped to this script's subshell only.
#
# Usage: deploy/claude-headless.sh "<prompt>" [extra claude flags...]
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${LITELLM_MASTER_KEY:-}" ]; then
  echo "claude-headless.sh: LITELLM_MASTER_KEY not set (add it to .env)" >&2
  exit 1
fi

PROMPT="${1:?usage: claude-headless.sh \"<prompt>\" [extra claude flags...]}"
shift

export ANTHROPIC_BASE_URL="http://litellm:4000"
export ANTHROPIC_API_KEY="$LITELLM_MASTER_KEY"
export ANTHROPIC_MODEL="nemotron-lightning"

# --print: non-interactive, skips the workspace-trust dialog for --mcp-config.
# --dangerously-skip-permissions: no human here to approve tool calls; this
# container is the sandbox boundary (isolated, project-directory-scoped).
exec claude --print \
  --mcp-config deploy/mcp-config.json \
  --dangerously-skip-permissions \
  "$@" \
  "$PROMPT"
