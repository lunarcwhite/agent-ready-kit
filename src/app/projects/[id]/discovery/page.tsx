// Discovery workspace (SCREEN-007 per screen-blueprint.md §7; TASK-034).
//
// Structured Discovery interface, not generic chat: the progress panel makes
// the purpose visible (design.md §23), the current topic is prominent, and
// resume state comes from the database — navigation or reload returns to the
// same session and history.
//
// Server component, no client JS. The focus card presents the
// deterministically selected next topic (TASK-032) with its reasons; the
// "Generate question" action formulates one AI question for exactly that
// topic (TASK-052 Interviewer — never reorders the map) and stores it as
// conversation evidence (TASK-033) with options and an identified
// recommendation. The answer form stores natural-language replies, and
// suggested options render when present — custom answers always stay
// possible via the composer.
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { getProject } from "@/modules/projects/repository";
import { ProjectNotFoundError } from "@/modules/projects/errors";
import {
  appendDiscoveryMessage,
  endDiscoverySession,
  listDiscoveryMessages,
  listDiscoverySessions,
  startDiscoverySession,
} from "@/modules/discovery/conversation";
import {
  ensureDiscoveryMap,
  getDiscoveryMap,
  updateDiscoveryNode,
} from "@/modules/discovery/discovery";
import { selectNextDiscoveryTopic } from "@/modules/discovery/prioritization";
import { generateDiscoveryQuestion } from "@/modules/discovery/interviewer";
import { interpretAnswer } from "@/modules/discovery/answer-interpreter";
import { applyInterpretation, parseAppliedCodes } from "@/modules/discovery/candidate-application";
import { getDecisionByCode } from "@/modules/decisions/decisions";
import type { DecisionRow } from "@/modules/decisions/decisions";
import { getProvenanceDisplay, withProvenance } from "@/modules/provenance/provenance";
import { calculateDiscoveryLevel } from "@/modules/discovery/level";
import { discoveryLevelLabel, nodeStatusLabel } from "./labels";

async function startSessionAction(projectId: string): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  const session = await startDiscoverySession(getDb(), user.id, projectId).catch(() => null);
  if (!session) redirect(`/projects/${projectId}/discovery?error=session`);
  redirect(`/projects/${projectId}/discovery?session=${session.id}`);
}

async function answerAction(
  projectId: string,
  sessionId: string,
  formData: FormData,
): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  const content = String(formData.get("content") ?? "").trim();
  const nodeKey = String(formData.get("nodeKey") ?? "").trim() || undefined;
  if (content === "") redirect(`/projects/${projectId}/discovery?session=${sessionId}&error=empty`);
  // Interpretation is evidence linked to the answer (TASK-033/TASK-053):
  // the raw answer is always preserved, the structured reading rides along
  // when it succeeds. Validated candidates are then applied to canonical
  // decisions (TASK-054: explicit→confirmed, inferred→recommended); the
  // answer and its evidence survive even when application fails.
  let interpretation: unknown = undefined;
  let aiOperationId: string | undefined;
  let interpreted = true;
  let applied = true;
  let appliedCodes: string[] = [];
  try {
    const result = await interpretAnswer(getDb(), user.id, projectId, {
      answer: content,
      nodeKey,
      sessionId,
    });
    interpretation = result.interpretation;
    aiOperationId = result.operationId;
    try {
      const appliedResult = await applyInterpretation(
        getDb(),
        user.id,
        projectId,
        result.interpretation,
      );
      // Codes only — the summary page resolves them against persisted
      // decisions, so it can never claim an unpersisted change (TASK-057).
      appliedCodes = appliedResult.applied.map((row) => row.decisionCode);
    } catch {
      applied = false;
    }
  } catch {
    interpreted = false;
    applied = false;
  }
  try {
    await appendDiscoveryMessage(getDb(), user.id, projectId, sessionId, {
      role: "USER",
      content,
      nodeKey,
      aiOperationId,
      interpretation,
    });
  } catch {
    redirect(`/projects/${projectId}/discovery?session=${sessionId}&error=save`);
  }
  const errorSuffix = !interpreted ? "&error=interpret" : !applied ? "&error=apply" : "";
  const appliedSuffix =
    interpreted && applied && appliedCodes.length > 0 ? `&applied=${appliedCodes.join(",")}` : "";
  redirect(`/projects/${projectId}/discovery?session=${sessionId}${errorSuffix}${appliedSuffix}`);
}

async function generateQuestionAction(
  projectId: string,
  sessionId: string,
  nodeKey: string,
): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  try {
    const generated = await generateDiscoveryQuestion(getDb(), user.id, projectId, nodeKey);
    await appendDiscoveryMessage(getDb(), user.id, projectId, sessionId, {
      role: "ASSISTANT",
      content: generated.question.question,
      nodeKey: generated.nodeKey,
      aiOperationId: generated.operationId,
      options: generated.question.options.map((option) => option.label),
      recommendation: generated.question.recommendation,
    });
  } catch {
    redirect(`/projects/${projectId}/discovery?session=${sessionId}&error=generate`);
  }
  redirect(`/projects/${projectId}/discovery?session=${sessionId}`);
}

async function notApplicableAction(
  projectId: string,
  sessionId: string,
  nodeKey: string,
): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  try {
    await updateDiscoveryNode(getDb(), user.id, projectId, nodeKey, {
      status: "NOT_APPLICABLE",
    });
    await appendDiscoveryMessage(getDb(), user.id, projectId, sessionId, {
      role: "SYSTEM",
      content: `Marked ${nodeKey} as not applicable.`,
      nodeKey,
    });
  } catch {
    redirect(`/projects/${projectId}/discovery?session=${sessionId}&error=save`);
  }
  redirect(`/projects/${projectId}/discovery?session=${sessionId}`);
}

async function endSessionAction(
  projectId: string,
  sessionId: string,
  status: "COMPLETED" | "ABANDONED",
): Promise<void> {
  "use server";
  const user = (await getSessionUser()) ?? redirect("/login");
  try {
    await endDiscoverySession(getDb(), user.id, projectId, sessionId, status);
  } catch {
    redirect(`/projects/${projectId}/discovery?session=${sessionId}&error=save`);
  }
  redirect(`/projects/${projectId}/discovery`);
}

function messageRoleLabel(role: string): string {
  if (role === "USER") return "You";
  if (role === "ASSISTANT") return "Agent Ready Kit";
  return "System";
}

function formatDecisionValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? "—" : value;
  try {
    return JSON.stringify(value) ?? "—";
  } catch {
    return "—";
  }
}

function statusGlyph(status: string): string {
  if (status === "CONFIRMED") return "✓";
  if (status === "RECOMMENDED") return "◇";
  if (status === "NOT_APPLICABLE") return "—";
  return "•";
}

export default async function DiscoveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ session?: string; error?: string; applied?: string }>;
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

  // Idempotent: first visit seeds the nine UNKNOWN nodes; later visits are
  // free reads, so reload always resumes the same map.
  await ensureDiscoveryMap(db, user.id, projectId);
  const nodes = await getDiscoveryMap(db, user.id, projectId);
  const level = calculateDiscoveryLevel(nodes);
  const ranked = await selectNextDiscoveryTopic(db, user.id, projectId);
  const next = ranked[0] ?? null;
  const nextNode = next ? nodes.find((node) => node.nodeKey === next.nodeKey) : undefined;

  const sessions = await listDiscoverySessions(db, user.id, projectId);
  const activeSession =
    sessions.find((session) => session.id === query.session) ??
    sessions.find((session) => session.status === "ACTIVE") ??
    null;
  const messages = activeSession
    ? await listDiscoveryMessages(db, user.id, projectId, activeSession.id)
    : [];
  // Interpretation summary (TASK-057): codes resolve against persisted
  // decisions only, so the card reflects what was actually saved — never
  // what was merely attempted. Unresolvable codes drop out silently.
  const summaryDecisions: DecisionRow[] = [];
  for (const code of parseAppliedCodes(query.applied)) {
    try {
      summaryDecisions.push(await getDecisionByCode(db, user.id, projectId, code));
    } catch {
      continue;
    }
  }
  const latestAssistant = [...messages].reverse().find((row) => row.role === "ASSISTANT");
  const suggestedOptions =
    latestAssistant?.metadata &&
    Array.isArray((latestAssistant.metadata as { options?: unknown }).options)
      ? ((latestAssistant.metadata as { options: string[] }).options ?? [])
      : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <div>
        <a href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </a>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Discovery</h1>
      </div>

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
          Write an answer first, or mark the topic not applicable.
        </p>
      )}
      {query.error === "generate" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Couldn&apos;t generate a question. Nothing was changed — try again.
        </p>
      )}
      {query.error === "interpret" && (
        <p
          role="alert"
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          Answer saved, but it couldn&apos;t be interpreted. Nothing was applied to your decisions —
          try answering again.
        </p>
      )}
      {query.error === "apply" && (
        <p
          role="alert"
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          Answer saved and understood, but the decisions couldn&apos;t be applied. Your previous
          decisions are unchanged — try answering again.
        </p>
      )}
      {summaryDecisions.length > 0 && (
        <section
          aria-label="Understood"
          className="rounded border border-green-200 bg-green-50 p-4"
        >
          <h2 className="text-sm font-medium text-green-800">Understood</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-green-900">
            {summaryDecisions.map((decision) => (
              <li key={decision.decisionCode}>
                {statusGlyph(decision.status)} {decision.title} —{" "}
                {formatDecisionValue(decision.value)} ·{" "}
                {
                  getProvenanceDisplay(
                    withProvenance({
                      sourceType: decision.sourceType,
                      confidence: decision.confidence,
                    }).provenance,
                  ).label
                }
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <section aria-label="Discovery progress" className="flex flex-col gap-4">
          <div className="rounded border border-zinc-200 p-4">
            <h2 className="text-sm font-medium text-zinc-500">Discovery Level</h2>
            <p className="mt-1 text-lg font-semibold">{discoveryLevelLabel(level.level)}</p>
            {level.nextLevel ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm text-zinc-600">
                {level.missingForNext.map((missing) => (
                  <li key={missing}>○ {missing}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">All domains handled. ✓</p>
            )}
          </div>
          <div className="rounded border border-zinc-200 p-4">
            <h2 className="text-sm font-medium text-zinc-500">Progress</h2>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {nodes.map((node) => {
                const badge = nodeStatusLabel(node.status);
                return (
                  <li key={node.nodeKey} className="flex items-center justify-between gap-2">
                    <span>{node.title}</span>
                    <span className="text-zinc-500">
                      {badge.glyph} {badge.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section aria-label="Conversation" className="flex flex-col gap-4">
          {next && nextNode && activeSession?.status === "ACTIVE" ? (
            <div className="rounded border border-zinc-900 p-4">
              <p className="text-sm text-zinc-500">Current focus · {nextNode.category}</p>
              <h2 className="mt-1 text-xl font-semibold">{nextNode.title}</h2>
              {nextNode.description && (
                <p className="mt-1 text-sm text-zinc-600">{nextNode.description}</p>
              )}
              <p className="mt-2 text-sm text-zinc-600">Why now: {next.reasons.join(" · ")}</p>
              <form
                action={generateQuestionAction.bind(
                  null,
                  projectId,
                  activeSession.id,
                  next.nodeKey,
                )}
                className="mt-3"
              >
                <button
                  type="submit"
                  className="rounded border border-zinc-900 px-4 py-2 text-sm font-medium hover:bg-zinc-100"
                >
                  Generate question for this topic
                </button>
              </form>
            </div>
          ) : (
            <div className="rounded border border-zinc-200 p-4">
              <h2 className="text-xl font-semibold">
                {ranked.length === 0 ? "Discovery complete ✓" : "No active session"}
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                {ranked.length === 0
                  ? "Every domain is resolved or marked not applicable."
                  : "Start a session to begin answering discovery topics."}
              </p>
            </div>
          )}

          {activeSession ? (
            <>
              <ol className="flex flex-col gap-3">
                {messages.length === 0 && (
                  <li className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
                    No messages yet. Your answers appear here and survive reload.
                  </li>
                )}
                {messages.map((row) => (
                  <li key={row.id} className="rounded border border-zinc-200 p-3">
                    <p className="text-xs font-medium text-zinc-500">
                      {messageRoleLabel(row.role)}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{row.content}</p>
                  </li>
                ))}
              </ol>

              {activeSession.status === "ACTIVE" && next && nextNode ? (
                <>
                  {latestAssistant?.metadata?.recommendation && (
                    <div
                      aria-label="Recommended choice"
                      className="rounded border border-amber-300 bg-amber-50 p-4"
                    >
                      <p className="text-sm font-medium text-amber-800">Recommended</p>
                      <p className="mt-1 text-sm font-semibold">
                        ● {latestAssistant.metadata.recommendation.optionLabel}
                      </p>
                      <p className="mt-1 text-sm text-amber-900">
                        {latestAssistant.metadata.recommendation.rationale}
                      </p>
                      <p className="mt-1 text-xs text-amber-700">
                        A suggestion — pick it below, choose another option, or write your own
                        answer.
                      </p>
                    </div>
                  )}
                  {suggestedOptions.length > 0 && (
                    <div className="flex flex-wrap gap-2" aria-label="Suggested options">
                      {suggestedOptions
                        .filter((option) => typeof option === "string" && option.trim() !== "")
                        .map((option) => (
                          <form
                            key={option}
                            action={answerAction.bind(null, projectId, activeSession.id)}
                          >
                            <input type="hidden" name="content" value={option} />
                            <input type="hidden" name="nodeKey" value={next.nodeKey} />
                            <button
                              type="submit"
                              className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50"
                            >
                              {option}
                            </button>
                          </form>
                        ))}
                    </div>
                  )}
                  <form
                    action={answerAction.bind(null, projectId, activeSession.id)}
                    className="flex flex-col gap-2"
                  >
                    <input type="hidden" name="nodeKey" value={next.nodeKey} />
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      Your answer
                      <textarea
                        name="content"
                        rows={3}
                        placeholder="Answer in your own words…"
                        className="rounded border border-zinc-300 px-3 py-2 font-normal"
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                      >
                        Save answer
                      </button>
                      <button
                        type="submit"
                        formAction={notApplicableAction.bind(
                          null,
                          projectId,
                          activeSession.id,
                          next.nodeKey,
                        )}
                        className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
                      >
                        Not applicable to this project
                      </button>
                    </div>
                  </form>
                  <form
                    action={endSessionAction.bind(null, projectId, activeSession.id, "COMPLETED")}
                  >
                    <button type="submit" className="text-sm text-zinc-500 hover:underline">
                      Finish this session
                    </button>
                  </form>
                </>
              ) : (
                activeSession.status !== "ACTIVE" && (
                  <form action={startSessionAction.bind(null, projectId)}>
                    <button
                      type="submit"
                      className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                    >
                      Continue where I left off
                    </button>
                  </form>
                )
              )}
            </>
          ) : (
            <form action={startSessionAction.bind(null, projectId)}>
              <button
                type="submit"
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
              >
                Start discovery session
              </button>
            </form>
          )}

          {sessions.length > 1 && (
            <div className="rounded border border-zinc-200 p-4">
              <h2 className="text-sm font-medium text-zinc-500">Past sessions</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {sessions
                  .filter((session) => session.id !== activeSession?.id)
                  .map((session) => (
                    <li key={session.id}>
                      <a
                        href={`/projects/${projectId}/discovery?session=${session.id}`}
                        className="text-zinc-700 hover:underline"
                      >
                        {session.status === "ACTIVE"
                          ? "Active session"
                          : session.status === "COMPLETED"
                            ? "Completed session"
                            : "Abandoned session"}
                        {" · "}
                        {session.startedAt.toLocaleDateString()}
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
