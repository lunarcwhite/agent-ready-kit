// Decision domain tables (TASK-021, database-schema.md §11–§16, FR-020–022).
//
// `decisions` is canonical structured state: one row per (project,
// decision_key) with a stable human code (DEC-AUTH-001) allocated by the
// atomic counter, never by an LLM and never reused (TASK-004). `value` is
// jsonb for structural storage; `confirmed_at` is server-owned (stamped on
// CONFIRMED transitions, cleared when leaving CONFIRMED).
//
// `decision_history` keeps every superseded snapshot (version, value,
// rationale, status, source) so "decision history can be determined"
// without reconstructing it from chat or AI output. History rows are
// append-only: no updates, no deletes, no updated_at.
//
// Status-transition POLICY (which transitions need approval, what
// RECOMMENDED may become) belongs to later tasks (TASK-054); this model
// validates enum membership only.
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
import { projects } from "./projects";

export const decisionStatus = pgEnum("decision_status", [
  "UNRESOLVED",
  "RECOMMENDED",
  "CONFIRMED",
  "DEFERRED",
  "NOT_APPLICABLE",
]);

// Priority weight only — unlike BLOCKER validation severity it never gates
// readiness by itself (database-schema.md §13).
export const decisionImpact = pgEnum("decision_impact", ["HIGH", "MEDIUM", "LOW"]);

export const decisionSourceType = pgEnum("decision_source_type", [
  "USER",
  "AI_RECOMMENDATION",
  "AI_INFERENCE",
  "SYSTEM",
]);

export const decisionConfidence = pgEnum("decision_confidence", [
  "EXPLICIT",
  "INFERRED",
  "ASSUMED",
]);

export const decisions = pgTable(
  "decisions",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    decisionKey: varchar("decision_key", { length: 128 }).notNull(),
    decisionCode: varchar("decision_code", { length: 32 }).notNull(),
    category: varchar("category", { length: 16 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    value: jsonb("value"),
    rationale: text("rationale"),
    status: decisionStatus("status").notNull(),
    impact: decisionImpact("impact").notNull(),
    sourceType: decisionSourceType("source_type").notNull(),
    confidence: decisionConfidence("confidence").notNull(),
    version: integer("version").notNull().default(1),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("decisions_project_id_decision_key_unique").on(table.projectId, table.decisionKey),
    uniqueIndex("decisions_project_id_decision_code_unique").on(
      table.projectId,
      table.decisionCode,
    ),
  ],
);

export const decisionHistory = pgTable(
  "decision_history",
  {
    ...uuidPrimaryKey(),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => decisions.id),
    version: integer("version").notNull(),
    value: jsonb("value"),
    rationale: text("rationale"),
    status: decisionStatus("status").notNull(),
    sourceType: decisionSourceType("source_type").notNull(),
    changedBy: uuid("changed_by"),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("decision_history_decision_id_idx").on(table.decisionId)],
);

// Decision dependency graph (TASK-022, database-schema.md §17).
//
// One row = one deterministic rule: "when source_key takes a matching value,
// apply effect to target_key". Keys are dot-notation logic keys (validated in
// the domain layer), NOT stable codes — rules follow concepts, and concepts
// keep their keys for life. No UNIQUE pair constraint: the same ordered pair
// may carry different rules for different values (e.g. true→REQUIRE,
// false→MARK_NOT_APPLICABLE); exact duplicates are rejected in domain logic.
export const decisionDependencyEffect = pgEnum("decision_dependency_effect", [
  "ACTIVATE",
  "REQUIRE",
  "INVALIDATE",
  "MARK_NOT_APPLICABLE",
]);

export const decisionDependencies = pgTable(
  "decision_dependencies",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sourceDecisionKey: varchar("source_decision_key", { length: 128 }).notNull(),
    targetDecisionKey: varchar("target_decision_key", { length: 128 }).notNull(),
    condition: jsonb("condition"),
    effect: decisionDependencyEffect("effect").notNull(),
    ...timestampColumns(),
  },
  (table) => [
    index("decision_dependencies_project_id_idx").on(table.projectId),
    index("decision_dependencies_source_idx").on(table.projectId, table.sourceDecisionKey),
    index("decision_dependencies_target_idx").on(table.projectId, table.targetDecisionKey),
  ],
);
