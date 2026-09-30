// Decision domain model (TASK-021, FR-020–022, database-schema.md §11–§16).
//
// Persistence mechanics plus deterministic dependency evaluation: store
// structured decisions with stable codes, snapshot every change into
// decision_history, number each accepted change on the project state version
// (TASK-020), and cascade outgoing dependency rules (TASK-022). NOT here:
// provenance mapping service (TASK-025), status transition approval policy
// (TASK-054 reviews), and any LLM semantics.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first — nested callers pass a project_id they never
// touch directly.
import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import { decisions, decisionHistory } from "../../infrastructure/database/schema/decisions";
import { normalizeCategory } from "../../shared/identifiers";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import {
  DEPENDENCY_REASON_PREFIX,
  listDependencies,
  matchesCondition,
  resolveEffect,
  type DependencyRow,
} from "./dependencies";
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
  sourceType?: DecisionSourceType;
  confidence?: DecisionConfidence;
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

// Unique-violation mapping lives centrally (infrastructure/database/errors.ts)
// so domain code never sniffs drivers.

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
      if (isUniqueViolationError(error)) {
        throw new DecisionValidationError(
          `Decision "${decisionKey}" already exists in this project.`,
        );
      }
      throw error;
    }
    if (!inserted) throw new DecisionNotFoundError("Decision creation failed.");
    const row = toRow(inserted);
    await insertHistorySnapshot(tx, row, userId, "created");
    if (row.value !== null) {
      await evaluateDependents(tx, userId, scope.projectId, decisionKey, row.value, new Set());
    }
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

// Null-returning variant for evaluation paths: an edge pointing at a
// removed decision must never fail its parent's write (orphan skip).
async function loadScopedOrNull(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionKey: string,
): Promise<DecisionRow | null> {
  try {
    return await loadScoped(db, userId, projectId, decisionKey);
  } catch (error) {
    if (error instanceof DecisionNotFoundError) return null;
    throw error;
  }
}

// Applies outgoing dependency rules for a freshly written source value,
// inside the caller's transaction (TASK-022). Chains (A→B→C) recurse with
// a visited set; registration-time cycle rejection guarantees termination,
// the set is belt-and-braces. Derived writes share the caller's single
// project version bump — one user action, one version.
async function evaluateDependents(
  tx: AppDatabase,
  userId: string,
  projectId: string,
  sourceKey: string,
  sourceValue: unknown,
  visited: Set<string>,
): Promise<void> {
  if (sourceValue === null || visited.has(sourceKey)) return;
  visited.add(sourceKey);
  const edges = await listDependencies(tx, userId, projectId);
  for (const edge of edges) {
    if (edge.sourceDecisionKey !== sourceKey) continue;
    if (!matchesCondition(edge.condition, sourceValue)) {
      if (edge.effect === "MARK_NOT_APPLICABLE") {
        await maybeReopenDependent(tx, userId, projectId, edge, sourceKey, visited);
      }
      continue;
    }
    const target = await loadScopedOrNull(tx, userId, projectId, edge.targetDecisionKey);
    if (!target) continue;
    const next = resolveEffect(edge.effect, target.status);
    if (!next) continue;
    const [updated] = await tx
      .update(decisions)
      .set({
        status: next.status,
        ...(next.clearValue ? { value: null as object | null } : {}),
        version: target.version + 1,
      })
      .where(eq(decisions.id, target.id))
      .returning();
    if (!updated) continue;
    const row = toRow(updated);
    await insertHistorySnapshot(
      tx,
      row,
      userId,
      `${DEPENDENCY_REASON_PREFIX}${sourceKey} → ${edge.effect}`,
    );
    await evaluateDependents(tx, userId, projectId, edge.targetDecisionKey, row.value, visited);
  }
}

// Guarded reopen: only when the target is still NOT_APPLICABLE AND its
// latest history row was system-applied. Human-authored NA (custom reason
// or none) is never auto-reverted — reopening it would silently overwrite
// a deliberate human decision (AGENTS.md §34, §106).
async function maybeReopenDependent(
  tx: AppDatabase,
  userId: string,
  projectId: string,
  edge: DependencyRow,
  sourceKey: string,
  visited: Set<string>,
): Promise<void> {
  const target = await loadScopedOrNull(tx, userId, projectId, edge.targetDecisionKey);
  if (!target || target.status !== "NOT_APPLICABLE") return;
  const [latest] = await tx.query.decisionHistory.findMany({
    where: eq(decisionHistory.decisionId, target.id),
    orderBy: [desc(decisionHistory.version)],
    limit: 1,
  });
  if (!latest?.changeReason?.startsWith(DEPENDENCY_REASON_PREFIX)) return;
  const [updated] = await tx
    .update(decisions)
    .set({ status: "UNRESOLVED", version: target.version + 1 })
    .where(eq(decisions.id, target.id))
    .returning();
  if (!updated) return;
  const row = toRow(updated);
  await insertHistorySnapshot(
    tx,
    row,
    userId,
    `${DEPENDENCY_REASON_PREFIX}${sourceKey} cleared → reopened`,
  );
  await evaluateDependents(tx, userId, projectId, edge.targetDecisionKey, row.value, visited);
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
  // Source upgrades ride explicit re-confirmation (TASK-054): a RECOMMENDED
  // decision the user now states explicitly becomes USER/EXPLICIT instead of
  // keeping a stale AI origin. History snapshots the new pair, so the
  // upgrade itself stays auditable.
  if (raw.sourceType !== undefined)
    requireEnum(raw.sourceType, DECISION_SOURCE_TYPES, "sourceType");
  if (raw.confidence !== undefined) requireEnum(raw.confidence, DECISION_CONFIDENCES, "confidence");
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
    raw.impact !== undefined ||
    raw.sourceType !== undefined ||
    raw.confidence !== undefined;

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
        ...(raw.sourceType !== undefined ? { sourceType: raw.sourceType } : {}),
        ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
        version: nextVersion,
        confirmedAt,
      })
      .where(eq(decisions.id, current.id))
      .returning();
    if (!updated) throw new DecisionNotFoundError();
    const row = toRow(updated);
    await insertHistorySnapshot(tx, row, userId, changeReason);
    if (row.value !== null) {
      await evaluateDependents(tx, userId, current.projectId, key, row.value, new Set());
    }
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
