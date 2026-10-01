// Export History UI (TASK-141, P2).
//
// Read-only list over the export ledger (TASK-107): target, time,
// source state version, and artifact count per export, with live
// staleness against the current state version. History rows record what
// was shipped — inspection shows that record, never a regenerated
// package, so a past entry cannot be mistaken for current output.
import { notFound, redirect } from "next/navigation";
import { BackLink, Badge, Chip, PageHeader } from "@/app/components/ui";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import { isLastExportStale, listExports } from "@/modules/agent-kit/history";
import { EmptyState } from "@/app/components/empty-state";

export default async function ExportsPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [exports, staleness] = await Promise.all([
    listExports(db, user.id, projectId),
    isLastExportStale(db, user.id, projectId),
  ]);
  const base = `/projects/${projectId}/agent-kit`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href={base}>← Agent Kit</BackLink>}
        title="Export history"
        description={`${exports.length} exports · current state version ${staleness.currentStateVersion}`}
        meta={
          exports.length > 0 ? (
            <Badge status={staleness.stale ? "STALE" : "CURRENT"}>
              {staleness.stale ? "Stale: state moved on" : "Current"}
            </Badge>
          ) : undefined
        }
      />

      {exports.length === 0 ? (
        <EmptyState
          title="No exports yet"
          body="Generate an Agent Kit package and it appears here with its source state version."
          actionHref={base}
          actionLabel="Go to Agent Kit"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {exports.map((row, index) => {
            const isStale =
              index === 0 ? staleness.stale : row.sourceStateVersion !== staleness.currentStateVersion;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-3.5 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Chip>{row.target}</Chip>
                    <span>
                      state v{row.sourceStateVersion} · {row.artifactCount} files
                    </span>
                    <Badge status={isStale ? "STALE" : "CURRENT"}>
                      {isStale ? "Stale" : "Current"}
                    </Badge>
                  </p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {row.createdAt.toLocaleString()}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
