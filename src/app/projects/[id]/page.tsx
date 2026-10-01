// Project Overview (SCREEN-005 per design.md; TASK-111).
//
// Single glance over project health (TASK-081 readiness, TASK-082
// lifecycle, TASK-070 issue counts, unresolved decisions, TASK-084 next
// action) with links into the workspace that resolves each item. No
// analytics beyond what drives the next action — no charts, no vanity
// metrics. Read-only: every number links somewhere actionable.
//
// Server component, no client JS — same convention as the workspaces.
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import { calculateReadiness } from "@/modules/readiness/engine";
import { recommendNextAction } from "@/modules/readiness/next-action";
import { listIssues } from "@/modules/validation/issues";
import { listDecisions } from "@/modules/decisions/decisions";
import {
  BackLink,
  Badge,
  LifecycleSteps,
  PageHeader,
  Progress,
  Section,
  btnPrimary,
} from "@/app/components/ui";

const NEXT_ACTION_LABEL: Record<string, string> = {
  RESOLVE_BLOCKER: "Resolve blockers",
  RESOLVE_ASSUMPTION: "Resolve assumptions",
  CONTINUE_DISCOVERY: "Continue discovery",
  CONFIRM_DECISION: "Confirm decisions",
  REVIEW_SPEC_CHANGES: "Review spec changes",
  GENERATE_TASKS: "Generate tasks",
  EXPORT_KIT: "Export Agent Kit",
};

const NEXT_ACTION_HREF: Record<string, string> = {
  RESOLVE_BLOCKER: "issues",
  RESOLVE_ASSUMPTION: "issues",
  CONTINUE_DISCOVERY: "discovery",
  CONFIRM_DECISION: "decisions",
  REVIEW_SPEC_CHANGES: "specifications/changes",
  GENERATE_TASKS: "tasks",
  EXPORT_KIT: "agent-kit",
};

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id: projectId } = await params;
  const db = getDb();

  try {
    await getProject(db, user.id, projectId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) notFound();
    throw error;
  }

  const [project, report, issues, decisions, next] = await Promise.all([
    getProject(db, user.id, projectId),
    calculateReadiness(db, user.id, projectId),
    listIssues(db, user.id, projectId, { status: "OPEN" }),
    listDecisions(db, user.id, projectId),
    recommendNextAction(db, user.id, projectId),
  ]);

  const blockers = issues.filter(
    (issue) => issue.severity === "BLOCKER" || issue.severity === "HIGH",
  );
  const unresolved = decisions.filter((row) => row.status === "UNRESOLVED").length;
  const base = `/projects/${projectId}`;
  const nextHref = `${base}/${NEXT_ACTION_HREF[next.action] ?? "issues"}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← All projects</BackLink>}
        title={project.project.name}
        description={
          <>
            {report.ready ? "Implementation ready: " : "Not ready yet: "}
            {report.overallScore}% ready ·{" "}
            <span className="text-zinc-500 dark:text-zinc-400">
              {project.project.description ?? "Keep answering what matters; the kit follows."}
            </span>
          </>
        }
        meta={
          <>
            <Badge status={project.project.lifecycleState} />
            <Badge status={report.ready ? "READY" : "DRAFT"}>
              {report.ready ? "Implementation ready" : `${report.overallScore}% ready`}
            </Badge>
            <LifecycleSteps current={project.project.lifecycleState} />
          </>
        }
        actions={
          <Link href={nextHref} className={btnPrimary}>
            {NEXT_ACTION_LABEL[next.action] ?? next.action}
          </Link>
        }
      />

      <section
        aria-label="Next best action"
        className="rounded-lg border border-zinc-900 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-950"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Next best action
        </h2>
        <p className="mt-1 text-lg font-semibold tracking-tight">
          <Link href={nextHref} className="hover:underline">
            {NEXT_ACTION_LABEL[next.action] ?? next.action}
          </Link>
        </p>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{next.reason}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          href={`${base}/readiness`}
          className="rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Readiness</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{report.overallScore}%</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {report.ready ? "Ready to export" : `${blockers.length} blocking · View dimensions →`}
          </p>
        </Link>
        <Link
          href={`${base}/issues`}
          className="rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Open issues</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {issues.length} <span className="text-sm font-normal text-zinc-500">({blockers.length} blocking)</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Resolve blockers first →</p>
        </Link>
        <Link
          href={`${base}/decisions`}
          className="rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Unresolved decisions
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{unresolved}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Confirm what matters →</p>
        </Link>
      </div>

      <Section
        title="Readiness by dimension"
        hint="Deterministic criteria: click through to see exactly what's missing."
        action={
          <Link
            href={`${base}/readiness`}
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Open readiness →
          </Link>
        }
      >
        {report.dimensions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No dimensions computed yet.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {report.dimensions.slice(0, 4).map((dim) => (
              <li key={dim.dimension}>
                <Progress value={dim.score} label={dim.dimension.replaceAll("_", " ")} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}
