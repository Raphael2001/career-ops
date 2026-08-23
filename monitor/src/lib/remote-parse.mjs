// Pure parsing for remote.ts's two docker-sourced data shapes. Plain JS
// (not .ts) on purpose, matching web/'s convention for logic that needs to
// run under `node --test` with zero build step -- see
// web/src/lib/apply/exit.mjs.

/**
 * @param {string} raw - combined stdout from remote.ts's getScanStatus:
 *   a LOCK_EXIT line, then __RECENT__/__LAST_STARTED__/__LAST_COMPANY__
 *   markers each followed by their own grep/tail output.
 * @returns {{running: boolean, currentCompany: string|null, lastStartedAt: string|null, recentLines: string[]}}
 */
export function parseScanStatus(raw) {
  const lockLine = raw.split("\n").find((l) => l.startsWith("LOCK_EXIT="));
  // flock -n exits 0 when it ACQUIRED the lock (nobody else held it) --
  // "running" means the opposite: exit 1, lock was already held.
  const running = lockLine?.trim() === "LOCK_EXIT=1";

  const recentBlock = extractSection(raw, "__RECENT__", "__LAST_STARTED__");
  const startedBlock = extractSection(raw, "__LAST_STARTED__", "__LAST_COMPANY__");
  const companyBlock = extractSection(raw, "__LAST_COMPANY__", null);

  const startedMatch = startedBlock.trim().match(/\[discover-native ([^\]]+)\]/);
  const companyMatch = companyBlock.trim().match(/\[\d+\]\s+(.+)$/);

  return {
    running,
    currentCompany: companyMatch?.[1]?.trim() ?? null,
    lastStartedAt: startedMatch?.[1] ?? null,
    recentLines: recentBlock
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(-15),
  };
}

/** @param {string} raw @param {string} startMarker @param {string|null} endMarker */
function extractSection(raw, startMarker, endMarker) {
  const startIdx = raw.indexOf(startMarker);
  if (startIdx === -1) return "";
  const from = startIdx + startMarker.length;
  const endIdx = endMarker ? raw.indexOf(endMarker, from) : -1;
  return endIdx === -1 ? raw.slice(from) : raw.slice(from, endIdx);
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
