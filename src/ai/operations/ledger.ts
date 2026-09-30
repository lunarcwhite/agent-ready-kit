// AI operation ledger (TASK-043, database-schema.md §52–§55).
//
// Append-only observability: startOperation opens a RUNNING row, finish
// records SUCCEEDED/FAILED exactly once — terminal rows are frozen, so
// history can never be rewritten to hide a failure. Every function scopes
// by the caller's user_id first (project ops additionally pass through
// requireProjectScope), so one user's ledger is unreachable from another.
//
// Secrets: error text is length-capped and key-stripped before persistence;
// usage/cost/latency are numbers, never credential-shaped strings. Nothing
// here bumps the project state version — the ledger observes canonical
// changes, it is not one.
import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import {
  aiOperationPayloads,
  aiOperations,
} from "../../infrastructure/database/schema/ai-operations";
import { requireProjectScope } from "../../modules/projects/repository";
import { OperationNotFoundError, OperationValidationError } from "./errors";

export const OPERATION_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export interface OperationRow {
  id: string;
  projectId: string | null;
  userId: string;
  operationType: string;
  capability: string;
  provider: string;
  model: string;
  promptKey: string | null;
  promptVersion: string | null;
  projectStateVersion: number | null;
  status: OperationStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: string | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartOperationInput {
  projectId?: string;
  capability: string;
  operationType: string;
  provider: string;
  model: string;
  promptKey?: string;
  promptVersion?: string;
  projectStateVersion?: number;
}

export interface FinishOperationInput {
  status: "SUCCEEDED" | "FAILED";
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number | string;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

const MAX_FIELD_LENGTH = 128;
const MAX_ERROR_LENGTH = 2000;

function requireText(raw: string, field: string, max = MAX_FIELD_LENGTH): string {
  const text = raw.trim();
  if (text === "") throw new OperationValidationError(`${field} is required.`);
  if (text.length > max) {
    throw new OperationValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireNonNegativeInt(raw: number, field: string): number {
  if (!Number.isInteger(raw) || raw < 0) {
    throw new OperationValidationError(`${field} must be an integer >= 0.`);
  }
  return raw;
}

function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/(sk-[A-Za-z0-9-_]{4})[A-Za-z0-9-_]+/g, "$1…redacted")
    .trim()
    .slice(0, MAX_ERROR_LENGTH);
}

function toRow(raw: typeof aiOperations.$inferSelect): OperationRow {
  return {
    ...raw,
    status: raw.status as OperationStatus,
    estimatedCost: (raw.estimatedCost ?? null) as string | null,
  };
}

export async function startOperation(
  db: AppDatabase,
  userId: string,
  raw: StartOperationInput,
): Promise<OperationRow> {
  if (userId.trim() === "") throw new OperationValidationError("Owner is required.");
  const capability = requireText(raw.capability, "capability", 64);
  const operationType = requireText(raw.operationType, "operationType", 64);
  const provider = requireText(raw.provider, "provider", 32);
  const model = requireText(raw.model, "model");
  const promptKey = raw.promptKey === undefined ? null : requireText(raw.promptKey, "promptKey");
  const promptVersion =
    raw.promptVersion === undefined ? null : requireText(raw.promptVersion, "promptVersion", 16);
  const projectStateVersion =
    raw.projectStateVersion === undefined
      ? null
      : requireNonNegativeInt(raw.projectStateVersion, "projectStateVersion");

  let projectId: string | null = null;
  if (raw.projectId !== undefined) {
    const scope = await requireProjectScope(db, userId, raw.projectId);
    projectId = scope.projectId;
  }
  const [inserted] = await db
    .insert(aiOperations)
    .values({
      projectId,
      userId,
      capability,
      operationType,
      provider,
      model,
      promptKey,
      promptVersion,
      projectStateVersion,
      status: "RUNNING",
    })
    .returning();
  if (!inserted) throw new OperationNotFoundError("Operation creation failed.");
  return toRow(inserted);
}

export async function finishOperation(
  db: AppDatabase,
  userId: string,
  operationId: string,
  raw: FinishOperationInput,
): Promise<OperationRow> {
  if (userId.trim() === "") throw new OperationValidationError("Owner is required.");
  if (raw.status !== "SUCCEEDED" && raw.status !== "FAILED") {
    throw new OperationValidationError("status must be SUCCEEDED or FAILED.");
  }
  const id = raw2id(operationId);
  const found = await db.query.aiOperations.findFirst({
    where: and(eq(aiOperations.id, id), eq(aiOperations.userId, userId)),
  });
  if (!found) throw new OperationNotFoundError();
  if (found.status === "SUCCEEDED" || found.status === "FAILED") {
    throw new OperationValidationError(`Operation is already ${found.status}.`);
  }
  if (raw.status === "FAILED" && !raw.errorCode && !raw.errorMessage) {
    throw new OperationValidationError("Failed operations must record an error.");
  }
  const errorCode =
    raw.errorCode === undefined ? null : requireText(raw.errorCode, "errorCode", 64);
  const errorMessage =
    raw.errorMessage === undefined || raw.errorMessage.trim() === ""
      ? null
      : sanitizeErrorMessage(raw.errorMessage);
  const [updated] = await db
    .update(aiOperations)
    .set({
      status: raw.status,
      ...(raw.inputTokens !== undefined
        ? { inputTokens: requireNonNegativeInt(raw.inputTokens, "inputTokens") }
        : {}),
      ...(raw.outputTokens !== undefined
        ? { outputTokens: requireNonNegativeInt(raw.outputTokens, "outputTokens") }
        : {}),
      ...(raw.estimatedCost !== undefined ? { estimatedCost: String(raw.estimatedCost) } : {}),
      ...(raw.latencyMs !== undefined
        ? { latencyMs: requireNonNegativeInt(raw.latencyMs, "latencyMs") }
        : {}),
      errorCode,
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(aiOperations.id, found.id))
    .returning();
  if (!updated) throw new OperationNotFoundError();
  return toRow(updated);
}

function raw2id(raw: string): string {
  const id = raw.trim();
  if (id === "") throw new OperationValidationError("operationId is required.");
  return id;
}

export async function saveOperationPayloads(
  db: AppDatabase,
  userId: string,
  operationId: string,
  payloads: { input?: unknown; output?: unknown },
): Promise<void> {
  if (userId.trim() === "") throw new OperationValidationError("Owner is required.");
  const found = await db.query.aiOperations.findFirst({
    columns: { id: true },
    where: and(eq(aiOperations.id, raw2id(operationId)), eq(aiOperations.userId, userId)),
  });
  if (!found) throw new OperationNotFoundError();
  for (const [name, value] of Object.entries(payloads)) {
    if (value !== undefined) {
      try {
        JSON.stringify(value);
      } catch {
        throw new OperationValidationError(`${name} payload must be JSON-serializable.`);
      }
    }
  }
  await db.insert(aiOperationPayloads).values({
    aiOperationId: found.id,
    inputPayload: (payloads.input ?? null) as object | null,
    outputPayload: (payloads.output ?? null) as object | null,
  });
}

export async function getOperation(
  db: AppDatabase,
  userId: string,
  operationId: string,
): Promise<OperationRow> {
  if (userId.trim() === "") throw new OperationValidationError("Owner is required.");
  const found = await db.query.aiOperations.findFirst({
    where: and(eq(aiOperations.id, raw2id(operationId)), eq(aiOperations.userId, userId)),
  });
  if (!found) throw new OperationNotFoundError();
  return toRow(found);
}

export async function listOperations(
  db: AppDatabase,
  userId: string,
  filter?: { projectId?: string },
): Promise<OperationRow[]> {
  if (userId.trim() === "") throw new OperationValidationError("Owner is required.");
  if (filter?.projectId !== undefined) {
    const scope = await requireProjectScope(db, userId, filter.projectId);
    const rows = await db.query.aiOperations.findMany({
      where: and(eq(aiOperations.userId, userId), eq(aiOperations.projectId, scope.projectId)),
      orderBy: [desc(aiOperations.createdAt)],
    });
    return rows.map(toRow);
  }
  const rows = await db.query.aiOperations.findMany({
    where: eq(aiOperations.userId, userId),
    orderBy: [desc(aiOperations.createdAt)],
  });
  return rows.map(toRow);
}
