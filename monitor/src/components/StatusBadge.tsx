type Status = "ok" | "warn" | "error" | "neutral";

const STYLES: Record<Status, { dot: string; text: string; bg: string }> = {
  ok: { dot: "bg-ok", text: "text-ok", bg: "bg-ok-soft" },
  warn: { dot: "bg-warn", text: "text-warn", bg: "bg-warn-soft" },
  error: { dot: "bg-error", text: "text-error", bg: "bg-error-soft" },
  neutral: { dot: "bg-neutral", text: "text-neutral", bg: "bg-neutral-soft" },
};

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.bg} ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
