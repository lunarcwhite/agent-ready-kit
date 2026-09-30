// Decision dependency graph (TASK-022, database-schema.md §17).
//
// Deterministic rules evaluated by application code — never by LLM
// intuition (AGENTS.md §23). This module holds no runtime imports from
// decisions.ts (only a type), so evaluation callers there depend one way,
// no cycles. It queries schema tables directly.
//
// Condition language (minimal, versioned by shape):
// - null               → rule fires on any source value change;
// - { "equals": json } → rule fires when the source value deep-equals it.
// Anything else is rejected at registration, not silently misread.
//
// Effect semantics (documented once, here):
// - MARK_NOT_APPLICABLE → target becomes NOT_APPLICABLE. The only effect
//   with auto-reopen: when the condition clears AND the target is still
//   NOT_APPLICABLE AND its latest history row was system-applied (reason
//   prefixed below), it returns to UNRESOLVED for re-decision.
// - ACTIVATE  → a shelved target (NOT_APPLICABLE/DEFERRED) returns to
//   UNRESOLVED; anything else is untouched.
// - REQUIRE   → a required decision cannot stay NOT_APPLICABLE: NA targets
//   return to UNRESOLVED; anything else is untouched.
// - INVALIDATE → the target's recorded answer is void: value cleared,
//   status UNRESOLVED. Never auto-restored — the user must re-decide.
// Clearing the condition auto-reverts NOTHING except the guarded
// MARK_NOT_APPLICABLE reopen: derived state must never silently overwrite
// human-owned state.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { decisions, decisionDependencies } from "../../infrastructure/database/schema/decisions";
import { requireProjectScope } from "../projects/repository";
import { DecisionNotFoundError, DecisionValidationError } from "./errors";
import type { DecisionStatus } from "./decisions";

export const DEPENDENCY_EFFECTS = [
  "ACTIVATE",
  "REQUIRE",
  "INVALIDATE",
  "MARK_NOT_APPLICABLE",
] as const;
export type DependencyEffect = (typeof DEPENDENCY_EFFECTS)[number];

// History changeReason prefix marking system-applied dependency writes.
// The reopen guard trusts ONLY rows carrying this prefix; user-authored
// rows (custom reason or null) are never auto-reverted. The prefix is
// reserved — user input must never be stored with it (enforced by review
// of the single writer below, not by constraint).
export const DEPENDENCY_REASON_PREFIX = "dependency:";

export type DependencyCondition = null | { equals: unknown };

export interface DependencyEdge {
  sourceKey: string;
  targetKey: string;
}

export interface DependencyRow {
  id: string;
  projectId: string;
  sourceDecisionKey: string;
  targetDecisionKey: string;
  condition: DependencyCondition;
  effect: DependencyEffect;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterDependencyInput {
  sourceKey: string;
  targetKey: string;
  condition?: unknown;
  effect: DependencyEffect;
}

const MAX_KEY_LENGTH = 128;
// Mirrors decisions.ts: dot-notation logic keys. Duplicated (not imported)
// to keep this module dependency-free toward decisions.ts (no cycles).
const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function requireKey(raw: string, field: string): string {
  const key = raw.trim();
  if (key === "") throw new DecisionValidationError(`${field} is required.`);
  if (key.length > MAX_KEY_LENGTH) {
    throw new DecisionValidationError(`${field} must be at most ${MAX_KEY_LENGTH} characters.`);
  }
  if (!KEY_PATTERN.test(key)) {
    throw new DecisionValidationError(`${field} must be lowercase dot-notation.`);
  }
  return key;
}

function requireEffect(raw: string): DependencyEffect {
  if (!(DEPENDENCY_EFFECTS as readonly string[]).includes(raw)) {
    throw new DecisionValidationError(`effect must be one of ${DEPENDENCY_EFFECTS.join(", ")}.`);
  }
  return raw as DependencyEffect;
}

// Normalizes unknown input to the condition language. Rejects shapes
// outside the language instead of guessing (explicit uncertainty wins).
export function normalizeCondition(raw: unknown): DependencyCondition {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new DecisionValidationError('condition must be null or { "equals": value }.');
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "equals") {
    throw new DecisionValidationError('condition must be null or { "equals": value }.');
  }
  try {
    JSON.stringify((raw as { equals: unknown }).equals);
  } catch {
    throw new DecisionValidationError("condition.equals must be JSON-serializable.");
  }
  return { equals: (raw as { equals: unknown }).equals };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || typeof a !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

export function matchesCondition(condition: DependencyCondition, value: unknown): boolean {
  if (condition === null) return true;
  return deepEqual(condition.equals, value);
}

// Cycle check over the project graph plus the candidate edge: depth-first
// from the candidate target — reaching the candidate source means the new
// edge would close a loop. Pure: fully unit-testable without a database.
export function wouldCreateCycle(
  edges: DependencyEdge[],
  sourceKey: string,
  targetKey: string,
): boolean {
  if (sourceKey === targetKey) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of [...edges, { sourceKey, targetKey }]) {
    const list = adjacency.get(edge.sourceKey) ?? [];
    list.push(edge.targetKey);
    adjacency.set(edge.sourceKey, list);
  }
  const visited = new Set<string>();
  const stack: string[] = [targetKey];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === sourceKey) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

export interface EffectResolution {
  status: DecisionStatus;
  clearValue: boolean;
}

// Maps (effect, current target status) to the deterministic outcome, or
// null when the rule fires but changes nothing (already in the goal state).
// Pure: the evaluation loop in decisions.ts performs writes; this function
// only computes.
export function resolveEffect(
  effect: DependencyEffect,
  targetStatus: DecisionStatus,
): EffectResolution | null {
  switch (effect) {
    case "MARK_NOT_APPLICABLE":
      return targetStatus === "NOT_APPLICABLE"
        ? null
        : { status: "NOT_APPLICABLE", clearValue: false };
    case "ACTIVATE":
      return targetStatus === "NOT_APPLICABLE" || targetStatus === "DEFERRED"
        ? { status: "UNRESOLVED", clearValue: false }
        : null;
    case "REQUIRE":
      return targetStatus === "NOT_APPLICABLE" ? { status: "UNRESOLVED", clearValue: false } : null;
    case "INVALIDATE":
      return targetStatus === "UNRESOLVED" ? null : { status: "UNRESOLVED", clearValue: true };
  }
}

function toRow(raw: typeof decisionDependencies.$inferSelect): DependencyRow {
  return {
    ...raw,
    effect: raw.effect as DependencyEffect,
    condition: (raw.condition ?? null) as DependencyCondition,
  };
}

export async function registerDependency(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: RegisterDependencyInput,
): Promise<DependencyRow> {
  if (userId.trim() === "") throw new DecisionValidationError("Owner is required.");
  const sourceKey = requireKey(raw.sourceKey, "sourceKey");
  const targetKey = requireKey(raw.targetKey, "targetKey");
  const effect = requireEffect(raw.effect);
  const condition = normalizeCondition(raw.condition);
  if (sourceKey === targetKey) {
    throw new DecisionValidationError("A decision cannot depend on itself.");
  }

  const scope = await requireProjectScope(db, userId, projectId);
  // Both ends must exist: rules never dangle off unknown decisions.
  for (const key of [sourceKey, targetKey]) {
    const exists = await db.query.decisions.findFirst({
      columns: { id: true },
      where: and(eq(decisions.projectId, scope.projectId), eq(decisions.decisionKey, key)),
    });
    if (!exists) throw new DecisionNotFoundError(`Decision "${key}" does not exist.`);
  }

  const existing = await listDependencies(db, userId, projectId);
  if (
    existing.some(
      (row) =>
        row.sourceDecisionKey === sourceKey &&
        row.targetDecisionKey === targetKey &&
        row.effect === effect &&
        deepEqual(row.condition, condition),
    )
  ) {
    throw new DecisionValidationError("This dependency is already registered.");
  }
  if (
    wouldCreateCycle(
      existing.map((row) => ({
        sourceKey: row.sourceDecisionKey,
        targetKey: row.targetDecisionKey,
      })),
      sourceKey,
      targetKey,
    )
  ) {
    throw new DecisionValidationError(
      `Registering ${sourceKey} → ${targetKey} would create a dependency cycle.`,
    );
  }

  const [inserted] = await db
    .insert(decisionDependencies)
    .values({
      projectId: scope.projectId,
      sourceDecisionKey: sourceKey,
      targetDecisionKey: targetKey,
      condition: condition as object | null,
      effect,
    })
    .returning();
  if (!inserted) throw new DecisionNotFoundError("Dependency registration failed.");
  return toRow(inserted);
}

export async function listDependencies(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<DependencyRow[]> {
  if (userId.trim() === "") throw new DecisionValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.decisionDependencies.findMany({
    where: eq(decisionDependencies.projectId, scope.projectId),
    orderBy: [
      asc(decisionDependencies.sourceDecisionKey),
      asc(decisionDependencies.targetDecisionKey),
    ],
  });
  return rows.map(toRow);
}
