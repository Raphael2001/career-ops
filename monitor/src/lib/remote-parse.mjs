// Pure parsing for remote.ts's two docker-sourced data shapes. Plain JS
// (not .ts) on purpose, matching web/'s convention for logic that needs to
// run under `node --test` with zero build step -- see
// web/src/lib/apply/exit.mjs.

/**
 * @param {string} raw - combined stdout from the LOCK_EXIT + discover.log
 *   tail command in remote.ts's getScanStatus.
 * @returns {{running: boolean, currentCompany: string|null, lastStartedAt: string|null, recentLines: string[]}}
 */
export function parseScanStatus(raw) {
  const lines = raw.split("\n");
  const lockLine = lines.find((l) => l.startsWith("LOCK_EXIT="));
  // flock -n exits 0 when it ACQUIRED the lock (nobody else held it) --
  // "running" means the opposite: exit 1, lock was already held.
  const running = lockLine?.trim() === "LOCK_EXIT=1";
  const logLines = lines.filter((l) => !l.startsWith("LOCK_EXIT="));

  const startedLine = [...logLines].reverse().find((l) => l.includes("starting"));
  const startedMatch = startedLine?.match(/\[discover-native ([^\]]+)\]/);

  const companyLine = [...logLines].reverse().find((l) => /\[\d+\]\s/.test(l));
  const companyMatch = companyLine?.match(/\[\d+\]\s+(.+)$/);

  return {
    running,
    currentCompany: companyMatch?.[1]?.trim() ?? null,
    lastStartedAt: startedMatch?.[1] ?? null,
    recentLines: logLines.filter((l) => l.trim().length > 0).slice(-15),
  };
}

/**
 * @param {string} raw - stdout from `docker ps --format json` (plain
 *   docker, not `docker compose ps` -- this container only has a docker
 *   socket, not the compose project's files, so it can't resolve a
 *   compose project by directory). Newline-delimited JSON, docker's own
 *   field names: Names, State, Status, HealthStatus ("none" when the
 *   service has no healthcheck), Labels (a single comma-joined string
 *   containing com.docker.compose.service=<name> among others).
 *
 *   Verified live against `docker ps --filter
 *   label=com.docker.compose.project=career-ops --format json` on
 *   2026-08-22 -- e.g. HealthStatus is "healthy" for litellm-db (it has a
 *   healthcheck) and "none" for career-ops/litellm (they don't).
 * @returns {Array<{Name: string, Service: string, State: string, Status: string, Health?: string}>}
 */
export function parseContainers(raw) {
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
    .map((d) => {
      const serviceMatch = (d.Labels ?? "").match(/com\.docker\.compose\.service=([^,]+)/);
      return {
        Name: d.Names,
        Service: serviceMatch?.[1] ?? d.Names,
        State: d.State,
        Status: d.Status,
        Health: d.HealthStatus && d.HealthStatus !== "none" ? d.HealthStatus : undefined,
      };
    });
}
