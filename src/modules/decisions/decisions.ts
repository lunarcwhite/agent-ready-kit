// Decision domain model (TASK-021, FR-020–022, database-schema.md §11–§16).
//
// Persistence mechanics only: store structured decisions with stable codes,
// snapshot every change into decision_history, and number each accepted
// change on the project state version (TASK-020). NOT here: dependency
// evaluation (TASK-022), provenance mapping service (TASK-025), status
// transition approval policy (TASK-054 reviews), and any LLM semantics.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first — nested callers pass a project_id they never
// touch directly.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import { decisions, decisionHistory } from "../../infrastructure/database/schema/decisions";
import { normalizeCategory } from "../../shared/identifiers";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { DecisionNotFoundError, DecisionValidationError } from "./errors";

export const DECISION_STATUSES = [
  "UNRESOLVED",
  "RECOMMENDED",
  "CONFIRMED",
  "DEFERRED",
  "NOT_APPLICABLE",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_IMPACTS = ["HIGH", "MEDIUM", "LOW"] as const;
export type DecisionImpact = (typeof DECISION_IMPACTS)[number];

export const DECISION_SOURCE_TYPES = [
  "USER",
  "AI_RECOMMENDATION",
  "AI_INFERENCE",
  "SYSTEM",
] as const;
export type DecisionSourceType = (typeof DECISION_SOURCE_TYPES)[number];

export const DECISION_CONFIDENCES = ["EXPLICIT", "INFERRED", "ASSUMED"] as const;
export type DecisionConfidence = (typeof DECISION_CONFIDENCES)[number];

export interface DecisionRow {
  id: string;
  projectId: string;
  decisionKey: string;
  decisionCode: string;
  category: string;
  title: string;
  value: unknown;
  rationale: string | null;
  status: DecisionStatus;
  impact: DecisionImpact;
  sourceType: DecisionSourceType;
  confidence: DecisionConfidence;
  version: number;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionHistoryRow {
  id: string;
  decisionId: string;
  version: number;
  value: unknown;
  rationale: string | null;
  status: DecisionStatus;
  sourceType: DecisionSourceType;
  changedBy: string | null;
  changeReason: string | null;
  createdAt: Date;
}

export interface CreateDecisionInput {
  decisionKey: string;
  category: string;
  title: string;
  status: DecisionStatus;
  impact: DecisionImpact;
  sourceType: DecisionSourceType;
  confidence: DecisionConfidence;
  value?: unknown;
  rationale?: string | null;
}

export interface UpdateDecisionInput {
  value?: unknown;
  rationale?: string | null;
  status?: DecisionStatus;
  impact?: DecisionImpact;
  changeReason?: string | null;
}

const MAX_KEY_LENGTH = 128;
const MAX_TITLE_LENGTH = 255;
const MAX_RATIONALE_LENGTH = 20000;
const MAX_REASON_LENGTH = 2000;
// Lowercase dot-notation logic keys (authentication.required). Segments keep
// the key space readable and routable; single-segment keys are allowed —
// registries for known keys belong to later discovery tasks, not this model.
const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function requireKey(raw: string): string {
  const key = raw.trim();
  if (key === "") throw new DecisionValidationError("decisionKey is required.");
  if (key.length > MAX_KEY_LENGTH) {
    throw new DecisionValidationError(`decisionKey must be at most ${MAX_KEY_LENGTH} characters.`);
  }
  if (!KEY_PATTERN.test(key)) {
    throw new DecisionValidationError(
      "decisionKey must be lowercase dot-notation (e.g. authentication.required).",
    );
  }
  return key;
}

function requireTitle(raw: string): string {
  const title = raw.trim();
  if (title === "") throw new DecisionValidationError("title is required.");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new DecisionValidationError(`title must be at most ${MAX_TITLE_LENGTH} characters.`);
  }
  return title;
}

function optionalText(raw: string | null | undefined, field: string, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  if (text.length > max) {
    throw new DecisionValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DecisionValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

// jsonb cannot store undefined, functions, or circular structures — reject
// them as domain errors instead of leaking cryptic driver failures.
function requireJsonSafe(value: unknown, field: string): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new DecisionValidationError(`${field} must be JSON-serializable.`);
  }
}

function toRow(raw: typeof decisions.$inferSelect): DecisionRow {
  return {
    ...raw,
    status: raw.status as DecisionStatus,
    impact: raw.impact as DecisionImpact,
    sourceType: raw.sourceType as DecisionSourceType,
    confidence: raw.confidence as DecisionConfidence,
  };
}

function toHistoryRow(raw: typeof decisionHistory.$inferSelect): DecisionHistoryRow {
  return {
    ...raw,
    status: raw.status as DecisionStatus,
    sourceType: raw.sourceType as DecisionSourceType,
  };
}

async function insertHistorySnapshot(
  db: AppDatabase,
  decision: DecisionRow,
  changedBy: string,
  changeReason: string | null,
): Promise<void> {
  await db.insert(decisionHistory).values({
    decisionId: decision.id,
    version: decision.version,
    value: (decision.value ?? null) as object | null,
    rationale: decision.rationale,
    status: decision.status,
    sourceType: decision.sourceType,
    changedBy,
    changeReason,
  });
}

// Unique violations surface as driver errors (pg 23505, possibly wrapped by
// drizzle layers). Unwrap the cause chain and report them as domain errors:
// the caller learns the key is taken, never driver internals.
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (depth > 3 || typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === "23505") return true;
  return "cause" in error
    ? isUniqueViolation((error as { cause?: unknown }).cause, depth + 1)
    : false;
}

export async function createDecision(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateDecisionInput,
): Promise<DecisionRow> {
  // All structural validation runs before any write: malformed calls must
  // not burn a stable code or advance the project version.
  if (userId.trim() === "") throw new DecisionValidationError("Owner is required.");
  const decisionKey = requireKey(raw.decisionKey);
  const category = normalizeCategory(raw.category);
  const title = requireTitle(raw.title);
  const status = requireEnum(raw.status, DECISION_STATUSES, "status");
  const impact = requireEnum(raw.impact, DECISION_IMPACTS, "impact");
  const sourceType = requireEnum(raw.sourceType, DECISION_SOURCE_TYPES, "sourceType");
  const confidence = requireEnum(raw.confidence, DECISION_CONFIDENCES, "confidence");
  const rationale = optionalText(raw.rationale, "rationale", MAX_RATIONALE_LENGTH);
  const value = raw.value === undefined ? null : raw.value;
  requireJsonSafe(value, "value");

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const decisionCode = await allocateStableIdTx(tx, scope.projectId, "DEC", category);
    let inserted: typeof decisions.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(decisions)
        .values({
          projectId: scope.projectId,
          decisionKey,
          decisionCode,
          category,
          title,
          value: value as object | null,
          rationale,
          status,
          impact,
          sourceType,
          confidence,
          confirmedAt: status === "CONFIRMED" ? new Date() : null,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DecisionValidationError(
          `Decision "${decisionKey}" already exists in this project.`,
        );
      }
      throw error;
    }
    if (!inserted) throw new DecisionNotFoundError("Decision creation failed.");
    const row = toRow(inserted);
    await insertHistorySnapshot(tx, row, userId, "created");
    await incrementStateVersion(tx, userId, scope.projectId);
    return row;
  });
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionKey: string,
): Promise<DecisionRow> {
  const scope = await requireProjectScope(db, userId, projectId);
  const found = await db.query.decisions.findFirst({
    where: and(eq(decisions.projectId, scope.projectId), eq(decisions.decisionKey, decisionKey)),
  });
  if (!found) throw new DecisionNotFoundError();
  return toRow(found);
}

export async function getDecisionByKey(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionKey: string,
): Promise<DecisionRow> {
  if (userId.trim() === "") throw new DecisionValidationError("Owner is required.");
  return loadScoped(db, userId, projectId, requireKey(decisionKey));
}

export async function getDecisionByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionCode: string,
): Promise<DecisionRow> {
  if (userId.trim() === "") throw new DecisionValidationError("Owner is required.");
  const code = decisionCode.trim();
  if (code === "") throw new DecisionValidationError("decisionCode is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const found = await db.query.decisions.findFirst({
    where: and(eq(decisions.projectId, scope.projectId), eq(decisions.decisionCode, code)),
  });
  if (!found) throw new DecisionNotFoundError();
  return toRow(found);
}

export async function listDecisions(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: { status?: DecisionStatus },
): Promise<DecisionRow[]> {
  if (userId.trim() === "") throw new DecisionValidationError("Owner is required.");
  if (filter?.status !== undefined) requireEnum(filter.status, DECISION_STATUSES, "status");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.decisions.findMany({
    where:
      filter?.status === undefined
        ? eq(decisions.projectId, scope.projectId)
        : and(eq(decisions.projectId, scope.projectId), eq(decisions.status, filter.status)),
    orderBy: [asc(decisions.decisionCode)],
  });
  return rows.map(toRow);
}

export async function updateDecision(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionKey: string,
  raw: UpdateDecisionInput,
): Promise<DecisionRow> {
  if (userId.trim() === "") throw new DecisionValidationError("Owner is required.");
  const key = requireKey(decisionKey);
  if (raw.status !== undefined) requireEnum(raw.status, DECISION_STATUSES, "status");
  if (raw.impact !== undefined) requireEnum(raw.impact, DECISION_IMPACTS, "impact");
  if (raw.value !== undefined) requireJsonSafe(raw.value, "value");
  const rationale =
    raw.rationale === undefined
      ? undefined
      : optionalText(raw.rationale, "rationale", MAX_RATIONALE_LENGTH);
  const changeReason =
    raw.changeReason === undefined || raw.changeReason === null
      ? null
      : optionalText(raw.changeReason, "changeReason", MAX_REASON_LENGTH);
  const touches =
    raw.value !== undefined ||
    rationale !== undefined ||
    raw.status !== undefined ||
    raw.impact !== undefined;

  const current = await loadScoped(db, userId, projectId, key);
  if (!touches) return current;

  return db.transaction(async (tx) => {
    const nextVersion = current.version + 1;
    // confirmed_at is server-owned: entering CONFIRMED stamps it, leaving
    // clears it, untouched status preserves it.
    const confirmedAt =
      raw.status === undefined
        ? current.confirmedAt
        : raw.status === "CONFIRMED"
          ? new Date()
          : null;
    const [updated] = await tx
      .update(decisions)
      .set({
        ...(raw.value !== undefined ? { value: (raw.value ?? null) as object | null } : {}),
        ...(rationale !== undefined ? { rationale } : {}),
        ...(raw.status !== undefined ? { status: raw.status } : {}),
        ...(raw.impact !== undefined ? { impact: raw.impact } : {}),
        version: nextVersion,
        confirmedAt,
      })
      .where(eq(decisions.id, current.id))
      .returning();
    if (!updated) throw new DecisionNotFoundError();
    const row = toRow(updated);
    await insertHistorySnapshot(tx, row, userId, changeReason);
    await incrementStateVersion(tx, userId, current.projectId);
    return row;
  });
}

export async function getDecisionHistory(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionKey: string,
): Promise<DecisionHistoryRow[]> {
  if (userId.trim() === "") throw new DecisionValidationError("Owner is required.");
  const current = await loadScoped(db, userId, projectId, requireKey(decisionKey));
  const rows = await db.query.decisionHistory.findMany({
    where: eq(decisionHistory.decisionId, current.id),
    orderBy: [asc(decisionHistory.version)],
  });
  return rows.map(toHistoryRow);
}
