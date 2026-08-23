"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square } from "lucide-react";

export function ScanControlButton({ running }: { running: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string) {
    setError(null);
    setIsBusy(true);
    try {
      const res = await fetch(path, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setIsBusy(false);
    }
  }

  function onClick() {
    if (running) {
      // Progress isn't lost -- portals.yml is written (and git-synced)
      // incrementally per company as the scan finds them, not only at the
      // end -- but a full pass runs for hours, so a stray click shouldn't
      // silently kill it.
      if (!window.confirm("Stop the discovery scan? It'll pick back up wherever it left off next run.")) {
        return;
      }
      call("/api/scan/stop");
    } else {
      call("/api/scan/trigger");
    }
  }

  const busy = isBusy || isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          running
            ? "border-error/40 text-error hover:bg-error/10"
            : "border-border text-muted hover:bg-surface-hover hover:text-fg"
        }`}
      >
        {running ? (
          <Square size={13} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Play size={13} strokeWidth={2} aria-hidden="true" />
        )}
        {busy ? "Working..." : running ? "Stop scan" : "Run scan now"}
      </button>
      {error && <span className="text-xs text-error">Failed: {error}</span>}
    </div>
  );
}
