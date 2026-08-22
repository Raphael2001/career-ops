"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BrainCircuit, Search, Box } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/models", label: "Models", icon: BrainCircuit },
  { href: "/scan", label: "Scan", icon: Search },
  { href: "/containers", label: "Containers", icon: Box },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-surface-raised">
      <div className="border-b border-border px-4 py-4">
        <span className="font-mono text-sm font-semibold tracking-tight text-fg">career-ops</span>
        <span className="ml-1.5 font-mono text-sm text-faint">/monitor</span>
      </div>
      <ul className="flex flex-col gap-0.5 p-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
                  active
                    ? "bg-primary-soft text-primary"
                    : "text-muted hover:bg-surface-hover hover:text-fg"
                }`}
              >
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
