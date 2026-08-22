// Pure parsing for remote.ts's two SSH-sourced data shapes. Plain JS (not
// .ts) on purpose, matching web/'s convention for logic that needs to run
// under `node --test` with zero build step -- see web/src/lib/apply/exit.mjs.

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
 * @param {string} raw - stdout from `docker compose ps --format json`,
 *   newline-delimited JSON objects (docker compose's own NDJSON format).
 * @returns {Array<Record<string, unknown>>}
 */
export function parseContainers(raw) {
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}
