// User-project task tables (TASK-090, database-schema.md §47–§49, tasks.md
// §4–§5, spec-decisions.md D-A10b).
//
// These rows are the USER'S project tasks (UTASK-001…), not Agent Ready Kit's
// own implementation plan (TASK-xxx in docs/tasks.md). The distinct UTASK
// prefix keeps the two namespaces unambiguous per D-A10b.
//
// Physical names are `user_tasks` / `user_task_dependencies` — not `tasks` /
// `task_dependencies` — so a future canonical implementation-plan domain can
// claim the bare names without a rename.
//
// `tasks` field mapping (§47): membership is the nullable milestone_id FK
// (TASK-091) — the TASK-090 free-text label is replaced, so moves are
// validated same-project links that keep stable UTASK codes. Requirement/architecture/entity/screen references ride the
// `references` jsonb column as shape-validated loose refs (mirroring
// requirements.metadata.sources precedent): spec §47 lists the reference
// families but defines no column for them, and traceability_links (TASK-024,
// §50) does not exist yet. Requirement refs are validated same-project
// against the requirements table in the domain layer; ARC/SCREEN/ENTITY refs
// are structural-only until their tables land in other tasks.
//
// Status (§48) is a stored enum settable among all five values on
// create/update; DONE is an ordinary value here — no auto-derivation
// (READY/BLOCKED derivation and lifecycle transitions belong to TASK-092).
// Rows are never deleted through this domain: removed tasks freeze in place
// so stable IDs are never reused.
//
// This module is intentionally NOT re-exported from schema/index.ts yet:
// parallel M9 tasks share that barrel and the TASK-090 brief forbids edits
// outside src/shared/identifiers.ts. The domain module imports these tables
// directly, so runtime needs no barrel registration; the merge coordinator
// adds the one-line export when landing.
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { milestones } from "./milestones";
import { projects } from "./projects";

// Planning status (tasks.md §4). Lifecycle transitions are TASK-092's job;
// this model validates enum membership only.
export const userTaskStatus = pgEnum("user_task_status", [
  "PENDING",
  "READY",
  "BLOCKED",
  "REVIEW_REQUIRED",
  "DONE",
]);

// Priority (tasks.md §5): P0 MVP critical, P1 MVP important, P2 optional.
export const userTaskPriority = pgEnum("user_task_priority", ["P0", "P1", "P2"]);

export const userTasks = pgTable(
  "user_tasks",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    taskCode: varchar("task_code", { length: 16 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    objective: text("objective").notNull(),
    status: userTaskStatus("status").notNull().default("PENDING"),
    priority: userTaskPriority("priority").notNull(),
    milestoneId: uuid("milestone_id").references(() => milestones.id),
    implementationNotes: text("implementation_notes"),
    acceptanceCriteria: jsonb("acceptance_criteria").notNull(),
    definitionOfDone: jsonb("definition_of_done").notNull(),
    references: jsonb("references"),
    sortOrder: integer("sort_order"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("user_tasks_project_id_task_code_unique").on(table.projectId, table.taskCode),
    index("user_tasks_project_id_status_idx").on(table.projectId, table.status),
    index("user_tasks_milestone_id_idx").on(table.milestoneId),
  ],
);

// Task dependency graph (database-schema.md §49): one row = "task_id cannot
// start until depends_on_task_id completes". Unique pair, no self-dependency
// (both enforced here AND in domain logic); cycle detection is application
// logic in src/modules/tasks/dependencies.ts (mirroring decisions TASK-022).
export const userTaskDependencies = pgTable(
  "user_task_dependencies",
  {
    ...uuidPrimaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => userTasks.id),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => userTasks.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_task_dependencies_task_id_depends_on_unique").on(
      table.taskId,
      table.dependsOnTaskId,
    ),
    index("user_task_dependencies_task_id_idx").on(table.taskId),
    index("user_task_dependencies_depends_on_task_id_idx").on(table.dependsOnTaskId),
  ],
);
