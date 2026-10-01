// Initial Understanding Review (SCREEN-006 per design.md §92; TASK-051).
//
// Trust checkpoint between Idea Analyst (TASK-050) and Discovery: shows what
// the system understood (summary, users, capabilities, constraints, unclear
// areas, separate assumptions), then records the human verdict. Confirming
// initializes canonical discovery state idempotently; correcting edits the
// project input and re-runs analysis on the next view.
//
// Server component, no client JS — same convention as the Discovery
// workspace. Analysis runs per visit through the orchestrator; failures
// render the recoverable state from design.md §74 with approved content
// untouched. Assumptions render with text glyphs plus labels, never as
// confirmed facts (UX-INV-003, AGENTS.md §66).
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject, updateProject } from "@/modules/projects/repository";
import { ProjectNotFoundError, ProjectValidationError } from "@/modules/projects/errors";
import { getDiscoveryMap } from "@/modules/discovery/discovery";
import { analyzeIdea, IdeaAnalysisError } from "@/modules/discovery/idea-analyst";
import { buildUnderstandingView, confirmUnderstanding } from "@/modules/discovery/understanding";
import { DiscoveryValidationError } from "@/modules/discovery/errors";
import {
  BackLink,
  Badge,
  PageHeader,
  btnPrimary,
  btnSecondary,
  cardCls,
  inputCls,
} from "@/app/components/ui";

async function confirmAction(projectId: string): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  try {
    await confirmUnderstanding(getDb(), user.id, projectId);
  } catch {
    redirect(`/projects/${projectId}/understanding?error=save`);
  }
  redirect(`/projects/${projectId}/discovery`);
}

async function correctAction(projectId: string, formData: FormData): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  const idea = String(formData.get("idea") ?? "").trim();
  const targetUsers = String(formData.get("targetUsers") ?? "").trim() || null;
  const constraints = String(formData.get("constraints") ?? "").trim() || null;
  if (idea === "") redirect(`/projects/${projectId}/understanding?error=empty`);
  try {
    await updateProject(getDb(), user.id, projectId, { idea, targetUsers, constraints });
  } catch (error) {
    if (
      error instanceof ProjectValidationError ||
      error instanceof DiscoveryValidationError ||
      error instanceof ProjectNotFoundError
    ) {
      redirect(`/projects/${projectId}/understanding?error=invalid`);
    }
    throw error;
  }
  redirect(`/projects/${projectId}/understanding`);
}

function Section({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section aria-label={title} className={cardCls}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
      {items.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>
      )}
    </section>
  );
}

export default async function UnderstandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id: projectId } = await params;
  const query = (await searchParams) ?? {};
  const db = getDb();

  let detail;
  try {
    detail = await getProject(db, user.id, projectId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) notFound();
    throw error;
  }

  const existingNodes = await getDiscoveryMap(db, user.id, projectId);
  const alreadyConfirmed = existingNodes.length > 0;

  let view;
  try {
    const { analysis } = await analyzeIdea(db, user.id, projectId);
    view = buildUnderstandingView(analysis);
  } catch (error) {
    if (!(error instanceof IdeaAnalysisError)) throw error;
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
        <PageHeader
          eyebrow={<BackLink href="/projects">← Projects</BackLink>}
          title="Here's what I understand so far"
        />
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          <p className="font-medium">Understanding generation failed.</p>
          <p className="mt-1">Your project was not changed. Try again.</p>
          <a href={`/projects/${projectId}/understanding`} className="mt-2 inline-block underline">
            Try again
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← Projects</BackLink>}
        title="Here's what I understand so far"
        description={`${detail.project.name} · ${view.productCategory}`}
        meta={
          alreadyConfirmed ? (
            <Badge status="CONFIRMED">Already confirmed: review or continue</Badge>
          ) : (
            <Badge status="NEEDS_REVIEW">Needs your review</Badge>
          )
        }
      />

      {alreadyConfirmed && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          ✓ You already confirmed this understanding. Review again or continue to Discovery.
        </p>
      )}
      {query.error === "save" && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          Couldn&apos;t save that. Your approved work is unchanged. Try again.
        </p>
      )}
      {query.error === "empty" && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          The idea can&apos;t be empty. Describe what you want to build.
        </p>
      )}
      {query.error === "invalid" && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          That correction is too long or invalid. Shorten it and try again.
        </p>
      )}

      <section aria-label="Product" className="rounded-lg border border-zinc-900 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-950">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Product</h2>
        <p className="mt-1 text-base">{view.productSummary}</p>
      </section>

      <Section title="Primary users" items={view.users} empty="No specific users identified yet." />
      <Section
        title="Core capabilities"
        items={view.capabilities}
        empty="No explicit capabilities identified yet."
      />
      <Section title="Constraints" items={view.constraints} empty="No constraints stated." />
      {view.otherNotes.length > 0 && (
        <Section
          title="Other noted points"
          items={view.otherNotes.map((note) => `${note.domain}: ${note.statement}`)}
          empty=""
        />
      )}

      <section aria-label="Still unclear" className={cardCls}>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Still unclear</h2>
        {view.unclearAreas.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {view.unclearAreas.map((row) => (
              <li key={`${row.domain}-${row.question}`}>
                ? <span className="font-medium">{row.domain}:</span> {row.question}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Nothing unclear. The idea covered everything.
          </p>
        )}
      </section>

      {view.assumptions.length > 0 && (
        <section
          aria-label="Assumptions (not confirmed)"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">Assumed: not confirmed</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-amber-900 dark:text-amber-200">
            {view.assumptions.map((row) => (
              <li key={row.statement}>
                {row.glyph} {row.statement} · {row.impact} impact
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={confirmAction.bind(null, projectId)}>
        <button
          type="submit"
          className={`${btnPrimary} w-full`}
        >
          Looks right: continue
        </button>
      </form>

      <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="cursor-pointer font-medium">
          Something is wrong? Edit understanding
        </summary>
        <form action={correctAction.bind(null, projectId)} className="flex flex-col gap-3 pt-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Describe your idea
            <textarea
              name="idea"
              rows={4}
              required
              defaultValue={detail.input.idea}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Target users
            <input
              name="targetUsers"
              type="text"
              autoComplete="off"
              defaultValue={detail.input.targetUsers ?? ""}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Constraints
            <input
              name="constraints"
              type="text"
              autoComplete="off"
              defaultValue={detail.input.constraints ?? ""}
              className={inputCls}
            />
          </label>
          <button
            type="submit"
            className={`${btnSecondary} w-fit`}
          >
            Save correction and re-analyze
          </button>
        </form>
      </details>
    </main>
  );
}
