import { Panel } from "@/components/Panel";

export default function UsageLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">Usage</h1>
        <p className="mt-1 text-sm text-muted">Spend and call volume grouped by model. Pick a range below.</p>
      </div>

      <Panel title="Calls by model">
        <div className="flex items-center gap-3 py-2">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary"
            aria-hidden="true"
          />
          <p className="text-sm text-muted">Loading...</p>
        </div>
      </Panel>
    </div>
  );
}
