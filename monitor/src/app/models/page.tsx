import { getHealth, getSpendLogs, type SpendLogEntry } from "@/lib/litellm";
import { Panel } from "@/components/Panel";
import { StatusBadge } from "@/components/StatusBadge";
import { RefreshButton } from "@/components/RefreshButton";

export const dynamic = "force-dynamic";

// litellm_params.model (what /health reports) -> a human label for the
// provider actually serving it. Update this when deploy/litellm/config.yaml
// changes -- there's no way to derive "Z.ai" from "openai/glm-4.7-flash"
// (it's routed through the generic openai/ provider) without this map.
const PROVIDER_LABELS: Record<string, string> = {
  "nvidia_nim/nvidia/nemotron-3.5-lightning-30b-a3b": "NVIDIA NIM",
  "nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b": "NVIDIA NIM",
  "groq/openai/gpt-oss-120b": "Groq",
  "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free": "OpenRouter",
  "openai/glm-4.7-flash": "Z.ai",
  "mistral/mistral-small-latest": "Mistral",
};

function providerLabel(model: string): string {
  return PROVIDER_LABELS[model] ?? model.split("/")[0];
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ recheck?: string }>;
}) {
  const params = await searchParams;
  const force = params.recheck !== undefined;

  const [healthResult, spendResult] = await Promise.allSettled([getHealth(force), getSpendLogs(200)]);

  const health = healthResult.status === "fulfilled" ? healthResult.value.report : null;
  const healthError = healthResult.status === "rejected" ? String(healthResult.reason) : null;
  const spend = spendResult.status === "fulfilled" ? spendResult.value : null;
  const spendError = spendResult.status === "rejected" ? String(spendResult.reason) : null;

  const checkedAt =
    healthResult.status === "fulfilled"
      ? new Date(healthResult.value.checkedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : null;

  const healthyCount = health?.healthy_endpoints.length ?? 0;
  const unhealthyCount = health?.unhealthy_endpoints.length ?? 0;
  const totalCount = healthyCount + unhealthyCount;

  // Unhealthy first -- that's what needs attention -- then healthy, each
  // group sorted by provider so the list reads consistently between checks.
  const rows = [
    ...(health?.unhealthy_endpoints ?? []).map((ep) => ({ ...ep, ok: false })),
    ...(health?.healthy_endpoints ?? []).map((ep) => ({ ...ep, ok: true })),
  ].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return providerLabel(a.model).localeCompare(providerLabel(b.model));
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-fg">Models</h1>
          <p className="mt-1 text-sm text-muted">
            Health is cached for 5 minutes so navigating here doesn&apos;t force a live sweep every
            time. Hit Recheck to dispatch a real test call to every model right now.
          </p>
        </div>
        <RefreshButton />
      </div>

      <Panel
        title="Health"
        action={
          !healthError && health ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-faint">checked {checkedAt}</span>
              <StatusBadge
                status={unhealthyCount === 0 ? "ok" : healthyCount === 0 ? "error" : "warn"}
                label={`${healthyCount}/${totalCount} healthy`}
              />
            </div>
          ) : undefined
        }
      >
        {healthError ? (
          <p className="text-sm text-error">Health check failed: {healthError}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {rows.map((ep) => (
              <ModelRow
                key={ep.model_id ?? ep.model}
                model={ep.model}
                provider={providerLabel(ep.model)}
                status={ep.ok ? "ok" : "error"}
                detail={!ep.ok ? firstLine(ep.error) : undefined}
              />
            ))}
            {totalCount === 0 && <p className="py-2 text-sm text-muted">No models configured.</p>}
          </div>
        )}
      </Panel>

      <Panel title="Usage (last 200 calls)">
        {spendError ? (
          <p className="text-sm text-error">Usage fetch failed: {spendError}</p>
        ) : (
          <UsageTable entries={spend ?? []} />
        )}
      </Panel>
    </div>
  );
}

function ModelRow({
  model,
  provider,
  status,
  detail,
}: {
  model: string;
  provider: string;
  status: "ok" | "error";
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[11px] font-medium text-muted">
          {provider}
        </span>
        <span className="truncate font-mono text-sm text-fg">{model}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {detail && <span className="max-w-md truncate text-xs text-muted">{detail}</span>}
        <StatusBadge status={status} label={status === "ok" ? "healthy" : "failing"} />
      </div>
    </div>
  );
}

function firstLine(text?: string): string | undefined {
  return text?.split("\n")[0]?.slice(0, 140);
}

function UsageTable({ entries }: { entries: SpendLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No calls recorded yet.</p>;
  }

  const byModel = new Map<
    string,
    { calls: number; tokens: number; spend: number; durations: number[] }
  >();

  for (const e of entries) {
    const key = e.model_group ?? e.model;
    const row = byModel.get(key) ?? { calls: 0, tokens: 0, spend: 0, durations: [] };
    row.calls += 1;
    row.tokens += e.total_tokens ?? 0;
    row.spend += e.spend ?? 0;
    if (e.request_duration_ms) row.durations.push(e.request_duration_ms);
    byModel.set(key, row);
  }

  const totalCalls = entries.length;

  const rows = [...byModel.entries()]
    .map(([model, r]) => ({
      model,
      provider: providerLabel(model),
      calls: r.calls,
      share: totalCalls > 0 ? r.calls / totalCalls : 0,
      tokens: r.tokens,
      spend: r.spend,
      avgMs: r.durations.length ? Math.round(r.durations.reduce((a, b) => a + b, 0) / r.durations.length) : null,
    }))
    .sort((a, b) => b.calls - a.calls);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-faint">
          <th className="pb-2 font-medium">Model</th>
          <th className="pb-2 font-medium tabular text-right">Calls</th>
          <th className="pb-2 font-medium tabular text-right">Share</th>
          <th className="pb-2 font-medium tabular text-right">Tokens</th>
          <th className="pb-2 font-medium tabular text-right">Avg latency</th>
          <th className="pb-2 font-medium tabular text-right">Spend</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.model}>
            <td className="py-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[11px] font-medium text-muted">
                  {r.provider}
                </span>
                <span className="truncate font-mono text-fg">{r.model}</span>
              </div>
            </td>
            <td className="py-2 text-right tabular text-fg">{r.calls}</td>
            <td className="py-2 text-right tabular text-muted">{(r.share * 100).toFixed(0)}%</td>
            <td className="py-2 text-right tabular text-fg">{r.tokens.toLocaleString()}</td>
            <td className="py-2 text-right tabular text-muted">
              {r.avgMs !== null ? `${(r.avgMs / 1000).toFixed(1)}s` : "--"}
            </td>
            <td className="py-2 text-right tabular text-muted">${r.spend.toFixed(4)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
