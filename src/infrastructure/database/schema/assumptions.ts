// Assumption domain tables (TASK-074, database-schema.md §36–§38).
//
// `assumptions` are first-class project objects: implementation-relevant
// beliefs tracked separately from confirmed knowledge (AGENTS.md §36),
// each with a stable ASM-* code from the atomic per-project counter
// (TASK-004, family "ASM"), never LLM output, never reused.
//
// Status lifecycle (§37): OPEN → CONFIRMED | REPLACED | DEFERRED |
// REJECTED; DEFERRED ↔ OPEN. CONFIRMED/REJECTED reopen to OPEN;
// REPLACED is terminal — act on the successor (linked through
// assumption_impacts with target_type ASSUMPTION). `resolved_at` and
// `resolution` are server-owned: stamped on terminal/deferred resolution,
// cleared on reopen, never caller-supplied.
//
// Two deliberate extensions beyond the §36 sketch, required by the TASK-074
// acceptance criteria ("Source is stored", resolvable with reason):
// - `source` records the assumption's origin (USER_IMPLIED, AI_ASSUMED,
//   AI_RECOMMENDED, SYSTEM_DERIVED) so an AI guess can never masquerade
//   as a user statement (soul.md provenance discipline);
// - `resolution` records the human's resolve/reject/defer reason.
// Both are reported as spec-gap resolutions, not silent deviations.
//
// `assumption_impacts` tracks affected specification elements (§38).
// Polymorphic by design (§67): (target_type, target_id) addresses rows in
// different tables, so PostgreSQL cannot enforce the FKs — the domain
// service (src/modules/validation/assumptions.ts) validates DECISION /
// REQUIREMENT / KNOWLEDGE_ITEM / ASSUMPTION ids same-project and accepts
// TASK ids structurally until the user-task model lands (same posture as
// issue_references, TASK-070).
//
// Historical rows are never deleted: terminal rows stay queryable, so past
// assumptions remain auditable.
import {
  index,
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

// Assumption lifecycle (database-schema.md §37).
export const assumptionStatus = pgEnum("assumption_status", [
  "OPEN",
  "CONFIRMED",
  "REPLACED",
  "DEFERRED",
  "REJECTED",
]);

// Impact scale: same HIGH/MEDIUM/LOW vocabulary as decision impact
// (database-schema.md §13) and answer-interpreter assumption impacts, so
// readiness rules (TASK-080) consume one scale.
export const assumptionImpact = pgEnum("assumption_impact", ["HIGH", "MEDIUM", "LOW"]);

// Strength of belief in the assumption. HIGH/MEDIUM/LOW — not the
// EXPLICIT/INFERRED/ASSUMED provenance scale, which cannot discriminate
// here (every assumption would be ASSUMED); origin rides `source` instead.
export const assumptionConfidence = pgEnum("assumption_confidence", ["HIGH", "MEDIUM", "LOW"]);

// Origin of the assumption (TASK-074 acceptance: source is stored).
// USER_EXPLICIT is excluded by construction: directly stated facts are
// knowledge or decisions, never assumptions.
export const assumptionSource = pgEnum("assumption_source", [
  "USER_IMPLIED",
  "AI_ASSUMED",
  "AI_RECOMMENDED",
  "SYSTEM_DERIVED",
]);

export const assumptions = pgTable(
  "assumptions",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    assumptionCode: varchar("assumption_code", { length: 16 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    impact: assumptionImpact("impact").notNull(),
    confidence: assumptionConfidence("confidence").notNull(),
    source: assumptionSource("source").notNull(),
    status: assumptionStatus("status").notNull().default("OPEN"),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("assumptions_project_id_assumption_code_unique").on(
      table.projectId,
      table.assumptionCode,
    ),
    // Efficient assumption queues: OPEN-by-status for the workspace and
    // OPEN-by-impact for readiness rules (TASK-080 consumes HIGH first).
    index("assumptions_project_id_status_idx").on(table.projectId, table.status),
    index("assumptions_project_id_impact_idx").on(table.projectId, table.impact),
  ],
);

export const assumptionImpacts = pgTable(
  "assumption_impacts",
  {
    ...uuidPrimaryKey(),
    assumptionId: uuid("assumption_id")
      .notNull()
      .references(() => assumptions.id),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("assumption_impacts_assumption_id_idx").on(table.assumptionId),
    index("assumption_impacts_target_idx").on(table.targetType, table.targetId),
  ],
);
