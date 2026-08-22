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
   GITHUB_API_KEY=github_pat_...   # fallback provider, see below
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

## Rate-limit fallback (GitHub Models, Groq, OpenRouter, Z.ai)

`agent-model` and `nemotron-lightning` share one `NVIDIA_API_KEY`, so an
NVIDIA-side rate limit hits both at once. `config.yaml` adds four more
models on independent providers/keys (`gh-gpt4o`, `groq-model`,
`openrouter-model`, `zai-model`) and a `fallbacks` chain in
`litellm_settings` -- a 429 on any model retries the others in priority
order (NVIDIA pair first, then each other provider) until one succeeds.

1. **GitHub Models:** fine-grained PAT at
   <https://github.com/settings/personal-access-tokens> -- permission
   **Models: Read-only**, no repo access needed. Add `GITHUB_API_KEY=github_pat_...`
   to `.env`. **Note:** as of 2026-08-22 GitHub Models itself is returning
   `github_models_retirement_brownout` on every request (GitHub's wording
   is "scheduled retirement", not a transient outage) -- this fallback is
   currently a fast no-op, not dead weight, but don't count on it serving
   traffic.
2. **Groq:** free key at <https://console.groq.com/keys>. Add
   `GROQ_API_KEY=gsk_...` to `.env`.
3. **OpenRouter:** free key at <https://openrouter.ai> -> Sign Up -> Keys.
   Add `OPENROUTER_API_KEY=sk-or-v1-...` to `.env` (shared with
   `openrouter-runner.mjs` -- one key covers both).
4. **Z.ai (GLM):** free key at <https://z.ai> -> API keys. Add
   `ZAI_API_KEY=...` to `.env`. The model id in `config.yaml`
   (`glm-4.5-flash`) is **unverified** -- confirm it against `GET
   https://api.z.ai/api/paas/v4/models` (needs the key) once you have one,
   the way `groq-model` and `openrouter-model`'s ids were confirmed against
   their own `/models` endpoints.
5. For the deploy workflow (`.github/workflows/deploy.yml`), add repo
   secrets named **`GH_MODELS_API_KEY`**, **`GROQ_MODELS_API_KEY`**,
   **`OPENROUTER_API_KEY`**, and **`ZAI_API_KEY`** (GitHub Actions rejects
   repo secrets with a `GITHUB_` prefix, reserved for its own token --
   that's why the first is renamed; the others aren't affected). The
   workflow maps them onto the matching `.env` var names on the host for
   you.
6. `docker compose up -d litellm` to pick it all up (needs a container
   recreate for new env vars, not just a restart -- `restart` reuses the
   env the container already has).

Any of the five keys can be left unset -- `os.environ/VAR` just resolves
empty and that model 401s if actually dispatched, which only happens if
every model ahead of it in the fallback chain is also failing.

**Provider catalogs drift.** Two of these model ids (Groq's and
OpenRouter's) were wrong on first pass -- the models existed when this file
was originally written but had since been deprecated/repriced. Before
trusting a fallback model id, check it against that provider's live
`/models` endpoint rather than copying from docs or memory.

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
