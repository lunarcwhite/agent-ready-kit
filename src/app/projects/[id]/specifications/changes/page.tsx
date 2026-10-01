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
import Link from "next/link";
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

function proposalContent(raw: unknown): { title: string; renderedContent: string } {
  const content = (raw ?? {}) as { title?: unknown; renderedContent?: unknown };
  return {
    title: typeof content.title === "string" ? content.title : "—",
    renderedContent: typeof content.renderedContent === "string" ? content.renderedContent : "—",
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

  const base = `/projects/${projectId}/specifications/changes`;
  const pendingIds = proposals.filter((proposal) => proposal.status === "PENDING");

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <div>
        <Link href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Specification changes</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {pendingIds.length} pending · state v{currentVersion}
        </p>
      </div>

      {(query.accepted !== undefined || query.skipped !== undefined) && (
        <p role="status" className="rounded border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm">
          Accepted {query.accepted ?? 0}, skipped {query.skipped ?? 0}. Skipped proposals stay
          pending — refresh them against current state first.
        </p>
      )}
      {query.error === "rejected" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Couldn&apos;t reject that proposal. Approved content is unchanged.
        </p>
      )}

      <nav aria-label="Filter proposals" className="flex flex-wrap gap-2">
        {PROPOSAL_STATUS_FILTERS.map((filter) => (
          <a
            key={filter}
            href={`${base}?filter=${filter}`}
            aria-current={activeFilter === filter ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              activeFilter === filter
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {filter}
          </a>
        ))}
      </nav>

      {proposals.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
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
                  className={`flex flex-wrap items-center justify-between gap-2 rounded border p-3 ${
                    proposal.status === "PENDING" ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{describeTarget(proposal)}</p>
                    <p className="mt-1 text-sm text-zinc-600">
                      {badge.glyph} {badge.label} · {proposal.changeType}
                      {stale ? " · Stale — state moved on" : ""}
                      {proposal.reason ? ` · ${proposal.reason}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {proposal.status === "PENDING" && !stale && (
                      <input
                        type="checkbox"
                        name="proposalId"
                        value={proposal.id}
                        aria-label={`Select change to ${describeTarget(proposal)}`}
                        className="h-4 w-4"
                      />
                    )}
                    <a
                      href={`${base}?filter=${activeFilter}&id=${proposal.id}`}
                      className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
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
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
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
            className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Accept all pending
          </button>
        </form>
      )}

      {detail && (
        <section aria-label="Proposal detail" className="rounded border border-zinc-900 p-4">
          <h2 className="text-lg font-semibold">{describeTarget(detail)}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {proposalStatusLabel(detail.status).glyph} {proposalStatusLabel(detail.status).label} ·
            base state v{detail.baseStateVersion} · current v{currentVersion}
          </p>
          {detail.reason && <p className="mt-1 text-sm text-zinc-600">Why: {detail.reason}</p>}
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium">Before (approved)</h3>
              <p className="mt-1 whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
                {proposalContent(detail.previousContent).renderedContent}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium">After (proposed)</h3>
              <p className="mt-1 whitespace-pre-wrap rounded border border-zinc-200 p-3 text-sm">
                {proposalContent(detail.proposedContent).renderedContent}
              </p>
            </div>
          </div>
          {detail.status === "PENDING" && (
            <div className="mt-3 flex gap-2">
              {isStale(detail) ? (
                <p className="text-sm text-amber-800">
                  Stale: canonical state moved past v{detail.baseStateVersion}. Create a fresh
                  proposal instead of accepting this one.
                </p>
              ) : (
                <form action={acceptSelectedAction.bind(null, projectId)}>
                  <input type="hidden" name="proposalId" value={detail.id} />
                  <button
                    type="submit"
                    className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                  >
                    Accept this change
                  </button>
                </form>
              )}
              <form action={rejectAction.bind(null, projectId, detail.id)}>
                <button
                  type="submit"
                  className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
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
