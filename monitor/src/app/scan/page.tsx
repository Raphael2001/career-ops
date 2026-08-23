import { getScanStatus } from "@/lib/remote";
import { Panel } from "@/components/Panel";
import { StatusBadge } from "@/components/StatusBadge";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScanControlButton } from "@/components/ScanControlButton";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const scan = await getScanStatus();

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={15_000} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-fg">Discovery scan</h1>
          <p className="mt-1 text-sm text-muted">
            deploy/discover-companies-native.sh -- daily at 00:00 Israel time, or run manually.
          </p>
        </div>
        {!scan.error && <ScanControlButton running={scan.running} />}
      </div>

      {scan.error ? (
        <Panel title="Status">
          <p className="text-sm text-error">Can&apos;t reach the host: {scan.error}</p>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Panel title="State">
              <StatusBadge status={scan.running ? "ok" : "neutral"} label={scan.running ? "running" : "idle"} />
            </Panel>
            <Panel title="Current company">
              <p className="truncate text-sm text-fg">{scan.currentCompany ?? "--"}</p>
            </Panel>
            <Panel title="Last started">
              <p className="font-mono text-sm text-fg">{scan.lastStartedAt ?? "--"}</p>
            </Panel>
          </div>

          <Panel title="Recent log">
            {scan.recentLines.length === 0 ? (
              <p className="text-sm text-muted">No log output yet.</p>
            ) : (
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
                {scan.recentLines.join("\n")}
              </pre>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
