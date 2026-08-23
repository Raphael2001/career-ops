"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // `?recheck=` is read server-side (models/page.tsx) to bypass the health
  // cache -- a plain router.refresh() would just re-serve the cached read.
  // Harmless on every other tab: they don't read the param, so this just
  // behaves like a normal refresh there.
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => router.push(`${pathname}?recheck=${Date.now()}`))}
      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshCw size={13} strokeWidth={2} className={isPending ? "animate-spin" : ""} aria-hidden="true" />
      {isPending ? "Checking..." : "Recheck now"}
    </button>
  );
}
