// Specification Change Review (TASK-112, FR-090/091/092).
//
// Review surface for downstream specification changes (TASK-069
// proposals): affected sections listed, before/after meaning visible,
// accept-all, accept-selected, and per-proposal reject. Rejection only
// flips the proposal row — approved specification content is never
// touched by a reject (verified in proposals.rejectProposal).
//
// Acceptance is per-proposal and atomic; stale proposals (canonical
// state moved past their base version) refuse with an explicit message
// and stay PENDING. Bulk accept attempts every selected PENDING proposal
// and reports accepted vs skipped, so one stale item never blocks the
// rest ("accept selected where architecture permits").
//
// Server component, no client JS — same convention as Decisions. Detail
// renders inline via ?id=.
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import { getStateVersion } from "@/modules/projects/state-version";
import {
  acceptProposal,
  getProposal,
  listProposals,
  rejectProposal,
  type ProposedChangeRow,
} from "@/modules/specifications/proposals";
import {
  listDocuments,
  listSections,
  type SpecificationSectionRow,
} from "@/modules/specifications/documents";
import {
  SpecificationNotFoundError,
  SpecificationValidationError,
} from "@/modules/specifications/errors";
import { PROPOSAL_STATUS_FILTERS, filterToStatus, proposalStatusLabel } from "./labels";
import {
  BackLink,
  Badge,
  Chip,
  PageHeader,
  btnPrimary,
  btnSecondary,
} from "@/app/components/ui";

function proposalContent(raw: unknown): { title: string; renderedContent: string } {
  const content = (raw ?? {}) as { title?: unknown; renderedContent?: unknown };
  return {
    title: typeof content.title === "string" ? content.title : "–",
    renderedContent: typeof content.renderedContent === "string" ? content.renderedContent : "–",
  };
}

async function acceptOne(
  projectId: string,
  userId: string,
  proposalId: string,
): Promise<"accepted" | "skipped"> {
  try {
    await acceptProposal(getDb(), userId, projectId, proposalId);
    return "accepted";
  } catch (error) {
    if (
      error instanceof SpecificationValidationError ||
      error instanceof SpecificationNotFoundError
    ) {
      return "skipped";
    }
    throw error;
  }
}

async function acceptSelectedAction(projectId: string, formData: FormData): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  const ids = formData.getAll("proposalId").map((value) => String(value));
  let accepted = 0;
  let skipped = 0;
  for (const id of ids) {
    if ((await acceptOne(projectId, user.id, id)) === "accepted") accepted += 1;
    else skipped += 1;
  }
  redirect(`/projects/${projectId}/specifications/changes?accepted=${accepted}&skipped=${skipped}`);
}

async function acceptAllAction(projectId: string): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  const pending = await listProposals(getDb(), user.id, projectId, "PENDING");
  let accepted = 0;
  let skipped = 0;
  for (const proposal of pending) {
    if ((await acceptOne(projectId, user.id, proposal.id)) === "accepted") accepted += 1;
    else skipped += 1;
  }
  redirect(`/projects/${projectId}/specifications/changes?accepted=${accepted}&skipped=${skipped}`);
}

async function rejectAction(projectId: string, proposalId: string): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  try {
    await rejectProposal(getDb(), user.id, projectId, proposalId);
  } catch (error) {
    if (
      error instanceof SpecificationValidationError ||
      error instanceof SpecificationNotFoundError
    ) {
      redirect(`/projects/${projectId}/specifications/changes?error=rejected`);
    }
    throw error;
  }
  redirect(`/projects/${projectId}/specifications/changes`);
}

export default async function ChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    filter?: string;
    id?: string;
    accepted?: string;
    skipped?: string;
    error?: string;
  }>;
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

  const activeFilter = query.filter ?? "Pending";
  const statusFilter = filterToStatus(activeFilter);
  const [proposals, currentVersion] = await Promise.all([
    listProposals(db, user.id, projectId, statusFilter),
    getStateVersion(db, user.id, projectId),
  ]);

  // Section identity for display: proposals carry section ids, so index
  // every document's sections once (bounded by the nine known types).
  const documents = await listDocuments(db, user.id, projectId);
  const sectionById = new Map<string, { documentType: string; row: SpecificationSectionRow }>();
  await Promise.all(
    documents.map(async (document) => {
      const sections = await listSections(db, user.id, projectId, document.documentType);
      for (const row of sections) {
        sectionById.set(row.id, { documentType: document.documentType, row });
      }
    }),
  );
  const describeTarget = (proposal: ProposedChangeRow): string => {
    const found = sectionById.get(proposal.targetId);
    return found ? `${found.documentType} · ${found.row.sectionKey}` : "Removed section";
  };
  const isStale = (proposal: ProposedChangeRow): boolean =>
    proposal.status === "PENDING" && proposal.baseStateVersion !== currentVersion;

  let detail: ProposedChangeRow | null = null;
  if (query.id) {
    try {
      detail = await getProposal(db, user.id, projectId, query.id);
    } catch (error) {
      if (!(error instanceof SpecificationNotFoundError)) throw error;
    }
  }
  // An unresolvable ?id= is silently ignored (list renders unchanged).
  // Surface that fallback; the list rendering below is unchanged.
  const unknownProposalParam =
    query.id !== undefined && query.id !== "" && detail === null;

  const base = `/projects/${projectId}/specifications/changes`;
  const pendingIds = proposals.filter((proposal) => proposal.status === "PENDING");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← Projects</BackLink>}
        title="Specification changes"
        description="Review proposals caused by changed decisions: accept what is correct, reject the rest."
        meta={
          <>
            <Badge status={pendingIds.length > 0 ? "PENDING" : "READY"}>
              {pendingIds.length > 0 ? `${pendingIds.length} pending` : "No pending"}
            </Badge>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              state v{currentVersion}
            </span>
          </>
        }
      />

      {(query.accepted !== undefined || query.skipped !== undefined) && (
        <p role="status" className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          Accepted {query.accepted ?? 0}, skipped {query.skipped ?? 0}. Skipped proposals stay
          pending: refresh them against current state first.
        </p>
      )}
      {query.error === "rejected" && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          Couldn&apos;t reject that proposal. Approved content is unchanged.
        </p>
      )}
      {unknownProposalParam && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Proposal not found. It may have been decided already.
        </p>
      )}

      <nav aria-label="Filter proposals" className="flex flex-wrap gap-2">
        {PROPOSAL_STATUS_FILTERS.map((filter) => (
          <a
            key={filter}
            href={`${base}?filter=${filter}`}
            aria-current={activeFilter === filter ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm transition-colors ${
              activeFilter === filter
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
            }`}
          >
            {filter}
          </a>
        ))}
      </nav>

      {proposals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No proposals match. Changed canonical state produces reviewable proposals here.
        </p>
      ) : (
        <form action={acceptSelectedAction.bind(null, projectId)}>
          <ul className="flex flex-col gap-2">
            {proposals.map((proposal) => {
              const badge = proposalStatusLabel(proposal.status);
              const stale = isStale(proposal);
              return (
                <li
                  key={proposal.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3.5 transition-colors dark:bg-zinc-950 ${
                    proposal.status === "PENDING" ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{describeTarget(proposal)}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                      <Badge status={proposal.status}>
                        {badge.glyph} {badge.label}
                      </Badge>
                      <span>
                        {proposal.changeType}
                        {stale ? " · Stale: state moved on" : ""}
                        {proposal.reason ? ` · ${proposal.reason}` : ""}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {proposal.status === "PENDING" && !stale && (
                      <label className="flex min-h-[44px] items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          name="proposalId"
                          value={proposal.id}
                          aria-label={`Select change to ${describeTarget(proposal)}`}
                          className="h-6 w-6"
                        />
                      </label>
                    )}
                    <a
                      href={`${base}?filter=${activeFilter}&id=${proposal.id}`}
                      className={btnSecondary}
                    >
                      View
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
          {pendingIds.length > 0 && (
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                className={btnPrimary}
              >
                Accept selected
              </button>
            </div>
          )}
        </form>
      )}
      {pendingIds.length > 0 && (
        <form action={acceptAllAction.bind(null, projectId)}>
          <button
            type="submit"
            className={btnSecondary}
          >
            Accept all pending
          </button>
        </form>
      )}

      {detail && (
        <section aria-label="Proposal detail" className="rounded-lg border border-zinc-900 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold tracking-tight">{describeTarget(detail)}</h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <Badge status={detail.status}>
              {proposalStatusLabel(detail.status).glyph} {proposalStatusLabel(detail.status).label}
            </Badge>
            <Chip>
              base v{detail.baseStateVersion} · current v{currentVersion}
            </Chip>
          </p>
          {detail.reason && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Why: {detail.reason}</p>}
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Before (approved)</h3>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                {proposalContent(detail.previousContent).renderedContent}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">After (proposed)</h3>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                {proposalContent(detail.proposedContent).renderedContent}
              </p>
            </div>
          </div>
          {detail.status === "PENDING" && (
            <div className="mt-4 flex flex-wrap gap-2">
              {isStale(detail) ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Stale: canonical state moved past v{detail.baseStateVersion}. Create a fresh
                  proposal instead of accepting this one.
                </p>
              ) : (
                <form action={acceptSelectedAction.bind(null, projectId)}>
                  <input type="hidden" name="proposalId" value={detail.id} />
                  <button
                    type="submit"
                    className={btnPrimary}
                  >
                    Accept this change
                  </button>
                </form>
              )}
              <form action={rejectAction.bind(null, projectId, detail.id)}>
                <button
                  type="submit"
                  className={btnSecondary}
                >
                  Reject
                </button>
              </form>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
