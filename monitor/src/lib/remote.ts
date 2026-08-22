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
    const out = await runDocker([
      "exec",
      "career-ops",
      "sh",
      "-c",
      "flock -n /tmp/discover-companies-native.lock -c true; echo LOCK_EXIT=$?; tail -n 40 /app/deploy/discover.log 2>/dev/null",
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
