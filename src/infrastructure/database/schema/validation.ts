// Validation issue domain tables (TASK-070, database-schema.md §39–§43).
//
// `validation_issues` stores Validation Engine findings (agents.md A-020
// Semantic Validator, A-021 Assumption Analyzer producers) with stable
// ISSUE-* codes from the atomic per-project counter (TASK-004, family
// "ISSUE" → ISSUE-001 per D-C05), never LLM output, never reused.
//
// Status lifecycle (§42): OPEN ↔ IGNORED, OPEN → RESOLVED, RESOLVED → OPEN
// (reopen). `resolved_at` is server-owned — stamped on resolve, cleared on
// reopen. Resolution metadata ({resolution, reason?, resolvedAt}) rides
// `metadata` jsonb, merged to preserve existing keys.
//
// `issue_references` links an issue to source/affected artifacts (§43).
// Polymorphic by design (§67): (reference_type, reference_id) address rows
// in different tables, so PostgreSQL cannot enforce the FKs — the domain
// service (src/modules/validation/issues.ts) validates DECISION /
// REQUIREMENT / KNOWLEDGE_ITEM ids same-project and accepts TASK ids
// structurally until the user-task model lands.
//
// Historical rows are never deleted: RESOLVED/IGNORED rows stay queryable,
// so past findings remain auditable (TASK-070 acceptance).
import {
  index,
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
import { projects } from "./projects";

// Validation finding kinds (database-schema.md §40).
export const issueType = pgEnum("issue_type", [
  "COMPLETENESS",
  "CONSISTENCY",
  "DEPENDENCY",
  "IMPLEMENTATION_COVERAGE",
  "ASSUMPTION",
  "ORPHAN",
  "SECURITY",
]);

// Severity scale (database-schema.md §41). BLOCKER gates readiness;
// decision impact (HIGH/MEDIUM/LOW) never does — keep them distinct.
export const issueSeverity = pgEnum("issue_severity", ["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"]);

export const issueStatus = pgEnum("issue_status", ["OPEN", "RESOLVED", "IGNORED"]);

// Reference relationship (database-schema.md §43): what produced the issue
// (SOURCE) versus what the issue affects (AFFECTED).
export const issueRelationship = pgEnum("issue_relationship", ["SOURCE", "AFFECTED"]);

export const validationIssues = pgTable(
  "validation_issues",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    issueCode: varchar("issue_code", { length: 16 }).notNull(),
    type: issueType("type").notNull(),
    severity: issueSeverity("severity").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    status: issueStatus("status").notNull().default("OPEN"),
    metadata: jsonb("metadata"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("validation_issues_project_id_issue_code_unique").on(
      table.projectId,
      table.issueCode,
    ),
    // Efficient filtered issue queues (acceptance criterion): filter by
    // status or severity without scanning sibling projects.
    index("validation_issues_project_id_status_idx").on(table.projectId, table.status),
    index("validation_issues_project_id_severity_idx").on(table.projectId, table.severity),
  ],
);

export const issueReferences = pgTable(
  "issue_references",
  {
    ...uuidPrimaryKey(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => validationIssues.id),
    referenceType: varchar("reference_type", { length: 32 }).notNull(),
    referenceId: uuid("reference_id").notNull(),
    relationship: issueRelationship("relationship").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("issue_references_issue_id_idx").on(table.issueId),
    index("issue_references_reference_idx").on(table.referenceType, table.referenceId),
  ],
);
