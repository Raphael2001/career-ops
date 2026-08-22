# career-ops monitor

Standalone Next.js dashboard for the infra behind career-ops's automation --
separate from `web/` (the main job-tracking app) and `dashboard/` (a Go
TUI). Read-only: it doesn't write to anything, doesn't gate any pipeline,
and running it or not has zero effect on the automation it's watching.

Runs as its own service in the project's `docker-compose.yml`, on the same
host as `career-ops`/`litellm`/`litellm-db` -- not something reached over
SSH from elsewhere (an earlier version worked that way; see "History"
below for why that changed).

## Pages

- **Overview** (`/`) -- summary cards, links to the detail pages.
- **Models** (`/models`) -- live health per model (a real test call litellm
  just dispatched, not a cached status) and usage rolled up per model from
  the last 200 calls: call count, tokens, average latency, spend.
- **Scan** (`/scan`) -- whether `discover-companies-native.sh` is currently
  running (via its own lock file), the company it's on, when it last
  started, and the tail of its log.
- **Containers** (`/containers`) -- status of `career-ops`, `litellm`,
  `litellm-db`.

## Running it

```bash
docker compose up -d monitor
```

Open `http://<host>:4002`. That's it -- `LITELLM_BASE_URL` and
`LITELLM_MASTER_KEY` are supplied automatically by `docker-compose.yml`
(see the `monitor` service there), and container/scan status come from the
docker socket mounted into the container (`/var/run/docker.sock:ro`), not
SSH.

`docker-compose.yml` changing (which this service addition does) is in the
deploy script's rebuild-trigger list -- next push runs `./cops rebuild`,
which is safe but does briefly recreate `career-ops` too (kills a
discovery scan if one's mid-run; it just needs re-running, same as any
other rebuild).

### Local dev (optional)

Iterating on the UI without a full image rebuild each time:

```bash
cd monitor
yarn install
yarn dev
```

Only works run directly on the docker host itself (not from elsewhere) --
`getScanStatus`/`getContainers` shell out to the local `docker` binary,
which needs a real socket at the default location, not a remote one. See
`.env.example` for the two vars this mode needs that docker-compose
otherwise supplies.

## Docker socket access -- know what you're mounting

The `monitor` service in `docker-compose.yml` mounts
`/var/run/docker.sock` read-only. That's still root-equivalent access to
every container on the host, not just career-ops's own three -- the
read-only mount flag only stops the *file* from being written to, not what
you can do by talking to the Docker Engine API through it (start/stop/exec
into anything). Accepted here because this is a personal single-user host
and the alternative (a scoped API proxy in front of the socket) is real
infra for a read-only dev tool. Don't copy this mount into anything
multi-tenant or internet-facing.

## Testing

```bash
yarn test
```

Covers `src/lib/remote-parse.mjs` -- the pure parsing that turns
`docker ps --format json` and the scan's lock+log output into
`ScanStatus`/`ContainerStatus`, the actual logic that can silently break
when either output format changes. Kept in a plain `.mjs` file (not `.ts`)
so `node --test` runs it with zero build step, matching `web/`'s
convention for the same kind of pure logic (see
`web/src/lib/apply/exit.mjs`).

The docker exec/ps plumbing itself (`remote.ts`) isn't covered here -- it
needs a real docker socket, and is exercised by hand against the real one
instead.

## Refresh behavior

Each page re-fetches on an interval via `router.refresh()` (`AutoRefresh`
component) -- Overview/Scan/Containers every 15s, Models every 60s. Models
is slower deliberately: `/health` dispatches a real test call to every
configured model, and the full sweep has been observed to take close to
100s wall-clock (the biggest model alone can take 20-30s, and NVIDIA NIM's
free tier occasionally needs a retry mid-stream).

## History

The first version called litellm's HTTP API directly at its LAN IP
(`LITELLM_BASE_URL` pointed outward) and reached scan/container status
over SSH (`docker exec`/`docker compose ps` run remotely). That broke the
moment it ran somewhere without a route to that specific LAN, and depended
on an SSH key + `~/.ssh/config` entry existing wherever it ran. Moving it
into `docker-compose.yml` on the same host as everything it watches
removed both problems at once: litellm is reached by its compose-network
service name (`http://litellm:4000`, no LAN IP, no key needed for that
part), and scan/container status come from a mounted docker socket instead
of SSH -- one dependency (a socket mount) instead of two (a working SSH
config, plus whatever network path SSH needed).
