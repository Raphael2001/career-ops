"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RANGE_PRESETS, type RangePreset } from "@/lib/dateRange";

export function DateRangeFilter({
  activePreset,
  activeFrom,
  activeTo,
}: {
  activePreset: RangePreset | null;
  activeFrom?: string;
  activeTo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(activeFrom ?? "");
  const [to, setTo] = useState(activeTo ?? "");

  function applyPreset(value: RangePreset) {
    startTransition(() => router.push(`${pathname}?range=${value}`));
  }

  function applyCustom() {
    if (!from || !to) return;
    startTransition(() => router.push(`${pathname}?from=${from}&to=${to}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={isPending}
            onClick={() => applyPreset(p.value)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              activePreset === p.value
                ? "bg-primary-soft text-primary"
                : "text-muted hover:bg-surface-hover hover:text-fg"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg"
          aria-label="From date"
        />
        <span className="text-xs text-faint">to</span>
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg"
          aria-label="To date"
        />
        <button
          type="button"
          disabled={isPending || !from || !to}
          onClick={applyCustom}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
