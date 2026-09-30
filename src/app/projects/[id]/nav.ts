// Project navigation model (TASK-110; design.md §13, route recommendation §93).
//
// Pure module: section grouping, route hrefs, and active-state matching.
// No React, no database, no AI — safe to import from server or client
// components. This file is the single source of truth for project sidebar
// hrefs, so future route changes only need updating here.
//
// Route mapping notes:
// - "Overview" points at the project root (`/projects/:id`, design.md §93
//   line 2653); there is no separate `/overview` route in the recommendation.
//   It is therefore a prefix of every project route — getActiveNav resolves
//   that with longest-prefix matching so deeper pages still highlight.
// - Specification pages live under `/specifications/*` (design.md §93).
// - Hrefs not yet backed by a page (overview, specifications, issues,
//   readiness, tasks, agent-kit) are provisional until their TASKs land;
//   the sidebar links to them anyway so the shell defines the target URLs.
export interface NavItem {
  /** Stable key used for active-state matching (never a display string). */
  key: string;
  label: string;
  href: (projectId: string) => string;
}

export interface NavSection {
  /** Stable section key. */
  section: string;
  label: string;
  items: NavItem[];
}

function projectRoot(projectId: string): string {
  return `/projects/${projectId}`;
}

function specifications(projectId: string, page: string): string {
  return `${projectRoot(projectId)}/specifications/${page}`;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    section: "overview",
    label: "Overview",
    items: [{ key: "overview", label: "Overview", href: (id) => projectRoot(id) }],
  },
  {
    section: "define",
    label: "Define",
    items: [
      { key: "discovery", label: "Discovery", href: (id) => `${projectRoot(id)}/discovery` },
      { key: "decisions", label: "Decisions", href: (id) => `${projectRoot(id)}/decisions` },
    ],
  },
  {
    section: "specify",
    label: "Specify",
    items: [
      { key: "product", label: "Product", href: (id) => specifications(id, "product") },
      {
        key: "architecture",
        label: "Architecture",
        href: (id) => specifications(id, "architecture"),
      },
      { key: "data", label: "Data", href: (id) => specifications(id, "data") },
      { key: "design", label: "Design", href: (id) => specifications(id, "design") },
      { key: "ai", label: "AI", href: (id) => specifications(id, "ai") },
    ],
  },
  {
    section: "validate",
    label: "Validate",
    items: [
      { key: "issues", label: "Issues", href: (id) => `${projectRoot(id)}/issues` },
      { key: "readiness", label: "Readiness", href: (id) => `${projectRoot(id)}/readiness` },
    ],
  },
  {
    section: "execute",
    label: "Execute",
    items: [{ key: "tasks", label: "Tasks", href: (id) => `${projectRoot(id)}/tasks` }],
  },
  {
    section: "ship",
    label: "Ship",
    items: [{ key: "agent-kit", label: "Agent Kit", href: (id) => `${projectRoot(id)}/agent-kit` }],
  },
];

/** Flattened item list in section order. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/**
 * Normalize a path for comparison: strip query/hash and trailing slashes.
 * Matching stays case-sensitive (Next.js routes are case-sensitive).
 */
export function normalizeNavPath(pathname: string): string {
  const withoutSuffix = pathname.split(/[?#]/, 1)[0] ?? "";
  const trimmed = withoutSuffix.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * True when `pathname` is exactly `href` or nested under it on a segment
 * boundary, so `/projects/abc/decisions/detail` is active for the Decisions
 * link but `/projects/abc/discoveries` is not active for Discovery.
 *
 * Note: the Overview href (project root) is a prefix of every project route
 * by design — use getActiveNav, not this helper alone, to pick the single
 * link that gets `aria-current="page"`.
 */
export function isNavActive(pathname: string, href: string): boolean {
  const path = normalizeNavPath(pathname);
  const target = normalizeNavPath(href);
  if (target === "/") return path === "/";
  return path === target || path.startsWith(`${target}/`);
}

// Sentinel project id used to derive each item's path suffix after
// `/projects/:id`. Href builders are plain string interpolation over the id,
// so sampling with a collision-proof sentinel is exact.
const SENTINEL = "__ark_project__";
const SCOPE_PREFIX = `/projects/${SENTINEL}`;

const ITEM_SUFFIXES: ReadonlyMap<string, string> = new Map(
  NAV_ITEMS.map((item) => [item.key, item.href(SENTINEL).slice(SCOPE_PREFIX.length)]),
);

/**
 * Return the active nav item key for a pathname, or null when the path is
 * outside the project scope or matches no known section.
 *
 * Longest-prefix match: nested routes (query/detail views such as
 * `/projects/abc/decisions?code=DEC-AUTH-001` or
 * `/projects/abc/specifications/product/revisions`) resolve to their parent
 * section, and deeper matches beat the Overview root prefix.
 */
export function getActiveNav(pathname: string): string | null {
  const path = normalizeNavPath(pathname);
  const scope = /^\/projects\/([^/?#]+)(\/.*)?$/.exec(path);
  // "new" is a reserved sibling route (/projects/new), not a project id.
  if (!scope || scope[1] === "new") return null;
  const rest = normalizeNavPath(scope[2] ?? "");
  const tail = rest === "/" ? "" : rest;
  let best: { key: string; length: number } | null = null;
  for (const item of NAV_ITEMS) {
    const suffix = ITEM_SUFFIXES.get(item.key) ?? "";
    const matches = suffix === "" ? tail === "" : tail === suffix || tail.startsWith(`${suffix}/`);
    if (matches && (!best || suffix.length > best.length)) {
      best = { key: item.key, length: suffix.length };
    }
  }
  return best?.key ?? null;
}
