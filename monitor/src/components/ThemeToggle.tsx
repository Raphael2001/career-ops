"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

const STORAGE_KEY = "monitor-theme";

export function ThemeToggle() {
  // Real value comes from the DOM class the no-flash inline script (in
  // layout.tsx) already set before hydration -- read it once on mount
  // rather than guessing, so the icon never flips right after paint.
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark === null ? (
        <span className="h-4 w-4" aria-hidden="true" />
      ) : isDark ? (
        <Sun size={16} strokeWidth={2} aria-hidden="true" />
      ) : (
        <Moon size={16} strokeWidth={2} aria-hidden="true" />
      )}
      {isDark === null ? "Theme" : isDark ? "Light theme" : "Dark theme"}
    </button>
  );
}
