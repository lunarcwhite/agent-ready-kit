// Validation Workspace (SCREEN-016/017 per design.md; TASK-077).
//
// Read-only triage over validation issues (TASK-070/071/072/073/075):
// filter by severity/status, BLOCKER and HIGH surfaced first with
// prominent styling, affected artifacts resolved to human labels with
// contextual links to the workspace that fixes them, and a resolution
// form on open issues. Assumptions and contradictions carry distinct
// badges plus a one-line explainer so the two are never confused.
// Resolved issues stay inspectable through the status filter.
//
// Server component, no client JS — same convention as Decisions. Detail
// renders inline via ?code= rather than a separate route (design.md §92:
// SCREEN-* are concepts, not mandatory URLs).
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { AppDatabase } from "@/infrastructure/database/db";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import { listDecisions } from "@/modules/decisions/decisions";
import { listRequirements } from "@/modules/requirements/requirements";
import { listKnowledge } from "@/modules/knowledge/knowledge";
import { listUserTasks } from "@/modules/tasks/user-tasks";
import {
  getIssueByCode,
  listIssues,
  resolveIssue,
  type IssueReferenceRow,
  type IssueRow,
} from "@/modules/validation/issues";
import { IssueNotFoundError, IssueValidationError } from "@/modules/validation/errors";
import {
  ISSUE_SEVERITY_FILTERS,
  ISSUE_STATUS_FILTERS,
  issueSeverityLabel,
  issueTypeLabel,
  severityToFilter,
  statusToFilter,
} from "./labels";

const SEVERITY_RANK: Record<string, number> = {
  BLOCKER: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

async function resolveAction(
  projectId: string,
  issueCode: string,
  formData: FormData,
): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  const resolution = String(formData.get("resolution") ?? "").trim();
  if (resolution === "") redirect(`/projects/${projectId}/issues?code=${issueCode}&error=empty`);
  try {
    await resolveIssue(getDb(), user.id, projectId, issueCode, resolution);
  } catch (error) {
    if (error instanceof IssueValidationError) {
      redirect(`/projects/${projectId}/issues?code=${issueCode}&error=invalid`);
    }
    throw error;
  }
  redirect(`/projects/${projectId}/issues?code=${issueCode}`);
}

interface ResolvedReference {
  key: string;
  label: string;
  href: string | null;
}

// One scoped list per referenced artifact family (no N+1): ids resolve to
// human labels, decisions and tasks link to the workspace that fixes them.
async function resolveReferences(
  db: AppDatabase,
  userId: string,
  projectId: string,
  references: IssueReferenceRow[],
): Promise<ResolvedReference[]> {
  const needDecisions = references.some((ref) => ref.referenceType === "DECISION");
  const needRequirements = references.some((ref) => ref.referenceType === "REQUIREMENT");
  const needKnowledge = references.some((ref) => ref.referenceType === "KNOWLEDGE_ITEM");
  const needTasks = references.some((ref) => ref.referenceType === "TASK");
  const [decisions, requirements, knowledge, tasks] = await Promise.all([
    needDecisions ? listDecisions(db, userId, projectId) : [],
    needRequirements ? listRequirements(db, userId, projectId) : [],
    needKnowledge ? listKnowledge(db, userId, projectId) : [],
    needTasks ? listUserTasks(db, userId, projectId) : [],
  ]);
  return references.map((reference) => {
    const key = `${reference.referenceType}:${reference.referenceId}`;
    if (reference.referenceType === "DECISION") {
      const found = decisions.find((row) => row.id === reference.referenceId);
      return {
        key,
        label: found ? `${found.decisionCode} · ${found.title}` : "Unknown decision",
        href: found ? `/projects/${projectId}/decisions?code=${found.decisionCode}` : null,
      };
    }
    if (reference.referenceType === "REQUIREMENT") {
      const found = requirements.find((row) => row.id === reference.referenceId);
      return {
        key,
        label: found ? `${found.requirementCode} · ${found.title}` : "Unknown requirement",
        href: null,
      };
    }
    if (reference.referenceType === "KNOWLEDGE_ITEM") {
      const found = knowledge.find((row) => row.id === reference.referenceId);
      return {
        key,
        label: found ? `${found.knowledgeKey} · ${found.title}` : "Unknown knowledge",
        href: null,
      };
    }
    const found = tasks.find((row) => row.id === reference.referenceId);
    return {
      key,
      label: found ? `${found.taskCode} · ${found.title}` : "Unknown task",
      href: found ? `/projects/${projectId}/tasks?code=${found.taskCode}` : null,
    };
  });
}

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ severity?: string; status?: string; code?: string; error?: string }>;
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

  const activeSeverity = query.severity ?? "All";
  const activeStatus = query.status ?? "Open";
  const issues = await listIssues(db, user.id, projectId, {
    ...(severityToFilter(activeSeverity) === undefined
      ? {}
      : { severity: severityToFilter(activeSeverity) as IssueRow["severity"] }),
    ...(statusToFilter(activeStatus) === undefined
      ? {}
      : { status: statusToFilter(activeStatus) as IssueRow["status"] }),
  });
  const ordered = [...issues].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      a.issueCode.localeCompare(b.issueCode),
  );
  const blockerCount = issues.filter((issue) => issue.severity === "BLOCKER").length;
  const highCount = issues.filter((issue) => issue.severity === "HIGH").length;

  let detail: { row: IssueRow; references: ResolvedReference[] } | null = null;
  if (query.code) {
    try {
      const row = await getIssueByCode(db, user.id, projectId, query.code);
      detail = { row, references: await resolveReferences(db, user.id, projectId, row.references) };
    } catch (error) {
      if (!(error instanceof IssueNotFoundError)) throw error;
    }
  }

  const base = `/projects/${projectId}/issues`;
  const listHref = (severity: string, status: string) =>
    `${base}?severity=${encodeURIComponent(severity)}&status=${encodeURIComponent(status)}`;
  const detailHref = (code: string) =>
    `${base}?severity=${encodeURIComponent(activeSeverity)}&status=${encodeURIComponent(activeStatus)}&code=${code}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <div>
        <Link href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Validation issues</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {blockerCount} blockers · {highCount} high · {issues.length} shown
        </p>
      </div>

      <nav aria-label="Filter by severity" className="flex flex-wrap gap-2">
        {ISSUE_SEVERITY_FILTERS.map((filter) => (
          <a
            key={filter}
            href={listHref(filter, activeStatus)}
            aria-current={activeSeverity === filter ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              activeSeverity === filter
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {filter}
          </a>
        ))}
      </nav>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {ISSUE_STATUS_FILTERS.map((filter) => (
          <a
            key={filter}
            href={listHref(activeSeverity, filter)}
            aria-current={activeStatus === filter ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              activeStatus === filter
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {filter}
          </a>
        ))}
      </nav>

      {ordered.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
          No issues match. Run validation and findings appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((issue) => {
            const severity = issueSeverityLabel(issue.severity);
            const type = issueTypeLabel(issue.type);
            const prominent = issue.severity === "BLOCKER" || issue.severity === "HIGH";
            return (
              <li
                key={issue.issueCode}
                className={`flex flex-wrap items-center justify-between gap-2 rounded border p-3 ${
                  prominent ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span className="mr-2 font-mono text-xs text-zinc-500">{issue.issueCode}</span>
                    {issue.title}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">
                    {severity.glyph} {severity.label} · {type.glyph} {type.label} · {issue.status} ·{" "}
                    {issue.references.length} artifact
                    {issue.references.length === 1 ? "" : "s"}
                  </p>
                </div>
                <a
                  href={detailHref(issue.issueCode)}
                  className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
                >
                  View
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {detail && (
        <section aria-label="Issue detail" className="rounded border border-zinc-900 p-4">
          <h2 className="text-lg font-semibold">{detail.row.title}</h2>
          <p className="font-mono text-xs text-zinc-500">{detail.row.issueCode}</p>
          <p className="mt-2 text-sm text-zinc-600">
            {issueSeverityLabel(detail.row.severity).glyph}{" "}
            {issueSeverityLabel(detail.row.severity).label} ·{" "}
            {issueTypeLabel(detail.row.type).glyph} {issueTypeLabel(detail.row.type).label} ·{" "}
            {detail.row.status}
          </p>
          <p className="mt-1 text-sm text-zinc-500">{issueTypeLabel(detail.row.type).hint}</p>
          <p className="mt-3 text-sm">{detail.row.description}</p>

          <h3 className="mt-4 text-sm font-medium">Affected artifacts</h3>
          {detail.references.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-500">No linked artifacts.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {detail.references.map((reference) => (
                <li key={reference.key}>
                  {reference.href ? (
                    <a href={reference.href} className="text-zinc-900 underline">
                      {reference.label}
                    </a>
                  ) : (
                    <span className="text-zinc-700">{reference.label}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {detail.row.status === "OPEN" && (
            <>
              <h3 className="mt-4 text-sm font-medium">Resolve issue</h3>
              {query.error === "empty" && (
                <p role="alert" className="mt-1 text-sm text-red-700">
                  Describe the resolution first.
                </p>
              )}
              <form
                action={resolveAction.bind(null, projectId, detail.row.issueCode)}
                className="mt-2 flex flex-col gap-2"
              >
                <label className="flex flex-col gap-1 text-sm">
                  Resolution
                  <textarea
                    name="resolution"
                    rows={2}
                    placeholder="What fixed it, or why it no longer applies."
                    className="rounded border border-zinc-300 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  className="w-fit rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                >
                  Mark resolved
                </button>
              </form>
            </>
          )}
        </section>
      )}
    </main>
  );
}
