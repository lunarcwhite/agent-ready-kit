// Milestone domain model (TASK-091, database-schema.md §46).
//
// Project-scoped groups for ordered user tasks. Each row carries a stable
// MS-* code from the atomic per-project counter (TASK-004, family "MS"),
// never LLM output, never reused. Membership lives on
// user_tasks.milestone_id: moving a task edits the link, never the task's
// stable UTASK code, and never the dependency graph (milestone display
// order cannot override dependency rules — dependencies.ts derives
// readiness from edges alone).
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted mutation numbers the project
// state version once (TASK-020) inside the same transaction.
//
// Status (§46: PLANNED/ACTIVE/COMPLETED) is settable on create/update;
// lifecycle derivation belongs to the planner workspace (TASK-095).
// There is deliberately NO delete API: rows freeze in place so codes are
// never reused and history stays queryable (same posture as user tasks).
//
// Query style: query-builder throughout, compiling against the shared
// AppDatabase type without relational-registry coupling.
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import { milestones } from "../../infrastructure/database/schema/milestones";
import { userTasks } from "../../infrastructure/database/schema/user-tasks";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { UserTaskNotFoundError, UserTaskValidationError } from "./errors";

export const MILESTONE_STATUSES = ["PLANNED", "ACTIVE", "COMPLETED"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export interface MilestoneRow {
  id: string;
  projectId: string;
  milestoneCode: string;
  title: string;
  description: string | null;
  sortOrder: number;
  status: MilestoneStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMilestoneInput {
  title: string;
  description?: string | null;
  sortOrder?: number | null;
  status?: MilestoneStatus;
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string | null;
  sortOrder?: number | null;
  status?: MilestoneStatus;
}

export interface ListMilestonesFilter {
  status?: MilestoneStatus;
}

const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20000;

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

function optionalText(raw: string | null | undefined, field: string, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  if (text.length > max) {
    throw new UserTaskValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireSortOrder(raw: number | null | undefined): number {
  if (raw === undefined || raw === null) return 0;
  if (!Number.isInteger(raw)) {
    throw new UserTaskValidationError("sortOrder must be an integer when provided.");
  }
  return raw;
}

function toRow(raw: typeof milestones.$inferSelect): MilestoneRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    milestoneCode: raw.milestoneCode,
    title: raw.title,
    description: raw.description,
    sortOrder: raw.sortOrder,
    status: raw.status as MilestoneStatus,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  milestoneCode: string,
): Promise<typeof milestones.$inferSelect> {
  const scope = await requireProjectScope(db, userId, projectId);
  const [found] = await db
    .select()
    .from(milestones)
    .where(
      and(eq(milestones.projectId, scope.projectId), eq(milestones.milestoneCode, milestoneCode)),
    );
  if (!found) throw new UserTaskNotFoundError("Milestone not found.");
  return found;
}

export async function createMilestone(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateMilestoneInput,
): Promise<MilestoneRow> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const title = requireText(raw.title, "title", MAX_TITLE_LENGTH);
  const description = optionalText(raw.description ?? null, "description", MAX_DESCRIPTION_LENGTH);
  const sortOrder = requireSortOrder(raw.sortOrder);
  const status =
    raw.status === undefined ? "PLANNED" : requireEnum(raw.status, MILESTONE_STATUSES, "status");

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const milestoneCode = await allocateStableIdTx(tx, scope.projectId, "MS");
    let inserted: typeof milestones.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(milestones)
        .values({
          projectId: scope.projectId,
          milestoneCode,
          title,
          description,
          sortOrder,
          status,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new UserTaskValidationError("Milestone code clash, retry the operation.");
      }
      throw error;
    }
    if (!inserted) throw new UserTaskNotFoundError("Milestone creation failed.");
    await incrementStateVersion(tx, userId, scope.projectId);
    return toRow(inserted);
  });
}

export async function getMilestoneByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  milestoneCode: string,
): Promise<MilestoneRow> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const code = milestoneCode.trim();
  if (code === "") throw new UserTaskValidationError("milestoneCode is required.");
  return toRow(await loadScoped(db, userId, projectId, code));
}

export async function listMilestones(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: ListMilestonesFilter,
): Promise<MilestoneRow[]> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  if (filter?.status !== undefined) requireEnum(filter.status, MILESTONE_STATUSES, "status");
  const scope = await requireProjectScope(db, userId, projectId);
  const conditions = [eq(milestones.projectId, scope.projectId)];
  if (filter?.status !== undefined) conditions.push(eq(milestones.status, filter.status));
  // Display order only: sort_order, ties by code for determinism. This
  // ordering never feeds dependency derivation (TASK-093 reads edges).
  const rows = await db
    .select()
    .from(milestones)
    .where(and(...conditions))
    .orderBy(asc(milestones.sortOrder), asc(milestones.milestoneCode));
  return rows.map(toRow);
}

export async function updateMilestone(
  db: AppDatabase,
  userId: string,
  projectId: string,
  milestoneCode: string,
  raw: UpdateMilestoneInput,
): Promise<MilestoneRow> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const code = milestoneCode.trim();
  if (code === "") throw new UserTaskValidationError("milestoneCode is required.");
  if (raw.title !== undefined) requireText(raw.title, "title", MAX_TITLE_LENGTH);
  if (raw.status !== undefined) requireEnum(raw.status, MILESTONE_STATUSES, "status");
  const description =
    raw.description === undefined
      ? undefined
      : optionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const sortOrder = raw.sortOrder === undefined ? undefined : requireSortOrder(raw.sortOrder);
  const touches =
    raw.title !== undefined ||
    description !== undefined ||
    sortOrder !== undefined ||
    raw.status !== undefined;

  const current = await loadScoped(db, userId, projectId, code);
  if (!touches) return toRow(current);

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(milestones)
      .set({
        ...(raw.title !== undefined ? { title: raw.title.trim() } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(raw.status !== undefined ? { status: raw.status } : {}),
      })
      .where(eq(milestones.id, current.id))
      .returning();
    if (!updated) throw new UserTaskNotFoundError();
    await incrementStateVersion(tx, userId, current.projectId);
    return toRow(updated);
  });
}

// Ordered containment read (acceptance criterion): tasks of one milestone
// by task sort_order, nulls last, ties by code — the same display order
// as listUserTasks, scoped to the milestone. Read-only: no writes.
export async function listMilestoneTasks(
  db: AppDatabase,
  userId: string,
  projectId: string,
  milestoneCode: string,
): Promise<{ milestone: MilestoneRow; taskCodes: string[] }> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const code = milestoneCode.trim();
  if (code === "") throw new UserTaskValidationError("milestoneCode is required.");
  const milestone = await loadScoped(db, userId, projectId, code);
  const rows = await db
    .select({ taskCode: userTasks.taskCode })
    .from(userTasks)
    .where(
      and(eq(userTasks.projectId, milestone.projectId), eq(userTasks.milestoneId, milestone.id)),
    )
    .orderBy(sql`${userTasks.sortOrder} ASC NULLS LAST`, asc(userTasks.taskCode));
  return { milestone: toRow(milestone), taskCodes: rows.map((row) => row.taskCode) };
}
