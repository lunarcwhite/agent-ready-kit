// Architecture + screen records (TASK-059, database-schema.md §45–§45a).
//
// Stable implementation-relevant identifiers stored independently from
// generated architecture/design prose (compiled later, TASK-063). Codes
// (ARC-001…, SCREEN-001…) come from the atomic per-project counter, never
// from an LLM, and are never reused — not after supersede, not after
// removal (§68–§69, spec-decisions.md D-C08/D-C09).
//
// Versioning story: there is deliberately NO history table. A replaced row
// freezes as SUPERSEDED in place and its successor carries
// metadata.supersedes; the old row is the audit trail. SUPERSEDED is
// server-managed (only supersedeComponent/supersedeScreen write it);
// REMOVED marks withdrawal without deleting the row (only
// removeComponent/removeScreen write it). Rows are never hard-deleted.
import { jsonb, pgEnum, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { projects } from "./projects";

export const architectureStatus = pgEnum("architecture_status", [
  "DRAFT",
  "CONFIRMED",
  "DEFERRED",
  "SUPERSEDED",
  "REMOVED",
]);

export const screenStatus = pgEnum("screen_status", [
  "DRAFT",
  "CONFIRMED",
  "DEFERRED",
  "SUPERSEDED",
  "REMOVED",
]);

export const architectureComponents = pgTable(
  "architecture_components",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    componentCode: varchar("component_code", { length: 16 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: architectureStatus("status").notNull(),
    metadata: jsonb("metadata"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("architecture_components_project_id_component_code_unique").on(
      table.projectId,
      table.componentCode,
    ),
  ],
);

export const screens = pgTable(
  "screens",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    screenCode: varchar("screen_code", { length: 16 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    routeHint: varchar("route_hint", { length: 255 }),
    status: screenStatus("status").notNull(),
    metadata: jsonb("metadata"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("screens_project_id_screen_code_unique").on(table.projectId, table.screenCode),
  ],
);
