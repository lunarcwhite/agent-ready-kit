// Decision Center (SCREEN-008/009 per design.md §92; TASK-058).
//
// Structured view over canonical decisions (TASK-021): filter by status,
// inspect value/provenance/impact/history, confirm AI recommendations, and
// change decisions with an explicit reason. High-impact changes execute the
// deterministic dependency cascade on save (TASK-022); the preview-style
// impact review arrives with TASK-113, so the form warns before applying.
//
// Server component, no client JS — same convention as Discovery. Detail
// renders inline via ?code= rather than a separate route (design.md §92:
// SCREEN-* are concepts, not mandatory URLs).
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError, ProjectValidationError } from "@/modules/projects/errors";
import {
  getDecisionByCode,
  getDecisionHistory,
  listDecisions,
  updateDecision,
} from "@/modules/decisions/decisions";
import { DecisionNotFoundError, DecisionValidationError } from "@/modules/decisions/errors";
import { getProvenanceDisplay, withProvenance } from "@/modules/provenance/provenance";
import {
  DECISION_STATUS_FILTERS,
  decisionStatusLabel,
  filterToStatus,
  formatDecisionValue,
} from "./labels";

async function confirmAction(projectId: string, decisionKey: string): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  try {
    // Confirming adopts the recommendation as the user's own explicit
    // decision (human authority, soul §9) — provenance becomes USER_EXPLICIT.
    await updateDecision(getDb(), user.id, projectId, decisionKey, {
      status: "CONFIRMED",
      sourceType: "USER",
      confidence: "EXPLICIT",
      changeReason: "Confirmed in Decision Center.",
    });
  } catch {
    redirect(`/projects/${projectId}/decisions?error=save`);
  }
  redirect(`/projects/${projectId}/decisions`);
}

async function updateAction(
  projectId: string,
  decisionKey: string,
  formData: FormData,
): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  const rawValue = String(formData.get("value") ?? "").trim();
  const rationale = String(formData.get("rationale") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "").trim() || undefined;
  let value: unknown;
  try {
    value = rawValue === "" ? null : (JSON.parse(rawValue) as unknown);
  } catch {
    redirect(`/projects/${projectId}/decisions?error=invalid`);
  }
  try {
    await updateDecision(getDb(), user.id, projectId, decisionKey, {
      value,
      rationale,
      ...(status === undefined
        ? {}
        : {
            status: status as
              "UNRESOLVED" | "RECOMMENDED" | "CONFIRMED" | "DEFERRED" | "NOT_APPLICABLE",
          }),
      changeReason: "Updated in Decision Center.",
    });
  } catch (error) {
    if (error instanceof DecisionValidationError || error instanceof ProjectValidationError) {
      redirect(`/projects/${projectId}/decisions?error=invalid`);
    }
    throw error;
  }
  redirect(`/projects/${projectId}/decisions`);
}

export default async function DecisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ filter?: string; code?: string; error?: string }>;
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

  const activeFilter = query.filter ?? "All";
  const statusFilter = filterToStatus(activeFilter);
  const decisions = await listDecisions(
    db,
    user.id,
    projectId,
    statusFilter === undefined
      ? undefined
      : {
          status: statusFilter as
            "UNRESOLVED" | "RECOMMENDED" | "CONFIRMED" | "DEFERRED" | "NOT_APPLICABLE",
        },
  );
  const confirmed = decisions.filter((row) => row.status === "CONFIRMED").length;
  const unresolved = decisions.filter((row) => row.status === "UNRESOLVED").length;
  const grouped = new Map<string, typeof decisions>();
  for (const row of decisions) {
    const list = grouped.get(row.category) ?? [];
    list.push(row);
    grouped.set(row.category, list);
  }

  let detail = null;
  if (query.code) {
    try {
      const row = await getDecisionByCode(db, user.id, projectId, query.code);
      const history = await getDecisionHistory(db, user.id, projectId, row.decisionKey);
      detail = { row, history };
    } catch (error) {
      if (!(error instanceof DecisionNotFoundError)) throw error;
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <div>
        <a href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </a>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Decisions</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {confirmed} confirmed · {unresolved} unresolved
        </p>
      </div>

      {query.error === "save" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Couldn&apos;t save that. Your approved decisions are unchanged — try again.
        </p>
      )}
      {query.error === "invalid" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          That value must be valid JSON, or the status is invalid.
        </p>
      )}

      <nav aria-label="Filter decisions" className="flex flex-wrap gap-2">
        {DECISION_STATUS_FILTERS.map((filter) => (
          <a
            key={filter}
            href={`/projects/${projectId}/decisions${filter === "All" ? "" : `?filter=${filter}`}`}
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

      {decisions.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
          No decisions match this filter. Answer discovery questions and they appear here.
        </p>
      ) : (
        [...grouped.entries()].map(([category, rows]) => (
          <section key={category} aria-label={category}>
            <h2 className="text-sm font-medium text-zinc-500">{category}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {rows.map((row) => {
                const badge = decisionStatusLabel(row.status);
                const provenance = getProvenanceDisplay(
                  withProvenance({ sourceType: row.sourceType, confidence: row.confidence })
                    .provenance,
                ).label;
                return (
                  <li
                    key={row.decisionCode}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <span className="mr-2 font-mono text-xs text-zinc-500">
                          {row.decisionCode}
                        </span>
                        {row.title}
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        {badge.glyph} {badge.label} · {formatDecisionValue(row.value)} ·{" "}
                        {row.impact} impact · {provenance}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`/projects/${projectId}/decisions?code=${row.decisionCode}${statusFilter ? `&filter=${activeFilter}` : ""}`}
                        className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
                      >
                        View
                      </a>
                      {row.status === "RECOMMENDED" && (
                        <form action={confirmAction.bind(null, projectId, row.decisionKey)}>
                          <button
                            type="submit"
                            className="rounded bg-zinc-900 px-3 py-1 text-sm font-medium text-white hover:bg-zinc-700"
                          >
                            Confirm
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {detail && (
        <section aria-label="Decision detail" className="rounded border border-zinc-900 p-4">
          <h2 className="text-lg font-semibold">{detail.row.title}</h2>
          <p className="font-mono text-xs text-zinc-500">{detail.row.decisionCode}</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Status</dt>
              <dd>{decisionStatusLabel(detail.row.status).label}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Decision</dt>
              <dd>{formatDecisionValue(detail.row.value)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Impact</dt>
              <dd>{detail.row.impact}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-zinc-500">Source</dt>
              <dd>
                {
                  getProvenanceDisplay(
                    withProvenance({
                      sourceType: detail.row.sourceType,
                      confidence: detail.row.confidence,
                    }).provenance,
                  ).label
                }
              </dd>
            </div>
            {detail.row.rationale && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-zinc-500">Why</dt>
                <dd>{detail.row.rationale}</dd>
              </div>
            )}
          </dl>

          <h3 className="mt-4 text-sm font-medium">History</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm text-zinc-600">
            {detail.history.map((entry) => (
              <li key={entry.id}>
                v{entry.version} · {entry.status} · {formatDecisionValue(entry.value)}
                {entry.changeReason ? ` · ${entry.changeReason}` : ""}
              </li>
            ))}
          </ul>

          <h3 className="mt-4 text-sm font-medium">Change decision</h3>
          {detail.row.impact === "HIGH" && (
            <p className="mt-1 text-sm text-amber-800">
              ! High-impact change: saving runs the dependency cascade and may mark dependent
              decisions not applicable.
            </p>
          )}
          <form
            action={updateAction.bind(null, projectId, detail.row.decisionKey)}
            className="mt-2 flex flex-col gap-2"
          >
            <label className="flex flex-col gap-1 text-sm">
              Value (JSON)
              <textarea
                name="value"
                rows={2}
                defaultValue={JSON.stringify(detail.row.value)}
                className="rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Rationale
              <input
                name="rationale"
                type="text"
                defaultValue={detail.row.rationale ?? ""}
                className="rounded border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Status
              <select
                name="status"
                defaultValue={detail.row.status}
                className="rounded border border-zinc-300 px-3 py-2"
              >
                <option value="UNRESOLVED">Needs decision</option>
                <option value="RECOMMENDED">Recommended</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="DEFERRED">Deferred</option>
                <option value="NOT_APPLICABLE">Not applicable</option>
              </select>
            </label>
            <button
              type="submit"
              className="w-fit rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              Save change
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
