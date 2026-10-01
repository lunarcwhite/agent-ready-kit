// Specification History Viewer (TASK-140, P2).
//
// Read-only inspection of historical specification snapshots (TASK-060
// versions): per-type version lists, deterministic snapshot rendering,
// and a clear current-vs-historical distinction. Detail renders inline
// via ?doc=&version=; nothing here writes — approvals stay in the
// specification workspace (TASK-068) and the change review (TASK-112).
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import {
  getVersion,
  listDocuments,
  listVersions,
} from "@/modules/specifications/documents";
import { SpecificationNotFoundError } from "@/modules/specifications/errors";
import { EmptyState } from "@/app/components/empty-state";
import { BackLink, Badge, Chip, PageHeader } from "@/app/components/ui";

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ doc?: string; version?: string }>;
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

  const documents = await listDocuments(db, user.id, projectId);
  const withVersions = await Promise.all(
    documents.map(async (doc) => ({
      doc,
      versions: await listVersions(db, user.id, projectId, doc.documentType),
    })),
  );

  let detail: { docType: string; version: number; content: string; stateVersion: number } | null =
    null;
  if (query.doc && query.version) {
    const version = Number.parseInt(query.version, 10);
    if (Number.isInteger(version) && version >= 1) {
      try {
        const row = await getVersion(db, user.id, projectId, query.doc, version);
        detail = {
          docType: query.doc,
          version: row.version,
          content: row.content,
          stateVersion: row.projectStateVersion,
        };
      } catch (error) {
        if (!(error instanceof SpecificationNotFoundError)) throw error;
      }
    }
  }

  const base = `/projects/${projectId}/specifications/history`;

  // An unresolvable ?doc= / ?version= shows the list only (detail stays
  // null). Surface that fallback; the list rendering below is unchanged.
  const unknownVersionParam =
    ((query.doc !== undefined && query.doc !== "") ||
      (query.version !== undefined && query.version !== "")) &&
    detail === null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← Projects</BackLink>}
        title="Specification history"
        description="Snapshots are read-only: approved versions frozen at a known project state."
        meta={
          <>
            <Badge status={documents.length > 0 ? "CURRENT" : "DRAFT"}>
              {documents.length > 0 ? `${documents.length} documents` : "No documents"}
            </Badge>
          </>
        }
      />

      {unknownVersionParam && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Version not found. Pick a version below.
        </p>
      )}

      {withVersions.length === 0 ? (
        <EmptyState
          title="No specifications yet"
          body="Compile specifications first; every approved version appears here."
          actionHref={`/projects/${projectId}/discovery`}
          actionLabel="Continue discovery"
        />
      ) : (
        withVersions.map(({ doc, versions }) => (
          <section key={doc.documentType} aria-label={doc.documentType} className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {doc.documentType}
              </h2>
              <span className="flex flex-wrap items-center gap-2">
                <Badge status={doc.status}>{doc.status.replaceAll("_", " ")}</Badge>
                <Chip>current v{doc.currentVersion}</Chip>
              </span>
            </div>
            {versions.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No approved snapshots yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {versions.map((row, index) => {
                  const isLatest = index === versions.length - 1;
                  return (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-3 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        <a
                          href={`${base}?doc=${encodeURIComponent(doc.documentType)}&version=${row.version}`}
                          className="inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 font-mono text-xs"
                        >
                          v{row.version}
                        </a>
                        <Chip>state v{row.projectStateVersion}</Chip>
                      </span>
                      <Badge status={isLatest ? "CURRENT" : "INFO"}>
                        {isLatest ? "Latest approved" : "Historical"}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))
      )}

      {detail && (
        <section aria-label="Version detail" className="rounded-lg border border-zinc-900 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-950">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            {detail.docType} v{detail.version}
            <Badge status="INFO">Historical snapshot</Badge>
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Frozen at state v{detail.stateVersion}. This is not the current specification.
          </p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {detail.content}
          </pre>
        </section>
      )}
    </main>
  );
}
