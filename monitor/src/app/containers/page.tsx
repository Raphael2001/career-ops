import { getContainers } from "@/lib/remote";
import { Panel } from "@/components/Panel";
import { StatusBadge } from "@/components/StatusBadge";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function ContainersPage() {
  const { containers, error } = await getContainers();

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={15_000} />
      <div>
        <h1 className="text-lg font-semibold text-fg">Containers</h1>
        <p className="mt-1 text-sm text-muted">docker compose ps on linux-claw.</p>
      </div>

      <Panel title="Services">
        {error ? (
          <p className="text-sm text-error">Can&apos;t reach the host: {error}</p>
        ) : containers.length === 0 ? (
          <p className="text-sm text-muted">No containers found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-faint">
                <th className="pb-2 font-medium">Service</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {containers.map((c) => (
                <tr key={c.Name}>
                  <td className="py-2.5 font-mono text-fg">{c.Service || c.Name}</td>
                  <td className="py-2.5 text-muted">{c.Status}</td>
                  <td className="py-2.5">
                    <ContainerHealthBadge state={c.State} health={c.Health} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function ContainerHealthBadge({ state, health }: { state: string; health?: string }) {
  if (health === "healthy") return <StatusBadge status="ok" label="healthy" />;
  if (health === "unhealthy") return <StatusBadge status="error" label="unhealthy" />;
  if (health === "starting") return <StatusBadge status="warn" label="starting" />;
  if (state === "running") return <StatusBadge status="ok" label="running" />;
  return <StatusBadge status="error" label={state || "unknown"} />;
}
