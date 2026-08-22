"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-fetches server components on an interval so status pages stay live
// without a manual reload. 20s balances freshness against /health's own
// cost (it dispatches a real test call to every configured model).
export function AutoRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
