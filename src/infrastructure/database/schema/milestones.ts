// Milestone domain table (TASK-091, database-schema.md §46).
//
// Milestones group ordered user tasks without owning execution semantics:
// dependency order (TASK-093, user_task_dependencies) always wins over
// milestone display order, and moving a task between milestones never
// touches its stable UTASK code. Rows are never deleted through the
// domain (same freeze posture as user tasks, TASK-090): withdrawn
// milestones stay queryable so history remains auditable.
//
// Status (§46): PLANNED / ACTIVE / COMPLETED, freely settable on
// create/update — lifecycle derivation belongs to the planner workspace
// (TASK-095), not this model.
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { projects } from "./projects";

export const milestoneStatus = pgEnum("milestone_status", ["PLANNED", "ACTIVE", "COMPLETED"]);

export const milestones = pgTable(
  "milestones",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    milestoneCode: varchar("milestone_code", { length: 16 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    status: milestoneStatus("status").notNull().default("PLANNED"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("milestones_project_id_milestone_code_unique").on(
      table.projectId,
      table.milestoneCode,
    ),
    index("milestones_project_id_status_idx").on(table.projectId, table.status),
  ],
);
