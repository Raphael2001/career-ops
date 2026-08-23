import { Panel } from "@/components/Panel";

// Next.js shows this automatically while the async Server Component in
// page.tsx is resolving -- without it, the browser gets nothing at all
// until the full /health sweep finishes (up to ~150s by design, since
// litellm dispatches a real test call to every model), which reads as a
// hung/broken page rather than a slow one.
export default function ModelsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">Models</h1>
        <p className="mt-1 text-sm text-muted">
          Health is cached for 5 minutes so navigating here doesn&apos;t force a live sweep every
          time. Hit Recheck to dispatch a real test call to every model right now.
        </p>
      </div>

      <Panel title="Health">
        <div className="flex items-center gap-3 py-2">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary"
            aria-hidden="true"
          />
          <p className="text-sm text-muted">
            Testing every model live -- this dispatches a real call to each provider and can take
            up to 90-150s, longer if any provider is slow to respond.
          </p>
        </div>
      </Panel>
    </div>
  );
}
