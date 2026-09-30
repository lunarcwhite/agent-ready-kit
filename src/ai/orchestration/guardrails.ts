// AI usage guardrails (TASK-046, architecture.md §54).
//
// Deterministic, fail-closed preflight checks enforced by the orchestrator
// (TASK-045) after the operation row opens and before any provider spend:
//   - input/context size budgets (pure, no database);
//   - hourly operation caps per user and per project (ledger-backed);
//   - in-flight concurrency cap per project (double-click/retry storms);
//   - usage summary for operational inspection.
//
// Violations throw GuardrailError: the orchestrator records the refusal as
// a FAILED ledger row and surfaces an understandable, actionable message —
// never a stack trace, never silently. Refusals create no canonical state
// and consume no provider budget. Timeout enforcement itself stays where
// it belongs (TASK-040 provider config + per-call timeout); this module
// owns the request-side budgets around it.
import { and, eq, gte } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { aiOperations } from "../../infrastructure/database/schema/ai-operations";

export class GuardrailError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GuardrailError";
    this.code = code;
  }
}

export interface GuardrailLimits {
  maxTaskInputChars: number;
  maxContextChars: number;
  maxOpsPerUserPerHour: number;
  maxOpsPerProjectPerHour: number;
  maxRunningPerProject: number;
}

export const DEFAULT_LIMITS: GuardrailLimits = {
  // Matches the largest legitimate caller input (idea + optionals, 20k).
  maxTaskInputChars: 20_000,
  // Context projections stay small by construction (TASK-044 budgets);
  // this is a backstop against pathological growth, not a tuning knob.
  maxContextChars: 100_000,
  maxOpsPerUserPerHour: 100,
  maxOpsPerProjectPerHour: 100,
  // Parallel question/interpret generations are sequential in practice;
  // five concurrent in-flights means a client storm, not a workflow.
  maxRunningPerProject: 5,
};

// Stale RUNNING rows (crashed process, never finished) stop counting after
// this long, so a dead worker cannot wedge a project forever.
const RUNNING_STALE_MS = 30 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;

export function checkSizeLimits(
  taskInput: string,
  contextJson: string,
  limits: GuardrailLimits = DEFAULT_LIMITS,
): void {
  if (taskInput.length > limits.maxTaskInputChars) {
    throw new GuardrailError(
      "INPUT_TOO_LARGE",
      `Task input is too large (${taskInput.length} characters, limit ${limits.maxTaskInputChars}). Shorten the input and try again.`,
    );
  }
  if (contextJson.length > limits.maxContextChars) {
    throw new GuardrailError(
      "CONTEXT_TOO_LARGE",
      `Project context is too large (${contextJson.length} characters, limit ${limits.maxContextChars}). Narrow the request and try again.`,
    );
  }
}

async function countRecentOps(
  db: AppDatabase,
  filter: "user" | "project",
  id: string,
  since: Date,
): Promise<number> {
  const rows = await db.query.aiOperations.findMany({
    columns: { id: true },
    where:
      filter === "user"
        ? and(eq(aiOperations.userId, id), gte(aiOperations.createdAt, since))
        : and(eq(aiOperations.projectId, id), gte(aiOperations.createdAt, since)),
  });
  return rows.length;
}

export async function checkRateLimits(
  db: AppDatabase,
  userId: string,
  projectId: string,
  limits: GuardrailLimits = DEFAULT_LIMITS,
  now: Date = new Date(),
): Promise<void> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const [userCount, projectCount] = await Promise.all([
    countRecentOps(db, "user", userId, since),
    countRecentOps(db, "project", projectId, since),
  ]);
  if (userCount >= limits.maxOpsPerUserPerHour) {
    throw new GuardrailError(
      "RATE_LIMITED",
      `Rate limit reached: at most ${limits.maxOpsPerUserPerHour} AI operations per hour. Try again later.`,
    );
  }
  if (projectCount >= limits.maxOpsPerProjectPerHour) {
    throw new GuardrailError(
      "RATE_LIMITED",
      `Rate limit reached for this project: at most ${limits.maxOpsPerProjectPerHour} AI operations per hour. Try again later.`,
    );
  }
}

export async function checkConcurrency(
  db: AppDatabase,
  projectId: string,
  limits: GuardrailLimits = DEFAULT_LIMITS,
  now: Date = new Date(),
): Promise<void> {
  const freshSince = new Date(now.getTime() - RUNNING_STALE_MS);
  const running = await db.query.aiOperations.findMany({
    columns: { id: true },
    where: and(
      eq(aiOperations.projectId, projectId),
      eq(aiOperations.status, "RUNNING"),
      gte(aiOperations.startedAt, freshSince),
    ),
  });
  // The caller's own just-opened row counts: exceeding the cap means more
  // in-flights than any legitimate workflow produces.
  if (running.length > limits.maxRunningPerProject) {
    throw new GuardrailError(
      "CONCURRENT_LIMIT",
      `Too many AI operations are already running for this project (limit ${limits.maxRunningPerProject}). Wait for one to finish and try again.`,
    );
  }
}

export interface GuardrailCheckInput {
  taskInput: string;
  contextJson: string;
}

export async function enforceGuards(
  db: AppDatabase,
  userId: string,
  projectId: string,
  input: GuardrailCheckInput,
  limits: GuardrailLimits = DEFAULT_LIMITS,
  now: Date = new Date(),
): Promise<void> {
  checkSizeLimits(input.taskInput, input.contextJson, limits);
  await checkRateLimits(db, userId, projectId, limits, now);
  await checkConcurrency(db, projectId, limits, now);
}

export interface UsageSummary {
  windowHours: number;
  total: number;
  byCapability: Record<string, number>;
  byStatus: Record<string, number>;
}

// Operational inspection (TASK-046 acceptance): aggregates the ledger over
// a trailing window without exposing prompts or project content.
export async function getUsageSummary(
  db: AppDatabase,
  userId: string,
  filter?: { projectId?: string; windowHours?: number },
): Promise<UsageSummary> {
  if (userId.trim() === "") throw new GuardrailError("INVALID_REQUEST", "Owner is required.");
  const windowHours = filter?.windowHours ?? 24;
  if (!Number.isFinite(windowHours) || windowHours <= 0 || windowHours > 24 * 30) {
    throw new GuardrailError("INVALID_REQUEST", "windowHours must be between 0 and 720.");
  }
  const since = new Date(Date.now() - windowHours * WINDOW_MS);
  const rows = await db.query.aiOperations.findMany({
    columns: { capability: true, status: true },
    where:
      filter?.projectId === undefined
        ? and(eq(aiOperations.userId, userId), gte(aiOperations.createdAt, since))
        : and(
            eq(aiOperations.userId, userId),
            eq(aiOperations.projectId, filter.projectId),
            gte(aiOperations.createdAt, since),
          ),
  });
  const byCapability: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    byCapability[row.capability] = (byCapability[row.capability] ?? 0) + 1;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }
  return { windowHours, total: rows.length, byCapability, byStatus };
}
