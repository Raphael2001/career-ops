import { providerLabel } from "@/lib/providers";
import type { SpendLogEntry } from "@/lib/litellm";

export function UsageTable({ entries }: { entries: SpendLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No calls recorded in this range.</p>;
  }

  const byModel = new Map<string, { calls: number; tokens: number; spend: number; durations: number[] }>();

  for (const e of entries) {
    // model_group is "" (not null) on litellm's own internal health-check
    // calls -- `||` catches that where `??` wouldn't, so those don't collapse
    // into a blank, unlabeled row.
    const key = e.model_group || e.model;
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
    <div className="flex flex-col gap-3">
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
    </div>
  );
}
