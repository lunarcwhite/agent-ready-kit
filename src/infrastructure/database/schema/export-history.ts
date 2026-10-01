// Export history (TASK-107).
//
// Append-only ledger of generated Agent Kit packages per project: which
// target was exported, from which project state version, with how many
// files. The manifest (TASK-103) describes a single package; this table
// answers "when did we last export, and is that export stale?" —
// staleness is a live comparison (last source_state_version vs current
// state version), never a stored flag that could drift.
//
// Bookkeeping, not canonical state: recording an export never bumps the
// project state version (same posture as traceability links) — otherwise
// exporting would itself stale the export just recorded.
import { index, integer, pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { projects } from "./projects";

export const exportHistory = pgTable(
  "export_history",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    target: varchar("target", { length: 32 }).notNull(),
    sourceStateVersion: integer("source_state_version").notNull(),
    artifactCount: integer("artifact_count").notNull(),
    ...timestampColumns(),
  },
  (table) => [
    index("export_history_project_id_created_at_idx").on(table.projectId, table.createdAt),
  ],
);
