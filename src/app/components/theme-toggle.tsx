"use client";

// Theme toggle (TASK-144).
//
// Explicit user choice persisted in localStorage: "light", "dark", or
// unset (follow the OS). The `.dark` class on <html> drives the
// `dark:` variants (globals.css); setting it here in an effect plus a
// blocking init script in the root layout avoids a light flash without
// server/client markup mismatch (the server renders choice-agnostic
// markup — only the class differs, applied before paint).
import { useEffect, useState } from "react";

type Choice = "light" | "dark" | "system";

function apply(choice: Choice): void {
  const root = document.documentElement;
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

export default function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem("ark-theme");
    const initial: Choice = saved === "light" || saved === "dark" ? saved : "system";
    setChoice(initial);
    apply(initial);
  }, []);

  const cycle = () => {
    const next: Choice = choice === "light" ? "dark" : choice === "dark" ? "system" : "light";
    setChoice(next);
    if (next === "system") window.localStorage.removeItem("ark-theme");
    else window.localStorage.setItem("ark-theme", next);
    apply(next);
  };

  const label = choice === "light" ? "Light" : choice === "dark" ? "Dark" : "System";
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Color theme: ${label}. Activate to change.`}
      title={`Theme: ${label} (click to change)`}
      className="rounded-md border border-zinc-300 px-3 py-2 text-sm min-h-[44px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {label} theme
    </button>
  );
}
