import { integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

// Atomic sequences backing deterministic stable IDs (database-schema.md §70).
// One row per (project, counter_type); the allocator advances current_value
// with a single upsert so concurrent callers never receive the same sequence.
//
// Sequencing note: FK to projects.id is deferred to TASK-011 because the
// projects table does not exist yet. Until then project_id is an
// unconstrained uuid; namespace isolation is enforced by the unique
// (project_id, counter_type) constraint below. created_at is omitted per §70 —
// counter rows are monotonic sequence state, history lives in domain rows.
export const projectCounters = pgTable(
  "project_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    counterType: varchar("counter_type", { length: 32 }).notNull(),
    currentValue: integer("current_value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_counters_project_id_counter_type_unique").on(
      table.projectId,
      table.counterType,
    ),
  ],
);
