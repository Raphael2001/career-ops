import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseScanStatus, parseContainers } from "./remote-parse.mjs";

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
    const out = await runRemote("docker compose ps --format json");
    return { containers: parseContainers(out) as ContainerStatus[] };
  } catch (err) {
    return { containers: [], error: err instanceof Error ? err.message : String(err) };
  }
}
