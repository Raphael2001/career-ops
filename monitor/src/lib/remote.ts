import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseScanStatus, parseContainers } from "./remote-parse.mjs";

const execFileAsync = promisify(execFile);

// Runs locally against the docker socket mounted into this container
// (docker-compose.yml: /var/run/docker.sock, read-only) -- no SSH. This
// container being on the same docker-compose stack as career-ops/litellm
// is the whole point of moving it here instead of reaching in from
// somewhere else.
async function runDocker(args: string[], timeoutMs = 20_000): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

export type ScanStatus = {
  running: boolean;
  currentCompany: string | null;
  lastStartedAt: string | null;
  recentLines: string[];
  error?: string;
};

export async function getScanStatus(): Promise<ScanStatus> {
  try {
    // No -T/-i/-t: that's docker compose exec's flag for disabling a pty,
    // not plain docker exec's. Plain `docker exec container cmd` is
    // already non-interactive/no-tty by default with no flags at all.
    //
    // discover.log is shared with the host-level git-sync-portals.sh cron
    // (see git-sync-portals.sh), which fires far more often than an actual
    // scan run -- its lines can crowd the last "starting"/company line
    // clean out of a plain tail -40 (#observed: 536-line log, last scan
    // start at line 207, nothing but git-sync noise in the tail window).
    // So the last-started/current-company lines are grepped from the
    // WHOLE file, independent of the tail used for the recent-log display.
    const out = await runDocker([
      "exec",
      "career-ops",
      "sh",
      "-c",
      [
        "flock -n /tmp/discover-companies-native.lock -c true; echo LOCK_EXIT=$?",
        "echo __RECENT__",
        "tail -n 40 /app/deploy/discover.log 2>/dev/null",
        "echo __LAST_STARTED__",
        "grep -F '] starting' /app/deploy/discover.log 2>/dev/null | tail -1",
        "echo __LAST_COMPANY__",
        "grep -E '\\[[0-9]+\\][[:space:]]' /app/deploy/discover.log 2>/dev/null | tail -1",
      ].join("; "),
    ]);
    return parseScanStatus(out);
  } catch (err) {
    return {
      running: false,
      currentCompany: null,
      lastStartedAt: null,
      recentLines: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerScan(): Promise<{ ok: boolean; error?: string }> {
  try {
    // -d: detached, so this returns as soon as the process starts rather
    // than blocking on the scan itself (a full pass can take most of a
    // day). discover-companies-native.sh has its own flock, so a click
    // while cron's midnight run (or a previous click) is already in
    // flight is a harmless no-op, not a double run.
    await runDocker([
      "exec",
      "-d",
      "career-ops",
      "sh",
      "-c",
      "cd /app && ./deploy/discover-companies-native.sh >> /app/deploy/discover.log 2>&1",
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function stopScan(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Kills the script process itself (releasing its flock as a side
    // effect of the fd closing -- no separate unlock step needed), then
    // runs the exact same browser/claude-process pkill the script's own
    // cleanup_browser() uses at its checkpoints, since killing the parent
    // doesn't touch children it already spawned (Playwright/chrome,
    // `claude --print` for the search pass). Without that second pkill, a
    // stop mid-search-pass would leave those orphaned until the next run's
    // own pre-run cleanup happens to reap them.
    await runDocker([
      "exec",
      "career-ops",
      "sh",
      "-c",
      [
        "pkill -f deploy/discover-companies-native.sh 2>/dev/null || true",
        "pkill -9 -f 'playwright-mcp|chrome.*ms-playwright-mcp|claude --print' 2>/dev/null || true",
      ].join("; "),
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ContainerStatus = {
  Name: string;
  Service: string;
  State: string;
  Status: string;
  Health?: string;
};

export async function getContainers(): Promise<{ containers: ContainerStatus[]; error?: string }> {
  try {
    // Filtered by the compose project label rather than a name substring --
    // exact, and doesn't depend on career-ops-* naming staying stable.
    const out = await runDocker([
      "ps",
      "--filter",
      "label=com.docker.compose.project=career-ops",
      "--format",
      "json",
    ]);
    return { containers: parseContainers(out) as ContainerStatus[] };
  } catch (err) {
    return { containers: [], error: err instanceof Error ? err.message : String(err) };
  }
}
