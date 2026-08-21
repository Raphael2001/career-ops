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
# --dangerously-skip-permissions refuses to run as root, and this container
# runs as root by default (see DOCKER.md) -- so no human-approval flag here
# either way. Scope with --allowedTools instead: no permission prompts to
# block on, but also nothing outside this explicit list.
#
# Prompt goes via stdin, not as a trailing arg: --allowedTools is variadic
# (space-separated, no fixed arity) and swallows any positional arg placed
# after it, leaving `claude --print` with no prompt at all.
printf '%s' "$PROMPT" | exec claude --print \
  --mcp-config deploy/mcp-config.json \
  --allowedTools "Bash Read Write Edit Grep Glob mcp__playwright__*" \
  "$@"
