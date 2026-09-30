// Knowledge domain tables (TASK-055, database-schema.md §18–§21, FR-030–032).
//
// `knowledge_items` is canonical structured state: one row per
// (project, knowledge_key) holding normalized understanding in a canonical
// domain (database-schema.md §19). Keys are lowercase dot-notation logic keys
// (e.g. `vision.summary`), validated in the domain layer — never LLM output.
// `content` is jsonb for structural storage; `confidence` reuses the decision
// confidence scale (EXPLICIT/INFERRED/ASSUMED, §15) so provenance mapping
// (TASK-025) applies uniformly and an assumption can never masquerade as an
// explicit user fact.
//
// `knowledge_sources` is the provenance record (FR-031): every item keeps
// origin rows answering "why do we believe this?". DECISION/REQUIREMENT
// sources carry the referenced row id and are validated same-project in the
// domain layer; USER_MESSAGE/PROJECT_INPUT/AI_INFERENCE rows may carry a null
// source_id for free-form evidence. Cross-project links are rejected.
//
// Status lifecycle (§20): CURRENT → STALE (upstream change needs review) →
// CURRENT again, or CURRENT → SUPERSEDED (replaced/merged, frozen forever).
// Direct writes to SUPERSEDED are rejected — supersede/merge are the blessed
// paths, mirroring the requirements freeze rule (TASK-023). There is no
// history table: the SUPERSEDED row itself is the audit trail.
//
// Duplicate handling is deterministic (normalized title/content comparison in
// the domain layer); merging re-points the loser's sources to the winner and
// freezes the loser — one user action, one state-version bump (TASK-020).
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { projects } from "./projects";

// Canonical domain set (database-schema.md §19). Aliases from PRD FR-030,
// TASK-055 categories, and Discovery domains map to these in
// `src/modules/knowledge/taxonomy.ts` (tasks.md §18a deliverable) — the
// column stores only canonical values so every consumer queries one
// vocabulary.
export const knowledgeDomain = pgEnum("knowledge_domain", [
  "PRODUCT",
  "USER",
  "FEATURE",
  "BUSINESS_RULE",
  "ACCESS",
  "DATA",
  "UX",
  "TECHNICAL",
  "INTEGRATION",
  "AI",
  "NON_FUNCTIONAL",
]);

export const knowledgeStatus = pgEnum("knowledge_status", ["CURRENT", "STALE", "SUPERSEDED"]);

export const knowledgeConfidence = pgEnum("knowledge_confidence", [
  "EXPLICIT",
  "INFERRED",
  "ASSUMED",
]);

export const knowledgeSourceType = pgEnum("knowledge_source_type", [
  "DECISION",
  "USER_MESSAGE",
  "PROJECT_INPUT",
  "AI_INFERENCE",
  "REQUIREMENT",
]);

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    knowledgeKey: varchar("knowledge_key", { length: 128 }).notNull(),
    domain: knowledgeDomain("domain").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    content: jsonb("content").notNull(),
    confidence: knowledgeConfidence("confidence").notNull(),
    status: knowledgeStatus("status").notNull().default("CURRENT"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("knowledge_items_project_id_knowledge_key_unique").on(
      table.projectId,
      table.knowledgeKey,
    ),
    // Efficient current-knowledge queries (acceptance criterion): filter by
    // domain or status without scanning sibling projects.
    index("knowledge_items_project_id_domain_idx").on(table.projectId, table.domain),
    index("knowledge_items_project_id_status_idx").on(table.projectId, table.status),
  ],
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    ...uuidPrimaryKey(),
    knowledgeItemId: uuid("knowledge_item_id")
      .notNull()
      .references(() => knowledgeItems.id),
    sourceType: knowledgeSourceType("source_type").notNull(),
    sourceId: uuid("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_sources_item_idx").on(table.knowledgeItemId),
    index("knowledge_sources_source_idx").on(table.sourceType, table.sourceId),
  ],
);
