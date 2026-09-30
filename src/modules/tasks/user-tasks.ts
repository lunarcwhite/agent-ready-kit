// User-project task domain model (TASK-090, database-schema.md §47–§49,
// tasks.md §4–§5, spec-decisions.md D-A10b).
//
// Canonical executable work items for the USER's project, coded UTASK-001…
// via the atomic per-project counter (TASK-004) — never LLM output, never
// reused, stable across reordering and regeneration. The UTASK prefix keeps
// user-project tasks distinct from this repo's own implementation plan
// (TASK-xxx), which is a decided constraint, not a naming preference.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted mutation (create/update/
// addDependency/removeDependency) numbers the project state version exactly
// once (TASK-020) inside the same transaction as the data change.
//
// Status (§48, tasks.md §4) is stored and freely settable among all five
// values; DONE is an ordinary value here with no auto-derivation —
// READY/BLOCKED derivation and lifecycle transitions belong to TASK-092.
// Acceptance criteria and Definition of Done are structured non-empty string
// arrays, required at create and never clearable, so DONE trivially implies
// non-empty criteria.
//
// References (documented deviation): spec §47 lists requirement/
// architecture/entity/screen reference families but defines no column for
// them. They ride the `references` jsonb column as shape-validated loose
// refs (requirements.metadata.sources precedent). REQUIREMENT refs are
// strict: FR-shaped codes validated same-project against the requirements
// table. ARC/ENTITY/SCREEN refs are structural-only (UUID or stable-code
// shape) — their tables land in other tasks, so existence checks arrive
// later. Relational traceability_links (TASK-024, §50) remain the future
// extensible home; this precursor keeps TASK-090 dependency-free.
//
// There is deliberately NO delete API: removed tasks freeze in place so
// stable IDs are never reused (DB-INV-004) and dependency history stays
// queryable. Milestone moves are plain label edits (TASK-091 owns the
// milestone model).
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { userTasks } from "../../infrastructure/database/schema/user-tasks";
import { parseStableId } from "../../shared/identifiers";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { UserTaskNotFoundError, UserTaskValidationError } from "./errors";

export const USER_TASK_STATUSES = [
  "PENDING",
  "READY",
  "BLOCKED",
  "REVIEW_REQUIRED",
  "DONE",
] as const;
export type UserTaskStatus = (typeof USER_TASK_STATUSES)[number];

export const USER_TASK_PRIORITIES = ["P0", "P1", "P2"] as const;
export type UserTaskPriority = (typeof USER_TASK_PRIORITIES)[number];

// Loose reference families, stored under the `references` jsonb column.
// Arrays carry stable codes (FR-001…) or row UUIDs; families without entries
// are omitted rather than stored empty.
export interface TaskReferences {
  requirements?: string[];
  architecture?: string[];
  entities?: string[];
  screens?: string[];
}

export interface TaskReferencesInput {
  requirements?: string[];
  architecture?: string[];
  entities?: string[];
  screens?: string[];
}

export interface UserTaskRow {
  id: string;
  projectId: string;
  taskCode: string;
  title: string;
  objective: string;
  status: UserTaskStatus;
  priority: UserTaskPriority;
  milestone: string | null;
  implementationNotes: string | null;
  acceptanceCriteria: string[];
  definitionOfDone: string[];
  references: TaskReferences | null;
  sortOrder: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserTaskInput {
  title: string;
  objective: string;
  priority: UserTaskPriority;
  status?: UserTaskStatus;
  milestone?: string | null;
  implementationNotes?: string | null;
  acceptanceCriteria: string[];
  definitionOfDone: string[];
  references?: TaskReferencesInput | null;
  sortOrder?: number | null;
}

export interface UpdateUserTaskInput {
  title?: string;
  objective?: string;
  priority?: UserTaskPriority;
  status?: UserTaskStatus;
  milestone?: string | null;
  implementationNotes?: string | null;
  acceptanceCriteria?: string[];
  definitionOfDone?: string[];
  references?: TaskReferencesInput | null;
  sortOrder?: number | null;
}

export interface ListUserTasksFilter {
  status?: UserTaskStatus;
  priority?: UserTaskPriority;
  milestone?: string;
}

const MAX_TITLE_LENGTH = 255;
const MAX_OBJECTIVE_LENGTH = 20000;
const MAX_NOTES_LENGTH = 20000;
const MAX_MILESTONE_LENGTH = 64;
const MAX_REF_LENGTH = 128;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new UserTaskValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireText(raw: string, field: string, max: number): string {
  const text = raw.trim();
  if (text === "") throw new UserTaskValidationError(`${field} is required.`);
  if (text.length > max) {
    throw new UserTaskValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function optionalText(
  raw: string | null | undefined,
  field: string,
  max: number,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  if (text.length > max) {
    throw new UserTaskValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

// Structured criteria (acceptance criterion): a useful task carries
// testable criteria, so the list is required and every entry non-empty.
function requireStringList(raw: string[] | undefined | null, field: string): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new UserTaskValidationError(
      `${field} must be a non-empty array of strings when provided.`,
    );
  }
  return raw.map((item, i) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new UserTaskValidationError(`${field}[${i}] must be a non-empty string.`);
    }
    return item.trim();
  });
}

function requireSortOrder(raw: number | null | undefined): number | null | undefined {
  if (raw === undefined || raw === null) return raw ?? null;
  if (!Number.isInteger(raw)) {
    throw new UserTaskValidationError("sortOrder must be an integer when provided.");
  }
  return raw;
}

// Structural shape check for ARC/ENTITY/SCREEN refs: either a row UUID or a
// stable-code shape (ARC-001…). Existence checks are impossible until those
// tables land in other tasks, so shape is the whole contract for now.
function requireLooseRef(raw: unknown, field: string): string {
  const ref = String(raw ?? "").trim();
  if (ref === "" || ref.length > MAX_REF_LENGTH) {
    throw new UserTaskValidationError(`${field} must be 1-${MAX_REF_LENGTH} characters.`);
  }
  if (UUID_PATTERN.test(ref) || parseStableId(ref) !== null) return ref;
  throw new UserTaskValidationError(`${field} must be a UUID or a stable code (e.g. ARC-001).`);
}

// REQUIREMENT refs are strict: FR-shaped codes only. Existence/scope is
// checked against the requirements table inside the caller's transaction.
function requireRequirementRef(raw: unknown, field: string): string {
  const ref = String(raw ?? "").trim();
  if (ref === "" || ref.length > MAX_REF_LENGTH) {
    throw new UserTaskValidationError(`${field} must be 1-${MAX_REF_LENGTH} characters.`);
  }
  const parsed = parseStableId(ref);
  if (!parsed || parsed.family !== "FR") {
    throw new UserTaskValidationError(`${field} must be a requirement code (e.g. FR-001).`);
  }
  return ref;
}

function requireRefList(
  raw: string[] | undefined,
  field: string,
  check: (item: unknown, label: string) => string,
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new UserTaskValidationError(`${field} must be an array of strings when provided.`);
  }
  return raw.map((item, i) => check(item, `${field}[${i}]`));
}

export function normalizeTaskReferences(raw: TaskReferencesInput | null | undefined): {
  requirements?: string[];
  architecture?: string[];
  entities?: string[];
  screens?: string[];
} | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new UserTaskValidationError("references must be an object when provided.");
  }
  const out: {
    requirements?: string[];
    architecture?: string[];
    entities?: string[];
    screens?: string[];
  } = {};
  const reqs = requireRefList(raw.requirements, "references.requirements", requireRequirementRef);
  const arch = requireRefList(raw.architecture, "references.architecture", requireLooseRef);
  const ents = requireRefList(raw.entities, "references.entities", requireLooseRef);
  const screens = requireRefList(raw.screens, "references.screens", requireLooseRef);
  if (reqs !== undefined && reqs.length > 0) out.requirements = reqs;
  if (arch !== undefined && arch.length > 0) out.architecture = arch;
  if (ents !== undefined && ents.length > 0) out.entities = ents;
  if (screens !== undefined && screens.length > 0) out.screens = screens;
  return Object.keys(out).length > 0 ? out : null;
}

function parseReferences(raw: unknown): TaskReferences | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out: TaskReferences = {};
  for (const key of ["requirements", "architecture", "entities", "screens"] as const) {
    const value = source[key];
    if (!Array.isArray(value)) continue;
    const kept = value.filter((item): item is string => typeof item === "string");
    if (kept.length > 0) out[key] = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function toRow(raw: typeof userTasks.$inferSelect): UserTaskRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    taskCode: raw.taskCode,
    title: raw.title,
    objective: raw.objective,
    status: raw.status as UserTaskStatus,
    priority: raw.priority as UserTaskPriority,
    milestone: raw.milestone,
    implementationNotes: raw.implementationNotes,
    acceptanceCriteria: (raw.acceptanceCriteria ?? []) as string[],
    definitionOfDone: (raw.definitionOfDone ?? []) as string[],
    references: parseReferences(raw.references),
    sortOrder: raw.sortOrder,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

// Strict same-project check for REQUIREMENT refs. Missing rows and foreign
// rows surface identically as validation errors — the domain never reveals
// whether another user's requirement exists (TASK-014).
async function assertRequirementRefsInScope(
  db: AppDatabase,
  projectId: string,
  refs: { requirements?: string[] } | null,
): Promise<void> {
  const codes = refs?.requirements ?? [];
  for (const code of codes) {
    const found = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(and(eq(requirements.projectId, projectId), eq(requirements.requirementCode, code)));
    if (found.length === 0) {
      throw new UserTaskValidationError(`Requirement "${code}" not found in this project.`);
    }
  }
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  taskCode: string,
): Promise<typeof userTasks.$inferSelect> {
  const scope = await requireProjectScope(db, userId, projectId);
  const [found] = await db
    .select()
    .from(userTasks)
    .where(and(eq(userTasks.projectId, scope.projectId), eq(userTasks.taskCode, taskCode)));
  if (!found) throw new UserTaskNotFoundError();
  return found;
}

export async function createUserTask(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateUserTaskInput,
): Promise<UserTaskRow> {
  // All structural validation runs before any write: malformed calls must
  // not create rows, burn UTASK codes, or advance the project version.
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const title = requireText(raw.title, "title", MAX_TITLE_LENGTH);
  const objective = requireText(raw.objective, "objective", MAX_OBJECTIVE_LENGTH);
  const priority = requireEnum(raw.priority, USER_TASK_PRIORITIES, "priority");
  const status =
    raw.status === undefined ? "PENDING" : requireEnum(raw.status, USER_TASK_STATUSES, "status");
  const milestone = optionalText(raw.milestone ?? null, "milestone", MAX_MILESTONE_LENGTH) ?? null;
  const implementationNotes =
    optionalText(raw.implementationNotes ?? null, "implementationNotes", MAX_NOTES_LENGTH) ?? null;
  const acceptanceCriteria = requireStringList(raw.acceptanceCriteria, "acceptanceCriteria");
  if (!acceptanceCriteria) {
    throw new UserTaskValidationError("acceptanceCriteria is required.");
  }
  const definitionOfDone = requireStringList(raw.definitionOfDone, "definitionOfDone");
  if (!definitionOfDone) {
    throw new UserTaskValidationError("definitionOfDone is required.");
  }
  const references = normalizeTaskReferences(raw.references);
  const sortOrder = requireSortOrder(raw.sortOrder) ?? null;

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    await assertRequirementRefsInScope(tx, scope.projectId, references);
    const taskCode = await allocateStableIdTx(tx, scope.projectId, "UTASK");
    let inserted: typeof userTasks.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(userTasks)
        .values({
          projectId: scope.projectId,
          taskCode,
          title,
          objective,
          status,
          priority,
          milestone,
          implementationNotes,
          acceptanceCriteria,
          definitionOfDone,
          references,
          sortOrder,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        // Counter race backstop — the allocator owns uniqueness; a clash
        // here means concurrent writers, safe to surface plainly.
        throw new UserTaskValidationError("Task code clash, retry the operation.");
      }
      throw error;
    }
    if (!inserted) throw new UserTaskNotFoundError("Task creation failed.");
    const row = toRow(inserted);
    await incrementStateVersion(tx, userId, scope.projectId);
    return row;
  });
}

export async function getUserTaskByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  taskCode: string,
): Promise<UserTaskRow> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const code = taskCode.trim();
  if (code === "") throw new UserTaskValidationError("taskCode is required.");
  return toRow(await loadScoped(db, userId, projectId, code));
}

export async function listUserTasks(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: ListUserTasksFilter,
): Promise<UserTaskRow[]> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  if (filter?.status !== undefined) requireEnum(filter.status, USER_TASK_STATUSES, "status");
  if (filter?.priority !== undefined)
    requireEnum(filter.priority, USER_TASK_PRIORITIES, "priority");
  const scope = await requireProjectScope(db, userId, projectId);
  const conditions = [eq(userTasks.projectId, scope.projectId)];
  if (filter?.status !== undefined) conditions.push(eq(userTasks.status, filter.status));
  if (filter?.priority !== undefined) conditions.push(eq(userTasks.priority, filter.priority));
  if (filter?.milestone !== undefined) {
    const milestone = filter.milestone.trim();
    if (milestone === "") throw new UserTaskValidationError("milestone filter must be non-empty.");
    conditions.push(eq(userTasks.milestone, milestone));
  }
  // Milestone ordering (TASK-091) never overrides dependency rules: sort
  // order is a display hint only — nulls sort last, ties break by code so
  // the listing is deterministic regardless of insertion order.
  const rows = await db
    .select()
    .from(userTasks)
    .where(and(...conditions))
    .orderBy(sql`${userTasks.sortOrder} ASC NULLS LAST`, asc(userTasks.taskCode));
  return rows.map(toRow);
}

export async function updateUserTask(
  db: AppDatabase,
  userId: string,
  projectId: string,
  taskCode: string,
  raw: UpdateUserTaskInput,
): Promise<UserTaskRow> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const code = taskCode.trim();
  if (code === "") throw new UserTaskValidationError("taskCode is required.");
  if (raw.title !== undefined) requireText(raw.title, "title", MAX_TITLE_LENGTH);
  if (raw.objective !== undefined) requireText(raw.objective, "objective", MAX_OBJECTIVE_LENGTH);
  if (raw.priority !== undefined) requireEnum(raw.priority, USER_TASK_PRIORITIES, "priority");
  if (raw.status !== undefined) requireEnum(raw.status, USER_TASK_STATUSES, "status");
  const milestone =
    raw.milestone === undefined
      ? undefined
      : (optionalText(raw.milestone, "milestone", MAX_MILESTONE_LENGTH) ?? null);
  const implementationNotes =
    raw.implementationNotes === undefined
      ? undefined
      : (optionalText(raw.implementationNotes, "implementationNotes", MAX_NOTES_LENGTH) ?? null);
  // Criteria stay structured and non-empty: clearing them would break the
  // DONE-means-criteria-present invariant, so null/empty writes are rejected.
  const acceptanceCriteria =
    raw.acceptanceCriteria === undefined
      ? undefined
      : requireStringList(raw.acceptanceCriteria, "acceptanceCriteria");
  if (raw.acceptanceCriteria !== undefined && !acceptanceCriteria) {
    throw new UserTaskValidationError("acceptanceCriteria must be a non-empty array of strings.");
  }
  const definitionOfDone =
    raw.definitionOfDone === undefined
      ? undefined
      : requireStringList(raw.definitionOfDone, "definitionOfDone");
  if (raw.definitionOfDone !== undefined && !definitionOfDone) {
    throw new UserTaskValidationError("definitionOfDone must be a non-empty array of strings.");
  }
  const references =
    raw.references === undefined ? undefined : normalizeTaskReferences(raw.references);
  const sortOrder =
    raw.sortOrder === undefined ? undefined : (requireSortOrder(raw.sortOrder) ?? null);
  const touches =
    raw.title !== undefined ||
    raw.objective !== undefined ||
    raw.priority !== undefined ||
    raw.status !== undefined ||
    milestone !== undefined ||
    implementationNotes !== undefined ||
    acceptanceCriteria !== undefined ||
    definitionOfDone !== undefined ||
    references !== undefined ||
    sortOrder !== undefined;

  const current = await loadScoped(db, userId, projectId, code);
  if (!touches) return toRow(current);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    if (references !== undefined) {
      await assertRequirementRefsInScope(tx, scope.projectId, references);
    }
    const [updated] = await tx
      .update(userTasks)
      .set({
        ...(raw.title !== undefined ? { title: raw.title.trim() } : {}),
        ...(raw.objective !== undefined ? { objective: raw.objective.trim() } : {}),
        ...(raw.priority !== undefined ? { priority: raw.priority } : {}),
        ...(raw.status !== undefined ? { status: raw.status } : {}),
        ...(milestone !== undefined ? { milestone } : {}),
        ...(implementationNotes !== undefined ? { implementationNotes } : {}),
        ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
        ...(definitionOfDone !== undefined ? { definitionOfDone } : {}),
        ...(references !== undefined ? { references } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      })
      .where(eq(userTasks.id, current.id))
      .returning();
    if (!updated) throw new UserTaskNotFoundError();
    const row = toRow(updated);
    await incrementStateVersion(tx, userId, current.projectId);
    return row;
  });
}
