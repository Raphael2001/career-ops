# career-ops monitor

Standalone Next.js dashboard for the infra behind career-ops's automation --
separate from `web/` (the main job-tracking app) and `dashboard/` (a Go TUI).
Read-only: it doesn't write to anything, doesn't gate any pipeline, and
running it or not has zero effect on the automation it's watching.

## Pages

- **Overview** (`/`) -- summary cards, links to the detail pages.
- **Models** (`/models`) -- live health per model (a real test call litellm
  just dispatched, not a cached status) and usage rolled up per model from
  the last 200 calls: call count, tokens, average latency, spend.
- **Scan** (`/scan`) -- whether `discover-companies-native.sh` is currently
  running (via its own lock file), the company it's on, when it last
  started, and the tail of its log.
- **Containers** (`/containers`) -- `docker compose ps` for `career-ops`,
  `litellm`, `litellm-db`.

## Setup

```bash
cd monitor
npm install
npm run dev
```

That's it -- no `.env.local` needed by default. Every page reads its data by
SSHing to `linux-claw` (override with `MONITOR_SSH_HOST` if your host is
named differently) and running the same commands you'd type by hand:
`curl localhost:4001/...` for litellm, `docker compose exec ... flock` for
scan status, `docker compose ps` for containers. litellm's own `.env` on
that host already has `LITELLM_MASTER_KEY` -- this app never needs its own
copy of it.

Requires a working `~/.ssh/config` entry for the host with no password
prompt (BatchMode) -- the same one you'd use for `ssh linux-claw`.

## Why everything goes through SSH, not a direct API call

The first version of the Models page called litellm's HTTP API directly
(`LITELLM_BASE_URL` pointed at the LAN IP). That broke the moment this
dashboard ran somewhere without a route to that specific LAN -- a sandboxed
dev environment, a laptop on a different network, anywhere that isn't
physically on the same subnet as the docker host. SSH already had to work
for the Scan and Containers pages (`docker compose exec`/`ps` have no HTTP
equivalent), so routing litellm calls through the same SSH session too
removes the LAN assumption entirely and means one thing to configure
(`MONITOR_SSH_HOST`) instead of two.

The tradeoff: this only runs from a machine with SSH access to that host --
a personal dev tool, not something meant to be publicly deployed. If it
ever needs to run from somewhere without SSH access, the alternative is
mounting the docker socket and bind-mounting `deploy/discover.log` into
this app's own container instead -- not done here to keep it a plain
`npm run dev`, no docker-compose service of its own.

## Refresh behavior

Each page re-fetches on an interval via `router.refresh()` (`AutoRefresh`
component) -- Overview/Scan/Containers every 15s, Models every 60s. Models
is slower deliberately: `/health` dispatches a real test call to every
configured model, and the full sweep has been observed to take close to
100s wall-clock (the biggest model alone can take 20-30s, and NVIDIA NIM's
free tier occasionally needs a retry mid-stream).
