// Landing (SCREEN-001 per design.md §92; TASK-140 gate respected — public page).
//
// Static server component, no client JS. Calm developer-tool hero:
// neutral surfaces, subtle borders, one primary CTA (design.md §96).
// Answers "What is this?" and "What should I do next?" without dashboard
// noise (§108) or chat/document syndrome (§109–§110).
import type { Metadata } from "next";
import Link from "next/link";
import ThemeToggle from "./components/theme-toggle";
import { Badge } from "./components/ui";
import { SITE_DESCRIPTION, SITE_TITLE, appJsonLd, getSiteUrl } from "./seo";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

const FLOW = [
  { step: "Tell", body: "Describe your idea in your own words." },
  { step: "Clarify", body: "Answer only the discovery questions that matter." },
  { step: "Decide", body: "Confirm important decisions. Nothing is silently assumed." },
  { step: "Specify", body: "PRD, architecture, data, and design compile from one state." },
  { step: "Validate", body: "See exactly why the project is or isn't ready." },
  { step: "Export", body: "Download an Agent Kit a coding agent can execute." },
] as const;

const INCLUDES = [
  "README.md",
  "AGENTS.md",
  "context.md",
  "docs/PRD.md",
  "docs/architecture.md",
  "docs/database-schema.md",
  "docs/design.md",
  "docs/tasks.md",
  ".agent-ready/manifest.json",
] as const;

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd(getSiteUrl())) }}
      />
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            {/* Placeholder mark: "A" + product name as text per R-23; replace with confirmed logo when brand direction lands. */}
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              A
            </span>
            Agent Ready Kit
          </p>
          <nav aria-label="Account" className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Sign in
            </Link>
            <Link
              href="/projects/new"
              className="inline-flex min-h-[44px] items-center rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Start building
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-6 py-16">
        <section aria-labelledby="hero" className="max-w-2xl">
          <Badge status="DRAFT">MVP · Structured discovery → Agent Kit</Badge>
          <h1 id="hero" className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Turn a software idea into context a coding agent can execute.
          </h1>
          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            Human decides. Agent Ready Kit clarifies. Coding agent executes.
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Describe your idea, answer focused questions, confirm decisions, and export a
            validated package: PRD, architecture, data, design, tasks, and agent
            instructions: with stable IDs and explicit readiness.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/projects/new"
              className="inline-flex min-h-[44px] items-center rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Describe your idea
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
            No silent assumptions: recommendations stay recommendations until you confirm.
          </p>
        </section>

        <section aria-labelledby="flow">
          <h2 id="flow" className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            How it works
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FLOW.map((item, i) => (
              <li
                key={item.step}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <p className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <p className="mt-1 text-sm font-semibold">{item.step}</p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{item.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="kit" className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 id="kit" className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              What you download
            </h2>
            <p className="mt-2 text-xl font-semibold tracking-tight">
              One Agent Kit. Everything the coding agent needs.
            </p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Generated deterministically from your approved project state: same input,
              same package. Optional AI files are omitted when they don&apos;t apply.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/projects/new"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Generate your kit
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Open workspace
              </Link>
            </div>
          </div>
          <div
            aria-label="Agent Kit contents"
            className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <p className="font-sans text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              your-project/
            </p>
            <ul className="mt-1">
              {INCLUDES.map((file) => (
                <li key={file}>├── {file}</li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="principles">
          <h2 id="principles" className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Principles
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="text-sm font-semibold">You stay authoritative</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                AI recommends and structures. Confirmed decisions are never silently
                replaced.
              </p>
            </li>
            <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="text-sm font-semibold">Readiness is explainable</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                No black-box score. Every dimension links to the blocker or decision
                behind it.
              </p>
            </li>
            <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="text-sm font-semibold">IDs survive everything</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                FR-014 stays FR-014 across regenerations, so traceability never breaks.
              </p>
            </li>
          </ul>
        </section>
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-6 py-5 text-xs text-zinc-500 dark:text-zinc-500">
          <p>Agent Ready Kit: calm technical partner for implementation-ready specs.</p>
          <p>
            <Link href="/login" className="inline-flex min-h-[44px] items-center hover:underline">
              Sign in
            </Link>{" "}
            ·{" "}
            <Link href="/register" className="inline-flex min-h-[44px] items-center hover:underline">
              Create account
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
