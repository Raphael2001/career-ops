export type RangePreset = "today" | "7d" | "30d" | "90d";

export const RANGE_PRESETS: { value: RangePreset; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 0 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
];

const DEFAULT_PRESET: RangePreset = "7d";

export type ResolvedRange = {
  start: Date;
  end: Date;
  label: string;
  // null when the range came from a custom from/to pick, not a preset --
  // lets the filter UI and page title distinguish the two.
  preset: RangePreset | null;
};

// Custom from/to (both present) wins over `range`; otherwise falls back to
// a preset, defaulting to 7 days if `range` is missing or unrecognized.
export function resolveRange(params: { range?: string; from?: string; to?: string }): ResolvedRange {
  if (params.from && params.to) {
    const start = new Date(`${params.from}T00:00:00.000Z`);
    const end = new Date(`${params.to}T23:59:59.999Z`);
    return { start, end, label: `${params.from} to ${params.to}`, preset: null };
  }

  const preset = RANGE_PRESETS.find((p) => p.value === params.range) ?? RANGE_PRESETS.find((p) => p.value === DEFAULT_PRESET)!;
  const end = new Date();
  const start =
    preset.value === "today"
      ? (() => {
          const d = new Date();
          d.setUTCHours(0, 0, 0, 0);
          return d;
        })()
      : new Date(end.getTime() - preset.days * 24 * 60 * 60 * 1000);

  return { start, end, label: preset.label, preset: preset.value };
}
