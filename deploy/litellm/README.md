# LiteLLM proxy: Claude Code on NVIDIA NIM's free tier

Fronts NVIDIA NIM's `nvidia/nemotron-3.5-lightning-30b-a3b` (free tier, 30B
total / 3B active MoE, 1M context) behind an Anthropic-compatible
`/v1/messages` endpoint, so `claude` (Claude Code CLI) can run **headless** --
cron jobs, CI deploy steps, `discover-companies.sh` -- without an interactive
login or burning Anthropic credits.

This does **not** replace your normal interactive `claude` session (still
uses your real subscription/login). It's only for automation that has no
human at the keyboard to log in.

## Setup

1. Get a free NVIDIA NIM API key: <https://build.nvidia.com> (sign up, then
   any model's "Get API Key" button gives you one key that works across all
   NIM models, including Nemotron).
2. On the host, add to `.env` (never commit this file):
   ```bash
   NVIDIA_API_KEY=nvapi-...
   LITELLM_MASTER_KEY=$(openssl rand -hex 32)
   ```
3. Bring the proxy up alongside the main container:
   ```bash
   docker compose up -d litellm
   ```
4. Confirm it's answering:
   ```bash
   curl -s http://localhost:4001/v1/models \
     -H "Authorization: Bearer $LITELLM_MASTER_KEY"
   ```

## Pointing Claude Code at it

Inside the `career-ops` container (or any shell on the same Docker network),
set these three env vars before running `claude`:

```bash
export ANTHROPIC_BASE_URL=http://litellm:4000   # service name, not localhost
export ANTHROPIC_API_KEY="$LITELLM_MASTER_KEY"
export ANTHROPIC_MODEL=nemotron-lightning
claude -p "your headless prompt here"
```

From the host (outside Docker), swap the base URL for the mapped port:

```bash
export ANTHROPIC_BASE_URL=http://localhost:4001
```

## Notes

- `deploy/litellm/config.yaml` maps the alias `nemotron-lightning` ->
  `nvidia_nim/nvidia/nemotron-3.5-lightning-30b-a3b`. Add more `model_list`
  entries there for other NIM models (DeepSeek V3.2, Qwen3 Coder, Kimi K2,
  etc.) -- same `api_base`, same `NVIDIA_API_KEY`.
- Nemotron-Lightning is a fast, cheap MoE (3B active params) -- good for the
  structured-extraction work this repo's automation actually does (CV
  parsing, company-name filtering, JD summarization). It is not a substitute
  for Claude on genuinely hard agentic/coding tasks; use your real
  subscription for those.
- `LITELLM_MASTER_KEY` is not an NVIDIA or Anthropic secret -- it's a bearer
  token litellm itself requires from callers. Any random string works.
