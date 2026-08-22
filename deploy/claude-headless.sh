#!/usr/bin/env bash
# Runs `claude` headlessly against the LiteLLM proxy for automation with no
# human at the keyboard (cron, discover-companies.sh). The whole container
# already defaults every `claude` call to LiteLLM (see docker-compose.yml's
# career-ops service) -- what this wrapper actually adds is
# CLAUDE_HEADLESS_MODEL, letting a caller pick a different model per-call
# (e.g. nvidia/nemotron-3-ultra-550b-a55b for multi-step tool-use vs.
# nvidia/nemotron-3.5-lightning-30b-a3b for a quick single-shot call)
# without touching the container-wide default.
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
# Override with e.g. `CLAUDE_HEADLESS_MODEL=nvidia/nemotron-3-ultra-550b-a55b
# deploy/claude-headless.sh ...` for genuinely agentic, multi-step tool-use
# tasks -- see deploy/litellm/config.yaml for what's available and why
# you'd pick one over the other.
export ANTHROPIC_MODEL="${CLAUDE_HEADLESS_MODEL:-nvidia/nemotron-3.5-lightning-30b-a3b}"

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
