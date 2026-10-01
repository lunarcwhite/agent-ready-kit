"use client";

// Command Palette (TASK-117, P2).
//
// MVP scope only: seven static navigation commands (advanced entity
// search is deferred). Opens with Ctrl/Cmd+K or the button, filters as
// you type, Enter navigates, Escape closes. Focus moves into the input
// on open and returns to the trigger on close; the list uses listbox
// roles so keyboards and screen readers share one behavior.
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FOCUS_RING, cn } from "@/app/components/ui";

interface Command {
  label: string;
  suffix: string;
  hint: string;
}

const COMMANDS: readonly Command[] = [
  { label: "Go to Overview", suffix: "", hint: "Readiness & next action" },
  { label: "Go to Discovery", suffix: "/discovery", hint: "Answer questions" },
  { label: "Go to Decisions", suffix: "/decisions", hint: "Confirm choices" },
  { label: "Go to Issues", suffix: "/issues", hint: "Resolve blockers" },
  { label: "Go to Readiness", suffix: "/readiness", hint: "Why ready?" },
  { label: "Go to Tasks", suffix: "/tasks", hint: "Plan work" },
  { label: "Go to Agent Kit", suffix: "/agent-kit", hint: "Export ZIP" },
];

export default function CommandPalette({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => {
          if (was) triggerRef.current?.focus();
          return !was;
        });
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const matches = COMMANDS.filter((command) =>
    command.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const run = (command: Command) => {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
    router.push(`/projects/${projectId}${command.suffix}`);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          "w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-left text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100",
          FOCUS_RING,
        )}
      >
        Search or jump to…{" "}
        <kbd className="ml-1 rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-800">
          Ctrl K
        </kbd>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Command palette"
          className="absolute inset-x-0 top-full z-30 mt-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches[0]) run(matches[0]);
            }}
            placeholder="Type a destination…"
            aria-label="Command palette"
            aria-controls={listId}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          {matches.length === 0 ? (
            <p className="px-2 py-2 text-sm text-zinc-500 dark:text-zinc-400">No matching destinations.</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Destinations" className="mt-1 max-h-64 overflow-y-auto">
              {matches.map((command) => (
                <li key={command.suffix} role="option" aria-selected="false">
                  <button
                    type="button"
                    onClick={() => run(command)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="font-medium">{command.label}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{command.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
