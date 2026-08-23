import Link from "next/link";
import { getModels } from "@/lib/litellm";
import { getScanStatus, getContainers } from "@/lib/remote";
import { Panel } from "@/components/Panel";
import { StatusBadge } from "@/components/StatusBadge";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [modelsResult, scanResult, containersResult] = await Promise.allSettled([
    getModels(),
    getScanStatus(),
    getContainers(),
  ]);

  const models = modelsResult.status === "fulfilled" ? modelsResult.value : null;
  const scan = scanResult.status === "fulfilled" ? scanResult.value : null;
  const containers = containersResult.status === "fulfilled" ? containersResult.value : null;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={15_000} />
      <div>
        <h1 className="text-lg font-semibold text-fg">Overview</h1>
        <p className="mt-1 text-sm text-muted">career-ops infrastructure at a glance.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/models" className="block h-full">
          <Panel title="Models" className="h-full">
            {models ? (
              <>
                <p className="text-2xl font-semibold tabular text-fg">{models.length}</p>
                <p className="mt-1 text-xs text-muted">configured on the proxy</p>
              </>
            ) : (
              <StatusBadge status="error" label="unreachable" />
            )}
          </Panel>
        </Link>

        <Link href="/scan" className="block h-full">
          <Panel title="Discovery scan" className="h-full">
            {scan?.error ? (
              <StatusBadge status="error" label="unreachable" />
            ) : scan?.running ? (
              <>
                <StatusBadge status="ok" label="running" />
                {scan.currentCompany && (
                  <p className="mt-2 truncate text-xs text-muted">on {scan.currentCompany}</p>
                )}
              </>
            ) : (
              <>
                <StatusBadge status="neutral" label="idle" />
                {scan?.lastStartedAt && (
                  <p className="mt-2 truncate font-mono text-xs text-muted">last ran {scan.lastStartedAt}</p>
                )}
              </>
            )}
          </Panel>
        </Link>

        <Link href="/containers" className="block h-full">
          <Panel title="Containers" className="h-full">
            {containers?.error ? (
              <StatusBadge status="error" label="unreachable" />
            ) : (
              <ContainerSummary containers={containers?.containers ?? []} />
            )}
          </Panel>
        </Link>
      </div>
    </div>
  );
}

function ContainerSummary({
  containers,
}: {
  containers: { State: string }[];
}) {
  const up = containers.filter((c) => c.State === "running").length;
  const total = containers.length;
  const allUp = total > 0 && up === total;
  return (
    <>
      <p className="text-2xl font-semibold tabular text-fg">
        {up}/{total}
      </p>
      <p className="mt-1 text-xs text-muted">{allUp ? "all running" : "attention needed"}</p>
    </>
  );
}
