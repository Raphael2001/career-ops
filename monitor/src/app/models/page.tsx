import { getHealth, getSpendLogs, type SpendLogEntry } from "@/lib/litellm";
import { Panel } from "@/components/Panel";
import { StatusBadge } from "@/components/StatusBadge";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const [healthResult, spendResult] = await Promise.allSettled([getHealth(), getSpendLogs(200)]);

  const health = healthResult.status === "fulfilled" ? healthResult.value : null;
  const healthError = healthResult.status === "rejected" ? String(healthResult.reason) : null;
  const spend = spendResult.status === "fulfilled" ? spendResult.value : [];

  return (
    <div className="flex flex-col gap-6">
      {/* /health dispatches a real test call to every model -- refresh
          slower than other pages so it doesn't overlap itself. */}
      <AutoRefresh intervalMs={60_000} />
      <div>
        <h1 className="text-lg font-semibold text-fg">Models</h1>
        <p className="mt-1 text-sm text-muted">
          Live health -- each row is a real test call litellm just made, not a cached status.
        </p>
      </div>

      <Panel title="Health">
        {healthError ? (
          <p className="text-sm text-error">Health check failed: {healthError}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {health?.healthy_endpoints.map((ep) => (
              <ModelRow key={ep.model_id ?? ep.model} model={ep.model} status="ok" />
            ))}
            {health?.unhealthy_endpoints.map((ep) => (
              <ModelRow
                key={ep.model_id ?? ep.model}
                model={ep.model}
                status="error"
                detail={firstLine(ep.error)}
              />
            ))}
            {health &&
              health.healthy_endpoints.length === 0 &&
              health.unhealthy_endpoints.length === 0 && (
                <p className="py-2 text-sm text-muted">No models configured.</p>
              )}
          </div>
        )}
      </Panel>

      <Panel title="Usage (last 200 calls)">
        <UsageTable entries={spend} />
      </Panel>
    </div>
  );
}

function ModelRow({
  model,
  status,
  detail,
}: {
  model: string;
  status: "ok" | "error";
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="font-mono text-sm text-fg">{model}</span>
      <div className="flex items-center gap-3">
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
    { calls: number; tokens: number; spend: number; avgMs: number; durations: number[] }
  >();

  for (const e of entries) {
    const key = e.model_group ?? e.model;
    const row = byModel.get(key) ?? { calls: 0, tokens: 0, spend: 0, avgMs: 0, durations: [] };
    row.calls += 1;
    row.tokens += e.total_tokens ?? 0;
    row.spend += e.spend ?? 0;
    if (e.request_duration_ms) row.durations.push(e.request_duration_ms);
    byModel.set(key, row);
  }

  const rows = [...byModel.entries()]
    .map(([model, r]) => ({
      model,
      calls: r.calls,
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
          <th className="pb-2 font-medium tabular text-right">Tokens</th>
          <th className="pb-2 font-medium tabular text-right">Avg latency</th>
          <th className="pb-2 font-medium tabular text-right">Spend</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.model}>
            <td className="py-2 font-mono text-fg">{r.model}</td>
            <td className="py-2 text-right tabular text-fg">{r.calls}</td>
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
