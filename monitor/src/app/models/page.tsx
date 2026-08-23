import { getHealth } from "@/lib/litellm";
import { providerLabel } from "@/lib/providers";
import { Panel } from "@/components/Panel";
import { StatusBadge } from "@/components/StatusBadge";
import { RefreshButton } from "@/components/RefreshButton";

export const dynamic = "force-dynamic";

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ recheck?: string }>;
}) {
  const params = await searchParams;
  const force = params.recheck !== undefined;

  const [healthResult] = await Promise.allSettled([getHealth(force)]);

  const health = healthResult.status === "fulfilled" ? healthResult.value.report : null;
  const healthError = healthResult.status === "rejected" ? String(healthResult.reason) : null;

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
