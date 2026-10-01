// Readiness Workspace (SCREEN-018 per design.md; TASK-083).
//
// Read-only view over the deterministic readiness report (TASK-081) and the
// project lifecycle (TASK-082): overall score and ready state, lifecycle
// state, per-dimension scores with expandable criteria, and the blocker
// list with links to the workspace that resolves each one. Blockers render
// first and always — a high percentage never hides them.
//
// Server component, no client JS — same convention as Issues/Tasks.
// Dimension detail renders inline via ?dimension=; recompute is an explicit
// server action (GET stays read-only, the move commits through
// refreshLifecycle with its history row).
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  BackLink,
  Badge,
  Chip,
  PageHeader,
  Progress,
  btnPrimary,
  btnSecondary,
} from "@/app/components/ui";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import { refreshLifecycle } from "@/modules/projects/lifecycle";
import {
  calculateReadiness,
  type DimensionScore,
} from "@/modules/readiness/engine";
import {
  READINESS_DIMENSIONS,
  criteriaForDimension,
} from "@/modules/readiness/rules";

async function refreshAction(projectId: string): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  await refreshLifecycle(getDb(), user.id, projectId);
  redirect(`/projects/${projectId}/readiness`);
}

function dimensionDetail(
  dimension: string,
  scores: DimensionScore[],
): { score: DimensionScore | null; criteria: { key: string; text: string }[] } {
  const score = scores.find((row) => row.dimension === dimension) ?? null;
  const criteria = criteriaForDimension(dimension).map((entry) => ({
    key: entry.key,
    text: entry.criteria,
  }));
  return { score, criteria };
}

export default async function ReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ dimension?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id: projectId } = await params;
  const query = (await searchParams) ?? {};
  const db = getDb();

  try {
    await getProject(db, user.id, projectId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) notFound();
    throw error;
  }

  const [project, report] = await Promise.all([
    getProject(db, user.id, projectId),
    calculateReadiness(db, user.id, projectId),
  ]);
  const activeDimension = query.dimension ?? null;
  // Unknown dimensions previously threw inside criteriaForDimension (error
  // boundary). Validate first: unknown values render an alert instead, and
  // valid-dimension rendering below is unchanged.
  const knownDimension =
    activeDimension === null ||
    (READINESS_DIMENSIONS as readonly string[]).includes(activeDimension);
  const detail =
    activeDimension === null || !knownDimension
      ? null
      : dimensionDetail(activeDimension, report.dimensions);
  const base = `/projects/${projectId}/readiness`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← Projects</BackLink>}
        title="Readiness"
        description={`${report.overallScore}% ready · Lifecycle: ${project.project.lifecycleState} · ${
          report.ready ? "Implementation ready" : "Not ready yet"
        }`}
        meta={
          <Badge status={report.ready ? "READY" : "BLOCKED"}>
            {report.ready ? "Implementation ready" : "Not ready yet"}
          </Badge>
        }
      />

      {report.blockers.length > 0 && (
        <section aria-label="Blockers" className="rounded-lg border border-zinc-900 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold tracking-tight">
            {report.blockers.length} blocker{report.blockers.length === 1 ? "" : "s"} to resolve
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {report.blockers.map((blocker) =>
              blocker.kind === "criterion" ? (
                <li key={`${blocker.kind}:${blocker.key}`} className="flex flex-wrap items-center gap-2">
                  <Badge status={blocker.severity}>{blocker.severity}</Badge>
                  <Link href={`/projects/${projectId}/issues`} className="text-zinc-900 underline dark:text-zinc-100">
                    {blocker.title}
                  </Link>
                </li>
              ) : (
                <li key={`${blocker.kind}:${blocker.key}`} className="flex flex-wrap items-center gap-2">
                  <Badge status={blocker.severity}>{blocker.severity}</Badge>
                  {blocker.title}
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      <section aria-label="Dimensions">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Dimensions</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {report.dimensions.map((row) => (
            <li key={row.dimension} className="rounded-lg border border-zinc-200 bg-white p-3.5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {row.dimension}
                    {row.blocking && <Badge status="BLOCKED">blocking</Badge>}
                  </p>
                  <div className="mt-2">
                    <Progress value={row.score} label={`${row.dimension} score`} />
                  </div>
                </div>
                <a
                  href={`${base}?dimension=${encodeURIComponent(row.dimension)}`}
                  className={btnSecondary}
                >
                  Criteria
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {activeDimension !== null && !knownDimension && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Unknown dimension. Pick a dimension below.
        </p>
      )}
      {detail && (
        <section aria-label="Dimension criteria" className="rounded-lg border border-zinc-900 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold tracking-tight">{activeDimension} criteria</h2>
          {detail.score && detail.score.deductions.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {detail.score.deductions.map((deduction) => (
                <li key={deduction.criterionKey} className="flex flex-wrap items-center gap-2">
                  <Chip>{deduction.criterionKey}</Chip>
                  <span>
                    (−{deduction.deduction}
                    {deduction.blocking ? ", blocking" : ""})
                  </span>
                  {deduction.blocking && <Badge status="BLOCKED">blocking</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No violations in this dimension.</p>
          )}
          <h3 className="mt-4 text-sm font-medium">All criteria</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            {detail.criteria.map((criterion) => (
              <li key={criterion.key} className="flex flex-wrap items-baseline gap-2">
                <Chip>{criterion.key}</Chip> <span>{criterion.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={refreshAction.bind(null, projectId)}>
        <button
          type="submit"
          className={btnPrimary}
        >
          Recompute readiness & lifecycle
        </button>
      </form>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Full dimension list: {READINESS_DIMENSIONS.join(", ")}.
      </p>
    </main>
  );
}
