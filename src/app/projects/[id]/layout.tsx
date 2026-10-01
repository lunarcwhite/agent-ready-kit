"use client";

// Project application shell (TASK-110; design.md §11–§13).
//
// Client boundary, not a server layout, for one reason: the active nav link
// (`aria-current="page"`) is driven by the live pathname via usePathname,
// which is only available in client components. The pure matching logic
// lives in ./nav.ts so it stays unit-testable without React. Child pages
// (discovery/decisions/understanding) are still server components — passing
// them through as {children} preserves their server-component status and
// their inline server actions.
//
// Deliberately no database query here (per shell constraints):
// - the shell renders on every child navigation; fetching the project would
//   duplicate the getProject + authorization query each child page already
//   runs and add shell latency to every route;
// - layout-level failures would mask page-level notFound handling.
// Current-project strategy: the shell shows a params-derived identifier
// (short id + "All projects" back-link) as the always-available anchor; the
// authoritative project name renders in each child page header, which owns
// the project query. TASK-111 (Project Overview) can lift the name into the
// shell once a cached project header query exists.
//
// Known caveat: existing child pages render their own <main> landmark, so
// until they are migrated to sections inside this shell's <main
// id="content"> there are nested main landmarks. This shell intentionally
// imposes no max-width so child pages keep their full width usable.
import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { NAV_SECTIONS, getActiveNav } from "./nav";
import CommandPalette from "./command-palette";
import ThemeToggle from "@/app/components/theme-toggle";
import { FOCUS_RING, cn } from "@/app/components/ui";

function shortProjectId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const pathname = usePathname();
  const activeKey = getActiveNav(pathname ?? "");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 lg:flex-row dark:bg-zinc-950">
      <a
        href="#content"
        className={cn(
          "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-zinc-900 focus:underline",
          FOCUS_RING,
        )}
      >
        Skip to content
      </a>

      <aside className="border-b border-zinc-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 p-4 lg:flex-col lg:items-stretch lg:gap-3 dark:border-zinc-900">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              {/* Placeholder mark: "A" + product name as text per R-23; replace with confirmed logo when brand direction lands. */}
              <span
                aria-hidden="true"
                className="inline-flex h-5 w-5 items-center justify-center rounded bg-zinc-900 text-[11px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                A
              </span>
              Agent Ready Kit
            </p>
            <Link
              href="/projects"
              className={cn(
                "mt-2 inline-block rounded text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100",
                FOCUS_RING,
              )}
            >
              ← All projects
            </Link>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Project
            </p>
            <p className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400" title={projectId}>
              {shortProjectId(projectId)}
            </p>
          </div>
          <nav aria-label="User menu" className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className={cn(
                "rounded-md border border-zinc-300 px-3 py-1 text-xs min-h-[44px] inline-flex items-center font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
                FOCUS_RING,
              )}
            >
              Sign out
            </button>
          </nav>
        </div>
        <div className="px-4 pt-3 lg:pb-0">
          <CommandPalette projectId={projectId} />
        </div>

        <nav
          aria-label="Project sections"
          className="flex gap-5 overflow-x-auto px-4 py-3 lg:flex-col lg:gap-4 lg:overflow-visible"
        >
          {NAV_SECTIONS.map((section) => (
            <div key={section.section} className="shrink-0">
              <h2 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {section.label}
              </h2>
              <ul className="mt-1.5 flex flex-row gap-1 lg:flex-col">
                {section.items.map((item) => {
                  const active = item.key === activeKey;
                  return (
                    <li key={item.key}>
                      <a
                        href={item.href(projectId)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-[44px] items-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors",
                          FOCUS_RING,
                          active
                            ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                        )}
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <p className="mt-auto hidden px-4 py-4 text-[11px] leading-5 text-zinc-500 lg:block dark:text-zinc-400">
          Human decides.
          <br />
          Kit clarifies. Agent executes.
        </p>
      </aside>

      <main id="content" tabIndex={-1} className={cn("min-w-0 flex-1", FOCUS_RING)}>
        {children}
      </main>
    </div>
  );
}
