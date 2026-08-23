"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

export function TriggerScanButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    setError(null);
    setIsStarting(true);
    try {
      const res = await fetch("/api/scan/trigger", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setIsStarting(false);
    }
  }

  const busy = isStarting || isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => trigger()}
        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play size={13} strokeWidth={2} aria-hidden="true" />
        {disabled ? "Already running" : busy ? "Starting..." : "Run scan now"}
      </button>
      {error && <span className="text-xs text-error">Couldn&apos;t start: {error}</span>}
    </div>
  );
}
