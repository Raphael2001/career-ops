import { getSpendLogs } from "@/lib/litellm";
import { resolveRange } from "@/lib/dateRange";
import { Panel } from "@/components/Panel";
import { UsageTable } from "@/components/UsageTable";
import { DateRangeFilter } from "@/components/DateRangeFilter";

export const dynamic = "force-dynamic";

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const { start, end, label, preset } = resolveRange(params);

  let entries: Awaited<ReturnType<typeof getSpendLogs>>["entries"] = [];
  let error: string | null = null;
  try {
    entries = (await getSpendLogs(start, end)).entries;
  } catch (e) {
    error = String(e);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">Usage</h1>
        <p className="mt-1 text-sm text-muted">Spend and call volume grouped by model. Pick a range below.</p>
      </div>

      <DateRangeFilter activePreset={preset} activeFrom={params.from} activeTo={params.to} />

      <Panel title={`Calls by model -- ${label}`}>
        {error ? (
          <p className="text-sm text-error">Usage fetch failed: {error}</p>
        ) : (
          <UsageTable entries={entries} />
        )}
      </Panel>
    </div>
  );
}
