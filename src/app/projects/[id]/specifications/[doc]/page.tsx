// Specification workspace (SCREEN-010–014 per design.md §92; TASK-068).
//
// Read-only structured view over compiled specification documents (TASK-060):
// sections with current/stale/proposed state, source references resolved to
// human codes (TASK-061), version snapshots with historical/current
// distinction, and a markdown rendering of the same approved content.
// Detail renders inline via ?section= rather than a separate route
// (design.md §93: detail objects may use query parameters).
//
// Server component, no client JS — same convention as Decisions. Viewing
// never creates documents: compilers own generation, this page only reads,
// so an ungenerated document renders an empty state instead of a container.
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import {
  getDocument,
  getSection,
  getVersion,
  listSections,
  listVersions,
  type SpecificationDocumentRow,
  type SpecificationSectionRow,
  type SpecificationVersionRow,
} from "@/modules/specifications/documents";
import { listSectionSources, type SectionSourceRef } from "@/modules/specifications/dependencies";
import { SpecificationNotFoundError } from "@/modules/specifications/errors";
import { SPEC_DOCS, documentStatusLabel, resolveSpecSlug, sectionStatusLabel } from "./labels";
import { BackLink, Badge, Chip, PageHeader, btnSecondary } from "@/app/components/ui";

interface DocBlock {
  documentType: string;
  title: string;
  document: SpecificationDocumentRow;
  sections: SpecificationSectionRow[];
  versions: SpecificationVersionRow[];
}

async function loadDocBlock(
  db: ReturnType<typeof getDb>,
  userId: string,
  projectId: string,
  documentType: string,
  title: string,
): Promise<DocBlock | null> {
  try {
    const document = await getDocument(db, userId, projectId, documentType);
    const [sections, versions] = await Promise.all([
      listSections(db, userId, projectId, documentType),
      listVersions(db, userId, projectId, documentType),
    ]);
    return { documentType, title, document, sections, versions };
  } catch (error) {
    if (error instanceof SpecificationNotFoundError) return null;
    throw error;
  }
}

function assembleMarkdown(sections: SpecificationSectionRow[]): string {
  return sections
    .map((section) => `# ${section.title}\n\n${section.renderedContent}`.trimEnd())
    .join("\n\n");
}

export default async function SpecificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; doc: string }>;
  searchParams?: Promise<{ view?: string; section?: string; version?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id: projectId, doc: slug } = await params;
  const query = (await searchParams) ?? {};
  const target = resolveSpecSlug(slug);
  if (!target) notFound();
  const db = getDb();

  try {
    await getProject(db, user.id, projectId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) notFound();
    throw error;
  }

  const primary = await loadDocBlock(db, user.id, projectId, target.documentType, target.title);
  const secondary = target.secondary
    ? await loadDocBlock(
        db,
        user.id,
        projectId,
        target.secondary.documentType,
        target.secondary.title,
      )
    : null;
  const blocks = [primary, secondary].filter((block): block is DocBlock => block !== null);

  const view = query.view === "markdown" ? "markdown" : "structured";
  const baseHref = `/projects/${projectId}/specifications/${target.slug}`;

  // Historical snapshot view (primary document only): content frozen at
  // approval time, clearly marked as not current.
  let historical: SpecificationVersionRow | null = null;
  const versionNumber = Number.parseInt(query.version ?? "", 10);
  if (primary && Number.isInteger(versionNumber) && versionNumber >= 1) {
    try {
      historical = await getVersion(db, user.id, projectId, primary.documentType, versionNumber);
    } catch (error) {
      if (!(error instanceof SpecificationNotFoundError)) throw error;
    }
  }

  // Section detail: searched in the primary document first, then secondary.
  let detail: {
    block: DocBlock;
    section: SpecificationSectionRow;
    sources: SectionSourceRef[];
  } | null = null;
  if (query.section && !historical) {
    for (const block of blocks) {
      try {
        const section = await getSection(db, user.id, projectId, block.documentType, query.section);
        const sources = await listSectionSources(
          db,
          user.id,
          projectId,
          block.documentType,
          section.sectionKey,
        );
        detail = { block, section, sources };
        break;
      } catch (error) {
        if (!(error instanceof SpecificationNotFoundError)) throw error;
      }
    }
  }

  const allSections = blocks.flatMap((block) => block.sections);
  const staleCount = allSections.filter((section) => section.status === "STALE").length;
  const proposedCount = allSections.filter((section) => section.status === "PROPOSED").length;

  // Unresolvable ?version= / ?section= falls back to the current approved
  // content (historical/detail stay null). Surface that fallback instead of
  // rendering it silently; the content rendered below is unchanged.
  const unknownVersionParam =
    query.version !== undefined && query.version !== "" && historical === null;
  const unknownSectionParam =
    query.section !== undefined &&
    query.section !== "" &&
    detail === null &&
    historical === null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← Projects</BackLink>}
        title={`${target.title} specification`}
        description={target.description}
        meta={
          blocks.length > 0 ? (
            <>
              <Badge status={staleCount > 0 ? "STALE" : "CURRENT"}>
                {staleCount > 0 ? `${staleCount} need review` : "Current"}
              </Badge>
              {proposedCount > 0 && <Badge status="PROPOSED">{`${proposedCount} proposed`}</Badge>}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {allSections.length} sections
              </span>
            </>
          ) : undefined
        }
      />

      {(unknownVersionParam || unknownSectionParam) && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Unknown version or section. Showing the current approved content.
        </p>
      )}

      <nav aria-label="Specification types" className="flex flex-wrap gap-2">
        {SPEC_DOCS.map((item) => (
          <a
            key={item.slug}
            href={`/projects/${projectId}/specifications/${item.slug}`}
            aria-current={item.slug === target.slug ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm transition-colors ${
              item.slug === target.slug
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
            }`}
          >
            {item.title}
          </a>
        ))}
      </nav>

      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No {target.title.toLowerCase()} specification has been generated yet. Complete discovery
          and confirm decisions first. Compilers write proposals here for review.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" aria-label="View options">
            <a
              href={baseHref}
              aria-current={view === "structured" ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm transition-colors ${
                view === "structured"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
              }`}
            >
              Structured
            </a>
            <a
              href={`${baseHref}?view=markdown`}
              aria-current={view === "markdown" ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm transition-colors ${
                view === "markdown"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
              }`}
            >
              Markdown
            </a>
          </div>

          {historical ? (
            <section aria-label="Historical version" className="flex flex-col gap-3">
              <p
                role="note"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
              >
                Historical version {historical.version}: frozen at project state v
                {historical.projectStateVersion}. This is not the current specification.
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                {historical.content}
              </pre>
              <a href={baseHref} className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
                ← Back to current
              </a>
            </section>
          ) : detail ? (
            <section
              aria-label="Section detail"
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {(() => {
                const badge = sectionStatusLabel(detail.section.status);
                return (
                  <>
                    <div>
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <Chip>{detail.section.sectionKey}</Chip>
                        {detail.section.title}
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <Badge status={detail.section.status}>
                          {badge.glyph} {badge.label}
                        </Badge>
                        <span>in {detail.block.title}</span>
                      </p>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{detail.section.renderedContent}</p>
                    <div>
                      <h3 className="text-sm font-medium">Source references</h3>
                      {detail.sources.length === 0 ? (
                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                          No canonical sources linked to this section.
                        </p>
                      ) : (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {detail.sources.map((source) => (
                            <li key={`${source.sourceType}:${source.sourceId}`}>
                              <Chip title={source.sourceType}>{source.label}</Chip>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <a
                      href={`${baseHref}${view === "markdown" ? "?view=markdown" : ""}`}
                      className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
                    >
                      ← Back to sections
                    </a>
                  </>
                );
              })()}
            </section>
          ) : view === "markdown" ? (
            <section aria-label="Markdown rendering" className="flex flex-col gap-4">
              {blocks.map((block) => (
                <div key={block.documentType} className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{block.title}</h2>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                    {assembleMarkdown(block.sections) || "No sections yet."}
                  </pre>
                </div>
              ))}
            </section>
          ) : (
            <div className="flex flex-col gap-6">
              {blocks.map((block) => {
                const docBadge = documentStatusLabel(block.document.status);
                const latest = block.versions[block.versions.length - 1] ?? null;
                return (
                  <section key={block.documentType} aria-label={block.title} className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {block.title}
                      </h2>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge status={block.document.status}>
                          {docBadge.glyph} {docBadge.label}
                        </Badge>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          v{block.document.currentVersion}
                          {latest
                            ? ` · approved at state v${latest.projectStateVersion}`
                            : " · not yet approved"}
                        </span>
                      </span>
                    </div>
                    {block.sections.length === 0 ? (
                      <p className="mt-3 rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                        No sections in this document yet.
                      </p>
                    ) : (
                      <ul className="mt-3 flex flex-col gap-2">
                        {block.sections.map((section) => {
                          const badge = sectionStatusLabel(section.status);
                          return (
                            <li
                              key={section.sectionKey}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3.5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                            >
                              <div className="min-w-0">
                                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                  <Chip>{section.sectionKey}</Chip>
                                  {section.title}
                                </p>
                                <p className="mt-1.5">
                                  <Badge status={section.status}>
                                    {badge.glyph} {badge.label}
                                  </Badge>
                                </p>
                              </div>
                              <a
                                href={`${baseHref}?section=${section.sectionKey}`}
                                className={btnSecondary}
                              >
                                View
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {block.versions.length > 0 && (
                      <div className="mt-4">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">History</h3>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {block.versions.map((version) => (
                            <li key={version.version}>
                              <a
                                href={`${baseHref}?version=${version.version}`}
                                className="inline-flex min-h-[44px] items-center rounded-full border border-zinc-300 px-4 py-2 text-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
                              >
                                v{version.version} · state v{version.projectStateVersion}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
