// Talks to litellm directly over the docker-compose network (service name
// "litellm", port 4000 internally -- see docker-compose.yml) now that this
// app is itself a compose service on the same network, not something
// reaching in from outside. LITELLM_MASTER_KEY comes from the container's
// own env (docker-compose.yml passes it through from the host .env, same
// as the litellm service itself gets it).

const BASE_URL = process.env.LITELLM_BASE_URL ?? "http://litellm:4000";
const MASTER_KEY = process.env.LITELLM_MASTER_KEY ?? "";

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${MASTER_KEY}` };
}

async function fetchJson<T>(path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: authHeaders(),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`${path} -> HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export type LiteLLMModel = { id: string; object: string; owned_by?: string };

export async function getModels(): Promise<LiteLLMModel[]> {
  const data = await fetchJson<{ data: LiteLLMModel[] }>("/v1/models", 10_000);
  return data.data;
}

export type HealthEndpoint = {
  model: string;
  model_id?: string;
  api_base?: string;
  error?: string;
};

export type HealthReport = {
  healthy_endpoints: HealthEndpoint[];
  unhealthy_endpoints: HealthEndpoint[];
};

// litellm's /health dispatches a real test call to every configured
// deployment -- the biggest model here (agentic Nemotron-3-Ultra) alone can
// take 20-30s, and the full sweep across 6 models has been observed close
// to 100s wall-clock (NVIDIA NIM's free tier occasionally needs a retry
// mid-stream). Give it real headroom rather than trimming it and reporting
// a false failure.
//
// Deduplicated across concurrent callers (module-scoped, shared for the
// life of this server process): a client that times out client-side (e.g.
// `curl -m 5`) does NOT cancel the in-flight fetch here, so without this a
// burst of impatient requests -- two browser tabs, a curl retried a few
// times, AutoRefresh firing while a manual recheck is still running --
// stacks up multiple real 6-model sweeps against litellm concurrently
// instead of one. That's a real, observed cause of host memory pressure,
// not a theoretical one.
let inFlightHealth: Promise<HealthResult> | null = null;

// Cached alongside the in-flight promise so a plain page load/navigation
// doesn't itself trigger a fresh 6-model sweep (up to ~150s) -- only an
// explicit `force` (the "Recheck now" button) does. TTL is generous on
// purpose: this is an ops dashboard, not a live status page, and staleness
// self-heals every 5 minutes even if nobody clicks Recheck.
export type HealthResult = { report: HealthReport; checkedAt: number };

let cachedHealth: HealthResult | null = null;
const HEALTH_CACHE_TTL_MS = 5 * 60_000;

export async function getHealth(force = false): Promise<HealthResult> {
  if (!force && cachedHealth && Date.now() - cachedHealth.checkedAt < HEALTH_CACHE_TTL_MS) {
    return cachedHealth;
  }
  if (inFlightHealth) return inFlightHealth;
  inFlightHealth = fetchJson<HealthReport>("/health", 150_000)
    .then((report) => {
      cachedHealth = { report, checkedAt: Date.now() };
      return cachedHealth;
    })
    .finally(() => {
      inFlightHealth = null;
    });
  return inFlightHealth;
}

export type SpendLogEntry = {
  request_id: string;
  model: string;
  model_group?: string;
  spend: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  startTime: string;
  request_duration_ms?: number;
};

export async function getSpendLogs(limit = 100): Promise<SpendLogEntry[]> {
  return fetchJson<SpendLogEntry[]>(`/spend/logs?limit=${limit}`, 20_000);
}

export type DailySpend = { date: string; spend: number };

export async function getGlobalSpend(): Promise<DailySpend[]> {
  return fetchJson<DailySpend[]>("/global/spend/logs", 20_000);
}
