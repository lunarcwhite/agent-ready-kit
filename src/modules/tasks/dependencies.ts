// User-task dependency graph (TASK-090, database-schema.md §49).
//
// Deterministic rules evaluated by application code — never by LLM intuition
// (AGENTS.md §23). One row = "taskCode cannot start until dependsOnCode
// completes". Edges reference stable UTASK codes at the API boundary and row
// ids in storage; both ends must exist in the same project.
//
// This module holds no runtime imports from user-tasks.ts (types only), so
// evaluation callers there depend one way — no cycles. It queries the schema
// tables directly, mirroring src/modules/decisions/dependencies.ts.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { userTaskDependencies, userTasks } from "../../infrastructure/database/schema/user-tasks";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { UserTaskNotFoundError, UserTaskValidationError } from "./errors";
import type { UserTaskRow } from "./user-tasks";

export interface TaskDependencyEdge {
  sourceCode: string;
  targetCode: string;
}

export interface TaskDependencyRow {
  id: string;
  taskCode: string;
  dependsOnCode: string;
  createdAt: Date;
}

// READY/BLOCKED derivation (TASK-093, AGENTS.md §46): readiness is a
// pure function of direct prerequisite states — READY iff every
// prerequisite is DONE (vacuously true with no prerequisites), else
// BLOCKED. Multi-level chains emerge transitively: each task derives
// from its direct prerequisites, whose own states are derived the same
// way. DONE and REVIEW_REQUIRED are authoritative human/execution states
// and are never derived — only the PENDING/READY/BLOCKED band is.
export function deriveReadiness(dependencyStatuses: readonly string[]): "READY" | "BLOCKED" {
  return dependencyStatuses.every((status) => status === "DONE") ? "READY" : "BLOCKED";
}

// Recomputes the PENDING/READY/BLOCKED band for the whole project inside
// the caller's transaction (no version bump here — the caller owns the
// bump for its logical operation). Returns updated codes, sorted.
export async function refreshDerivedReadinessTx(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<string[]> {
  const scope = await requireProjectScope(db, userId, projectId);
  const tasks = await db
    .select({ id: userTasks.id, taskCode: userTasks.taskCode, status: userTasks.status })
    .from(userTasks)
    .where(eq(userTasks.projectId, scope.projectId));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depRows = await db.select().from(userTaskDependencies);
  const prerequisites = new Map<string, string[]>();
  for (const row of depRows) {
    if (!byId.has(row.taskId) || !byId.has(row.dependsOnTaskId)) continue;
    const list = prerequisites.get(row.taskId) ?? [];
    list.push(row.dependsOnTaskId);
    prerequisites.set(row.taskId, list);
  }
  const updated: string[] = [];
  for (const task of tasks) {
    if (task.status !== "PENDING" && task.status !== "READY" && task.status !== "BLOCKED") {
      continue;
    }
    const depStatuses = (prerequisites.get(task.id) ?? []).map((id) => byId.get(id)?.status ?? "");
    const derived = deriveReadiness(depStatuses);
    if (derived !== task.status) {
      await db.update(userTasks).set({ status: derived }).where(eq(userTasks.id, task.id));
      updated.push(task.taskCode);
    }
  }
  return updated.sort();
}

// Standalone entry for explicit callers (plan workspace, tests): one
// transaction, one version bump only when something changed.
export async function refreshDerivedReadiness(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<{ updated: string[] }> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const updated = await refreshDerivedReadinessTx(tx, userId, scope.projectId);
    if (updated.length > 0) await incrementStateVersion(tx, userId, scope.projectId);
    return { updated };
  });
}
// from the candidate prerequisite — reaching the candidate dependent means
// the new edge would close a loop. Pure: fully unit-testable without a
// database. Mirrors wouldCreateCycle in decisions/dependencies.ts.
export function wouldCreateTaskCycle(
  edges: TaskDependencyEdge[],
  taskCode: string,
  dependsOnCode: string,
): boolean {
  if (taskCode === dependsOnCode) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of [...edges, { sourceCode: taskCode, targetCode: dependsOnCode }]) {
    const list = adjacency.get(edge.sourceCode) ?? [];
    list.push(edge.targetCode);
    adjacency.set(edge.sourceCode, list);
  }
  const visited = new Set<string>();
  const stack: string[] = [dependsOnCode];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === taskCode) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

function requireCode(raw: string, field: string): string {
  const code = raw.trim();
  if (code === "") throw new UserTaskValidationError(`${field} is required.`);
  if (code.length > 16) {
    throw new UserTaskValidationError(`${field} must be at most 16 characters.`);
  }
  return code;
}

async function loadTaskIdMap(
  db: AppDatabase,
  projectId: string,
): Promise<{ byCode: Map<string, string>; byId: Map<string, string> }> {
  const rows = await db
    .select({ id: userTasks.id, taskCode: userTasks.taskCode })
    .from(userTasks)
    .where(eq(userTasks.projectId, projectId))
    .orderBy(asc(userTasks.taskCode));
  const byCode = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const row of rows) {
    byCode.set(row.taskCode, row.id);
    byId.set(row.id, row.taskCode);
  }
  return { byCode, byId };
}

function toDependencyRow(
  raw: typeof userTaskDependencies.$inferSelect,
  byId: Map<string, string>,
): TaskDependencyRow {
  const taskCode = byId.get(raw.taskId) ?? "";
  const dependsOnCode = byId.get(raw.dependsOnTaskId) ?? "";
  return { id: raw.id, taskCode, dependsOnCode, createdAt: raw.createdAt };
}

export async function addUserTaskDependency(
  db: AppDatabase,
  userId: string,
  projectId: string,
  taskCode: string,
  dependsOnCode: string,
): Promise<TaskDependencyRow> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const task = requireCode(taskCode, "taskCode");
  const dependsOn = requireCode(dependsOnCode, "dependsOnCode");
  if (task === dependsOn) {
    throw new UserTaskValidationError("A task cannot depend on itself.");
  }

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const { byCode, byId } = await loadTaskIdMap(tx, scope.projectId);
    const taskId = byCode.get(task);
    const dependsOnId = byCode.get(dependsOn);
    // Both ends must exist in this project: edges never dangle off unknown
    // tasks, and foreign-project codes surface as NotFound (TASK-014).
    if (!taskId || !dependsOnId) throw new UserTaskNotFoundError("Task not found.");

    const existing = await tx
      .select()
      .from(userTaskDependencies)
      .where(
        and(
          eq(userTaskDependencies.taskId, taskId),
          eq(userTaskDependencies.dependsOnTaskId, dependsOnId),
        ),
      );
    if (existing.length > 0) {
      throw new UserTaskValidationError("This dependency is already registered.");
    }

    const all = await tx.select().from(userTaskDependencies);
    const edges: TaskDependencyEdge[] = [];
    for (const row of all) {
      const from = byId.get(row.taskId);
      const to = byId.get(row.dependsOnTaskId);
      if (from !== undefined && to !== undefined) edges.push({ sourceCode: from, targetCode: to });
    }
    if (wouldCreateTaskCycle(edges, task, dependsOn)) {
      throw new UserTaskValidationError(
        `Adding ${task} → ${dependsOn} would create a dependency cycle.`,
      );
    }

    let inserted: typeof userTaskDependencies.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(userTaskDependencies)
        .values({ taskId, dependsOnTaskId: dependsOnId })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new UserTaskValidationError("This dependency is already registered.");
      }
      throw error;
    }
    if (!inserted) throw new UserTaskNotFoundError("Dependency registration failed.");
    // Derive readiness for the affected band after the edge lands
    // (TASK-093): a new prerequisite blocks its dependent until DONE.
    await refreshDerivedReadinessTx(tx, userId, scope.projectId);
    await incrementStateVersion(tx, userId, scope.projectId);
    return toDependencyRow(inserted, byId);
  });
}

export async function removeUserTaskDependency(
  db: AppDatabase,
  userId: string,
  projectId: string,
  taskCode: string,
  dependsOnCode: string,
): Promise<void> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const task = requireCode(taskCode, "taskCode");
  const dependsOn = requireCode(dependsOnCode, "dependsOnCode");

  await db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const { byCode } = await loadTaskIdMap(tx, scope.projectId);
    const taskId = byCode.get(task);
    const dependsOnId = byCode.get(dependsOn);
    if (!taskId || !dependsOnId) throw new UserTaskNotFoundError("Task not found.");
    const existing = await tx
      .select({ id: userTaskDependencies.id })
      .from(userTaskDependencies)
      .where(
        and(
          eq(userTaskDependencies.taskId, taskId),
          eq(userTaskDependencies.dependsOnTaskId, dependsOnId),
        ),
      );
    const row = existing[0];
    if (!row) throw new UserTaskNotFoundError("Dependency not found.");
    await tx.delete(userTaskDependencies).where(eq(userTaskDependencies.id, row.id));
    // Derive readiness after the edge leaves (TASK-093): removing the last
    // incomplete prerequisite may unblock the dependent.
    await refreshDerivedReadinessTx(tx, userId, scope.projectId);
    await incrementStateVersion(tx, userId, scope.projectId);
  });
}

// All dependency edges in the project, with stable codes resolved —
// the queryable graph behind TASK-090's "dependencies can be queried".
export async function listUserTaskDependencies(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<TaskDependencyRow[]> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const { byId } = await loadTaskIdMap(db, scope.projectId);
  const rows = await db.select().from(userTaskDependencies);
  return rows
    .filter((row) => byId.has(row.taskId) && byId.has(row.dependsOnTaskId))
    .map((row) => toDependencyRow(row, byId))
    .sort(
      (a, b) =>
        a.taskCode.localeCompare(b.taskCode) || a.dependsOnCode.localeCompare(b.dependsOnCode),
    );
}

async function loadTaskOrThrow(
  db: AppDatabase,
  userId: string,
  projectId: string,
  taskCode: string,
): Promise<UserTaskRow["id"]> {
  const scope = await requireProjectScope(db, userId, projectId);
  const [found] = await db
    .select({ id: userTasks.id })
    .from(userTasks)
    .where(and(eq(userTasks.projectId, scope.projectId), eq(userTasks.taskCode, taskCode)));
  if (!found) throw new UserTaskNotFoundError();
  return found.id;
}

// Prerequisites of one task: the UTASK codes it waits on.
export async function listTaskPrerequisites(
  db: AppDatabase,
  userId: string,
  projectId: string,
  taskCode: string,
): Promise<TaskDependencyRow[]> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const code = requireCode(taskCode, "taskCode");
  const all = await listUserTaskDependencies(db, userId, projectId);
  await loadTaskOrThrow(db, userId, projectId, code);
  return all.filter((row) => row.taskCode === code);
}

// Dependents of one task: the UTASK codes waiting on it.
export async function listTaskDependents(
  db: AppDatabase,
  userId: string,
  projectId: string,
  taskCode: string,
): Promise<TaskDependencyRow[]> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  const code = requireCode(taskCode, "taskCode");
  const all = await listUserTaskDependencies(db, userId, projectId);
  await loadTaskOrThrow(db, userId, projectId, code);
  return all.filter((row) => row.dependsOnCode === code);
}
