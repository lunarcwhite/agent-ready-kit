// Requirement records (TASK-023, database-schema.md §22–§25).
//
// Stable implementation-relevant requirements stored independently from
// generated PRD prose (which is compiled later, TASK-062). Codes (FR-001…)
// come from the atomic per-project counter, never from an LLM, and are
// never reused — not after supersede, not after removal (§24, §68).
//
// Versioning story: there is deliberately NO requirement_history table.
// A replaced requirement is SUPERSEDED in place and its successor carries
// metadata.supersedes; the old row freezes as the audit trail. Status
// SUPERSEDED is server-managed (only supersedeRequirement writes it);
// REMOVED marks withdrawal without deleting the row.
//
// Source references (origin decisions/knowledge) ride metadata.sources as
// shape-validated loose refs. Relational traceability links arrive with
// TASK-024; this precursor keeps the task dependency-free per its spec.
import { jsonb, pgEnum, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { projects } from "./projects";

export const requirementType = pgEnum("requirement_type", [
  "FUNCTIONAL",
  "NON_FUNCTIONAL",
  "BUSINESS_RULE",
  "CONSTRAINT",
]);

// MoSCoW (database-schema.md §25).
export const requirementPriority = pgEnum("requirement_priority", [
  "MUST",
  "SHOULD",
  "COULD",
  "WONT",
]);

export const requirementStatus = pgEnum("requirement_status", [
  "DRAFT",
  "CONFIRMED",
  "DEFERRED",
  "SUPERSEDED",
  "REMOVED",
]);

export const requirements = pgTable(
  "requirements",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    requirementCode: varchar("requirement_code", { length: 16 }).notNull(),
    type: requirementType("type").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    priority: requirementPriority("priority").notNull(),
    status: requirementStatus("status").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria"),
    metadata: jsonb("metadata"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("requirements_project_id_requirement_code_unique").on(
      table.projectId,
      table.requirementCode,
    ),
  ],
);
