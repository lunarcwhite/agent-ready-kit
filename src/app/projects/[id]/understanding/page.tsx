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
    <section aria-label={title} className="rounded border border-zinc-200 p-4">
      <h2 className="text-sm font-medium text-zinc-500">{title}</h2>
      {items.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">{empty}</p>
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
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
        <div>
          <a href="/projects" className="text-sm text-zinc-500 hover:underline">
            ← Projects
          </a>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Here&apos;s what I understand so far
          </h1>
        </div>
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div>
        <a href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </a>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Here&apos;s what I understand so far
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          {detail.project.name} · {view.productCategory}
        </p>
      </div>

      {alreadyConfirmed && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          ✓ You already confirmed this understanding. Review again or continue to Discovery.
        </p>
      )}
      {query.error === "save" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Couldn&apos;t save that. Your approved work is unchanged — try again.
        </p>
      )}
      {query.error === "empty" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          The idea can&apos;t be empty. Describe what you want to build.
        </p>
      )}
      {query.error === "invalid" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          That correction is too long or invalid. Shorten it and try again.
        </p>
      )}

      <section aria-label="Product" className="rounded border border-zinc-900 p-4">
        <h2 className="text-sm font-medium text-zinc-500">Product</h2>
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

      <section aria-label="Still unclear" className="rounded border border-zinc-200 p-4">
        <h2 className="text-sm font-medium text-zinc-500">Still unclear</h2>
        {view.unclearAreas.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {view.unclearAreas.map((row) => (
              <li key={`${row.domain}-${row.question}`}>
                ? <span className="font-medium">{row.domain}:</span> {row.question}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            Nothing unclear — the idea covered everything.
          </p>
        )}
      </section>

      {view.assumptions.length > 0 && (
        <section
          aria-label="Assumptions (not confirmed)"
          className="rounded border border-amber-200 bg-amber-50 p-4"
        >
          <h2 className="text-sm font-medium text-amber-800">Assumed — not confirmed</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-amber-900">
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
          className="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Looks right — continue
        </button>
      </form>

      <details className="rounded border border-zinc-200 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">
          Something is wrong? Edit understanding
        </summary>
        <form action={correctAction.bind(null, projectId)} className="flex flex-col gap-3 pt-3">
          <label className="flex flex-col gap-1">
            Describe your idea
            <textarea
              name="idea"
              rows={4}
              required
              defaultValue={detail.input.idea}
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            Target users
            <input
              name="targetUsers"
              type="text"
              autoComplete="off"
              defaultValue={detail.input.targetUsers ?? ""}
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            Constraints
            <input
              name="constraints"
              type="text"
              autoComplete="off"
              defaultValue={detail.input.constraints ?? ""}
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Save correction and re-analyze
          </button>
        </form>
      </details>
    </main>
  );
}
