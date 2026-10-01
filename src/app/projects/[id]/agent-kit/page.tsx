// Agent Kit Workspace (SCREEN-021/022 per design.md; TASK-114).
//
// Read-only assembly preview plus explicit export actions: readiness
// check with a link back to blockers, target selection over the adapter
// registry (generic is canonical in MVP), applicable file list from the
// deterministic assembler, source state version, and the last-export
// staleness banner. Generation streams through the download route, which
// records the export after the bytes are built — previewing never writes.
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import { getStateVersion } from "@/modules/projects/state-version";
import { calculateReadiness } from "@/modules/readiness/engine";
import { assembleAgentKit } from "@/modules/agent-kit/compiler";
import { AgentKitValidationError } from "@/modules/agent-kit/errors";
import { supportedTargets, GENERIC_TARGET } from "@/modules/agent-kit/adapters";
import { isLastExportStale } from "@/modules/agent-kit/history";
import { EmptyState, ErrorState } from "@/app/components/empty-state";
import { BackLink, Badge, PageHeader, btnPrimary, btnSecondary } from "@/app/components/ui";

export default async function AgentKitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ target?: string; preview?: string }>;
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

  const targets = supportedTargets();
  const activeTarget = query.target ?? GENERIC_TARGET;
  const target = targets.includes(activeTarget) ? activeTarget : GENERIC_TARGET;
  const showPreview = query.preview === "1";

  const [project, report, stateVersion, staleness] = await Promise.all([
    getProject(db, user.id, projectId),
    calculateReadiness(db, user.id, projectId),
    getStateVersion(db, user.id, projectId),
    isLastExportStale(db, user.id, projectId),
  ]);

  let files: { path: string; bytes: number }[] | null = null;
  let previewError: string | null = null;
  if (showPreview) {
    try {
      const kit = await assembleAgentKit(db, user.id, projectId);
      files = kit.files.map((file) => ({
        path: file.path,
        bytes: new TextEncoder().encode(file.content).length,
      }));
    } catch (error) {
      previewError =
        error instanceof AgentKitValidationError
          ? error.message
          : "Assembly preview is unavailable.";
    }
  }

  const base = `/projects/${projectId}/agent-kit`;
  const downloadHref = `${base}/download?target=${encodeURIComponent(target)}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← Projects</BackLink>}
        title="Agent Kit"
        description={`State version ${stateVersion} · Lifecycle ${project.project.lifecycleState} · ${
          report.ready
            ? "Implementation ready"
            : `${report.blockers.length} blocker${report.blockers.length === 1 ? "" : "s"}`
        }`}
        meta={
          <Badge status={report.ready ? "READY" : "BLOCKER"}>
            {report.ready
              ? "Implementation ready"
              : `${report.blockers.length} blocker${report.blockers.length === 1 ? "" : "s"}`}
          </Badge>
        }
      />

      {!report.ready && (
        <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Readiness is not clean. You can still export. The manifest records the current
          readiness, but resolve{" "}
          <Link href={`/projects/${projectId}/readiness`} className="underline">
            blockers
          </Link>{" "}
          first for an implementation-ready package.
        </p>
      )}

      {staleness.lastExport !== null && (
        <p
          className={`rounded border p-4 text-sm ${
            staleness.stale
              ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
              : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400"
          }`}
        >
          Last export: {staleness.lastExport.target} at state version{" "}
          {staleness.lastExport.sourceStateVersion}
          {staleness.stale ? ": stale, canonical state moved on." : ": current."}
        </p>
      )}

      <nav aria-label="Export target" className="flex flex-wrap gap-2">
        {targets.map((option) => (
          <Link
            key={option}
            href={`${base}?target=${encodeURIComponent(option)}${showPreview ? "&preview=1" : ""}`}
            aria-current={target === option ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm ${
              target === option
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}
          >
            {option}
          </Link>
        ))}
      </nav>

      {files === null ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`${base}?target=${encodeURIComponent(target)}&preview=1`}
            className={btnSecondary}
          >
            Preview files
          </Link>
          <Link href={downloadHref} className={btnPrimary}>
            Generate & download ZIP
          </Link>
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          title="No files to export"
          body="The assembler returned an empty package. Compile specifications first."
          actionHref={`${base}?target=${encodeURIComponent(target)}&preview=1`}
          actionLabel="Retry preview"
        />
      ) : (
        <section
          aria-label="Applicable files"
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {files.length} files · target {target}
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {files.map((file) => (
              <li key={file.path} className="flex justify-between gap-4 font-mono text-xs">
                <span className="break-all">{file.path}</span>
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{file.bytes} B</span>
              </li>
            ))}
          </ul>
          <Link href={downloadHref} className={`${btnPrimary} mt-4`}>
            Generate & download ZIP
          </Link>
        </section>
      )}
      {previewError !== null && (
        <ErrorState
          title="Export not ready"
          body={`${previewError} Your approved content is unchanged.`}
        />
      )}
    </main>
  );
}
