import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SSH_HOST = process.env.MONITOR_SSH_HOST ?? "linux-claw";
const PROJECT_DIR = process.env.MONITOR_REMOTE_PROJECT_DIR ?? "~/career-ops";

export async function runRemote(command: string, timeoutMs = 20_000): Promise<string> {
  const { stdout } = await execFileAsync(
    "ssh",
    ["-o", "ConnectTimeout=8", "-o", "BatchMode=yes", SSH_HOST, `cd ${PROJECT_DIR} && ${command}`],
    { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}

// litellm's LAN IP (192.168.0.121) isn't reachable from every machine this
// dashboard might run on (e.g. a sandboxed dev environment with no route to
// that subnet, only SSH). Route through the host itself instead of a direct
// fetch -- curl there, against localhost:4001, using the .env this repo
// already keeps LITELLM_MASTER_KEY in. No key needs to live in this app's
// own env at all.
export async function curlLiteLLM(path: string, timeoutMs = 20_000): Promise<string> {
  const timeoutS = Math.ceil(timeoutMs / 1000);
  const command = `set -a && source .env 2>/dev/null; set +a; curl -sS -m ${timeoutS} "http://localhost:4001${path}" -H "Authorization: Bearer $LITELLM_MASTER_KEY"`;
  return runRemote(command, timeoutMs + 10_000);
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
    const out = await runRemote(
      `docker compose exec -T career-ops sh -c 'flock -n /tmp/discover-companies-native.lock -c true; echo LOCK_EXIT=$?; tail -n 40 /app/deploy/discover.log 2>/dev/null'`,
    );
    const lines = out.split("\n");
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
    const out = await runRemote("docker compose ps --format json");
    const containers = out
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as ContainerStatus);
    return { containers };
  } catch (err) {
    return { containers: [], error: err instanceof Error ? err.message : String(err) };
  }
}
