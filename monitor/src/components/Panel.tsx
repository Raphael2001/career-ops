import type { ReactNode } from "react";

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
