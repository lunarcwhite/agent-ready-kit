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
import { OperationFailure } from "@/app/components/operation-status";
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
import {
  BackLink,
  Badge,
  PageHeader,
  btnPrimary,
  btnSecondary,
  cardCls,
  faintText,
} from "@/app/components/ui";

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
  if (value === null || value === undefined) return "–";
  if (typeof value === "string") return value === "" ? "–" : value;
  try {
    return JSON.stringify(value) ?? "–";
  } catch {
    return "–";
  }
}

function statusGlyph(status: string): string {
  if (status === "CONFIRMED") return "✓";
  if (status === "RECOMMENDED") return "◇";
  if (status === "NOT_APPLICABLE") return "–";
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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <PageHeader
        eyebrow={<BackLink href="/projects">← Projects</BackLink>}
        title="Discovery"
        description="Answer only what matters. Each answer becomes structured decisions: never just chat history."
        meta={<Badge status={level.level}>Level · {discoveryLevelLabel(level.level)}</Badge>}
      />

      {query.error === "save" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          Couldn&apos;t save that. Your approved work is unchanged. Try again.
        </p>
      )}
      {query.error === "empty" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          Write an answer first, or mark the topic not applicable.
        </p>
      )}
      {query.error === "generate" && (
        <OperationFailure
          title="Couldn't generate a question."
          detail="Formulating the next question failed."
        />
      )}
      {query.error === "interpret" && (
        <OperationFailure
          title="Answer saved, but it couldn't be interpreted."
          detail="Understanding your answer failed. Nothing was applied to your decisions."
        />
      )}
      {query.error === "apply" && (
        <OperationFailure
          title="Answer saved and understood, but the decisions couldn't be applied."
          detail="Updating project knowledge failed. Your previous decisions are unchanged."
        />
      )}
      {summaryDecisions.length > 0 && (
        <section
          aria-label="Understood"
          className="rounded border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950"
        >
          <h2 className="text-sm font-medium text-green-800 dark:text-green-200">Understood</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-green-900 dark:text-green-200">
            {summaryDecisions.map((decision) => (
              <li key={decision.decisionCode}>
                {statusGlyph(decision.status)} {decision.title} ·{" "}
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

      <div className="grid items-start gap-6 md:grid-cols-[280px_1fr]">
        <section aria-label="Discovery progress" className="flex flex-col gap-3 md:sticky md:top-6">
          <div className={`${cardCls}`}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Discovery level</h2>
            <p className="mt-1 text-lg font-semibold tracking-tight">{discoveryLevelLabel(level.level)}</p>
            {level.nextLevel ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                {level.missingForNext.map((missing) => (
                  <li key={missing}>○ {missing}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">All domains handled. ✓</p>
            )}
          </div>
          <div className={`${cardCls}`}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Progress</h2>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {nodes.map((node) => {
                const badge = nodeStatusLabel(node.status);
                return (
                  <li key={node.nodeKey} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <span className="text-zinc-900 dark:text-zinc-100">{node.title}</span>
                    <span className={faintText}>
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
            <div className="rounded-lg border border-zinc-900 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-950">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Current focus · {nextNode.category}</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">{nextNode.title}</h2>
              {nextNode.description && (
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{nextNode.description}</p>
              )}
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Why now: {next.reasons.join(" · ")}</p>
              <form
                action={generateQuestionAction.bind(
                  null,
                  projectId,
                  activeSession.id,
                  next.nodeKey,
                )}
                className="mt-4"
              >
                <button
                  type="submit"
                  className={btnSecondary}
                >
                  Generate question for this topic
                </button>
              </form>
            </div>
          ) : (
            <div className={`${cardCls}`}>
              <h2 className="text-xl font-semibold tracking-tight">
                {ranked.length === 0 ? "Discovery complete ✓" : "No active session"}
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
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
                  <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    No messages yet. Your answers appear here and survive reload.
                  </li>
                )}
                {messages.map((row) => (
                  <li
                    key={row.id}
                    className={
                      row.role === "USER"
                        ? "ml-6 rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950"
                        : row.role === "ASSISTANT"
                          ? "rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-900"
                          : "rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                    }
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {messageRoleLabel(row.role)}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{row.content}</p>
                  </li>
                ))}
              </ol>

              {activeSession.status === "ACTIVE" && next && nextNode ? (
                <>
                  {latestAssistant?.metadata?.recommendation && (
                    <div
                      aria-label="Recommended choice"
                      className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">Recommended: suggestion, not decided</p>
                      <p className="mt-1 text-sm font-semibold">
                        ● {latestAssistant.metadata.recommendation.optionLabel}
                      </p>
                      <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
                        {latestAssistant.metadata.recommendation.rationale}
                      </p>
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        A suggestion. Pick it below, choose another option, or write your own
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
                              className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-2 min-h-[44px] text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      Your answer
                      <textarea
                        name="content"
                        rows={3}
                        placeholder="Answer in your own words…"
                        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-normal placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder:text-zinc-500 dark:focus:border-zinc-100"
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        className={btnPrimary}
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
                        className={btnSecondary}
                      >
                        Not applicable to this project
                      </button>
                    </div>
                  </form>
                  <form
                    action={endSessionAction.bind(null, projectId, activeSession.id, "COMPLETED")}
                  >
                    <button type="submit" className="inline-flex min-h-[44px] items-center text-sm text-zinc-500 dark:text-zinc-400 hover:underline">
                      Finish this session
                    </button>
                  </form>
                </>
              ) : (
                activeSession.status !== "ACTIVE" && (
                  <form action={startSessionAction.bind(null, projectId)}>
                    <button
                      type="submit"
                      className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Start discovery session
              </button>
            </form>
          )}

          {sessions.length > 1 && (
            <div className="rounded border border-zinc-200 dark:border-zinc-800 p-4">
              <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Past sessions</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {sessions
                  .filter((session) => session.id !== activeSession?.id)
                  .map((session) => (
                    <li key={session.id}>
                      <a
                        href={`/projects/${projectId}/discovery?session=${session.id}`}
                        className="inline-flex min-h-[44px] items-center text-zinc-700 dark:text-zinc-300 hover:underline"
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
