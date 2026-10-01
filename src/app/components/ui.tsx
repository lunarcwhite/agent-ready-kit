// Shared UI primitives (docs/design.md §94–§95, §111–§114).
//
// One visual language for every workspace: PageHeader answers "Where am I?",
// Section groups one concern, Badge always pairs color with text/icon
// (never color-only, §83), Chip renders stable IDs in monospace (§89),
// Progress is an accessible progressbar (no fake percentages, §72–§73).
//
// Server-component safe: no client JS, no event handlers. Interactive pages
// keep their server actions; they only borrow these class constants so a
// <button formAction={...}> keeps working unchanged.
//
// Calm by construction: neutral surfaces, subtle borders, radius 6–12px,
// minimal shadows (popover/dialog only), restrained zinc accent.
//
// R-31 reasons (one line each): zinc neutral because the product is a working
// tool, not marketing, so chrome defers to content (design.md §6–§7); Badge is
// pill+glyph+text because status must read without color (§83) and pills are
// reserved for status/filter tags (§113); Chip is monospace because stable IDs
// are copied into coding-agent prompts (§89); exactly one btnPrimary per screen
// because each screen has one dominant next action (§96); arrows appear only on
// back-navigation because every other CTA must be self-explanatory (§96);
// system font stack because it needs no dependency and always renders
// (boring is a feature here); 44px minimum hit areas per R-03 mobile rule.
import type { ReactNode } from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Shared keyboard-focus ring for custom interactive elements. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100";

/** Single primary action per screen (design.md §96). 44px minimum (R-03). */
export const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200";

export const btnSecondary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800";

export const btnGhost =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

export const inputCls =
  "w-full min-h-[44px] rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 hover:border-zinc-400 focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:hover:border-zinc-600 dark:focus:border-zinc-100";

export const cardCls =
  "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

export const mutedText = "text-sm text-zinc-600 dark:text-zinc-400";
export const faintText = "text-sm text-zinc-500 dark:text-zinc-400";
export const sectionLabel =
  "text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

/* ------------------------------------------------------------------ */
/* Page header: eyebrow (back link / context) + title + description.    */
/* ------------------------------------------------------------------ */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {description ? <p className={cn("mt-1 max-w-2xl", mutedText)}>{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cn("inline-flex min-h-[44px] items-center text-sm text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100", FOCUS_RING, "rounded")}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Section: one concern per card, quiet heading, optional action.       */
/* ------------------------------------------------------------------ */

export function Section({
  title,
  hint,
  action,
  children,
  labelledBy,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section aria-label={typeof title === "string" ? title : undefined} aria-labelledby={labelledBy} className={cardCls}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {hint ? <p className={cn("mt-0.5", faintText)}>{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Badge: status with icon + text (never color-only, design.md §83).   */
/* ------------------------------------------------------------------ */

type Tone = "green" | "amber" | "red" | "blue" | "gray";

const TONE_CLS: Record<Tone, string> = {
  green:
    "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  blue: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  gray: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};

function toneForStatus(status: string): { tone: Tone; glyph: string } {
  const s = status.toUpperCase();
  if (["CONFIRMED", "RESOLVED", "READY", "CURRENT", "COMPLETED", "IMPLEMENTATION_READY", "SUCCEEDED", "ACTIVE"].includes(s))
    return { tone: "green", glyph: "✓" };
  if (["RECOMMENDED", "NEEDS_REVIEW", "REVIEW_REQUIRED", "PARTIAL", "PROPOSED", "STALE", "UPDATE_AVAILABLE", "HIGH"].includes(s))
    return { tone: "amber", glyph: "◇" };
  if (["BLOCKER", "BLOCKED", "FAILED", "CRITICAL", "OPEN"].includes(s))
    return { tone: "red", glyph: "!" };
  if (["IN_PROGRESS", "RUNNING", "INFO", "DRAFT", "DISCOVERY", "GENERATING"].includes(s))
    return { tone: "blue", glyph: "●" };
  return { tone: "gray", glyph: "•" };
}

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  const { tone, glyph } = toneForStatus(status);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLS[tone],
      )}
    >
      <span aria-hidden="true">{glyph}</span>
      {children ?? status.replaceAll("_", " ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Chip: stable identifier, monospace, easy to copy (design.md §89).   */
/* ------------------------------------------------------------------ */

export function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code
      title={title}
      className="inline-flex items-center rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
    >
      {children}
    </code>
  );
}

/* ------------------------------------------------------------------ */
/* Progress: determinate bar with accessible name + text fallback.      */
/* ------------------------------------------------------------------ */

export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className={faintText}>{label}</p>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{clamped}%</p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      >
        <div className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LifecycleSteps: DISCOVERY → DRAFT → NEEDS_REVIEW → READY (§15).     */
/* ------------------------------------------------------------------ */

const LIFECYCLE = ["DISCOVERY", "DRAFT", "NEEDS_REVIEW", "IMPLEMENTATION_READY"] as const;

export function LifecycleSteps({ current }: { current: string }) {
  const idx = Math.max(
    0,
    LIFECYCLE.indexOf(current as (typeof LIFECYCLE)[number]),
  );
  return (
    <ol aria-label="Project lifecycle" className="flex items-center gap-1.5">
      {LIFECYCLE.map((step, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={step} className="flex items-center gap-1.5">
            <span
              aria-current={active ? "step" : undefined}
              title={step.replaceAll("_", " ")}
              className={cn(
                "inline-block h-1.5 w-6 rounded-full",
                done || active ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-800",
              )}
            />
            <span className="sr-only">
              {step.replaceAll("_", " ")}
              {active ? " (current)" : done ? " (done)" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
