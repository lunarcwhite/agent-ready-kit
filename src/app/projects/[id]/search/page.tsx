// Advanced Project Search UI (TASK-142, P2).
//
// Thin form over searchProject: empty state before the first query,
// no-match state, typed results with stable codes. GET stays read-only;
// short queries surface the validation message instead of failing.
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError, ProjectValidationError } from "@/modules/projects/errors";
import { searchProject } from "@/modules/search/search";
import { EmptyState } from "@/app/components/empty-state";
import {
  BackLink,
  Badge,
  Chip,
  PageHeader,
  btnPrimary,
  inputCls,
} from "@/app/components/ui";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ q?: string }>;
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

  const q = (query.q ?? "").trim();
  let results: { type: string; code: string; title: string }[] | null = null;
  let truncated = false;
  let error: string | null = null;
  if (q !== "") {
    try {
      const found = await searchProject(db, user.id, projectId, q);
      results = found.results;
      truncated = found.truncated;
    } catch (err) {
      error = err instanceof ProjectValidationError ? err.message : "Search is unavailable.";
    }
  }

  const base = `/projects/${projectId}/search`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← Projects</BackLink>}
        title="Search project"
        description="Decisions, requirements, tasks, entities, and issues in this project."
        meta={
          results !== null ? (
            <Badge status="INFO">
              {results.length === 0 ? "No matches" : `${results.length} matches`}
            </Badge>
          ) : undefined
        }
      />

      <form action={base} method="get" className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
          Query
          <input
            name="q"
            defaultValue={q}
            minLength={2}
            placeholder="At least 2 characters…"
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          className={btnPrimary}
        >
          Search
        </button>
      </form>

      {error !== null && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {results === null ? (
        <EmptyState title="No query yet" body="Type at least 2 characters to search this project." />
      ) : results.length === 0 ? (
        <EmptyState title="No matches" body={`Nothing in this project matches "${q}".`} />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {results.map((row) => (
              <li key={`${row.type}:${row.code}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3.5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Chip>{row.code}</Chip>
                  {row.title}
                </p>
                <Badge status={row.type}>{row.type}</Badge>
              </li>
            ))}
          </ul>
          {truncated ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Results truncated: narrow your query.</p>
          ) : null}
        </>
      )}
    </main>
  );
}
