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

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

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
    <div className="flex min-h-screen flex-col lg:flex-row">
      <a
        href="#content"
        className={`sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-zinc-900 focus:underline ${FOCUS_RING}`}
      >
        Skip to content
      </a>

      <aside className="border-b border-zinc-200 lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 p-4 lg:flex-col lg:items-stretch">
          <div className="min-w-0">
            <Link
              href="/projects"
              className={`text-sm text-zinc-500 hover:underline ${FOCUS_RING} rounded`}
            >
              ← All projects
            </Link>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Project
            </p>
            <p className="truncate font-mono text-sm" title={projectId}>
              {shortProjectId(projectId)}
            </p>
          </div>
          <nav aria-label="User menu">
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className={`rounded border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-50 ${FOCUS_RING}`}
            >
              Sign out
            </button>
          </nav>
        </div>

        <nav
          aria-label="Project sections"
          className="flex gap-5 overflow-x-auto px-4 pb-4 lg:flex-col lg:gap-3 lg:overflow-visible lg:pt-0"
        >
          {NAV_SECTIONS.map((section) => (
            <div key={section.section} className="shrink-0">
              <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {section.label}
              </h2>
              <ul className="mt-1 flex flex-row gap-1 lg:flex-col">
                {section.items.map((item) => {
                  const active = item.key === activeKey;
                  return (
                    <li key={item.key}>
                      <a
                        href={item.href(projectId)}
                        aria-current={active ? "page" : undefined}
                        className={`block whitespace-nowrap rounded px-2 py-1 text-sm ${FOCUS_RING} ${
                          active
                            ? "bg-zinc-900 font-semibold text-white"
                            : "text-zinc-700 hover:bg-zinc-50 hover:underline"
                        }`}
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
      </aside>

      <main id="content" tabIndex={-1} className={`min-w-0 flex-1 ${FOCUS_RING}`}>
        {children}
      </main>
    </div>
  );
}
