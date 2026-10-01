// Specification domain tables (TASK-060, database-schema.md §29–§33).
//
// Specifications are DERIVED artifacts compiled from canonical state —
// never the source of truth (AGENTS.md §16). This shapes the whole model:
//
// - specification_documents: one logical document per (project, type).
//   current_version counts approved snapshots; status tracks the review
//   lifecycle (DRAFT → REVIEW_REQUIRED → CURRENT, STALE when canonical
//   state moved on).
// - specification_sections: independently manageable units with stable
//   dot-notation keys (e.g. `architecture.authentication`). structured_content
//   holds machine-readable meaning, rendered_content the Markdown text.
//   PROPOSED sections await review; only CURRENT sections ship.
// - specification_versions: immutable approved snapshots binding rendered
//   content to the project_state_version it was compiled from — the answer
//   to "which project state does this document describe?".
//
// Unique (project_id, document_type): one logical document per type per
// project. The spec does not state this explicitly, but current_version as
// a per-document counter is meaningless with duplicate logical documents.
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

export const specificationDocumentType = pgEnum("specification_document_type", [
  "PRD",
  "ARCHITECTURE",
  "DATABASE_SCHEMA",
  "DESIGN",
  "PRODUCT_AGENTS",
  "SOUL",
  "TASKS",
  "CONTEXT",
  "AGENT_INSTRUCTIONS",
]);

export const specificationDocumentStatus = pgEnum("specification_document_status", [
  "DRAFT",
  "CURRENT",
  "STALE",
  "REVIEW_REQUIRED",
]);

export const specificationSectionStatus = pgEnum("specification_section_status", [
  "CURRENT",
  "STALE",
  "PROPOSED",
  "REVIEW_REQUIRED",
]);

// Dependency tracking (TASK-061, database-schema.md §34).
//
// Which canonical elements affect a section. Polymorphic by design (§67):
// (source_type, source_id) points into decisions, knowledge_items,
// requirements, or domain_entities, so the domain service validates
// existence and same-project scope instead of the database. Replacing a
// section's full dep set is the primitive — compilers declare complete
// dependencies every run, making drift unrepresentable.
export const sectionSourceType = pgEnum("section_source_type", [
  "DECISION",
  "KNOWLEDGE",
  "REQUIREMENT",
  "ENTITY",
]);

export const sectionDependencies = pgTable(
  "section_dependencies",
  {
    ...uuidPrimaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => specificationSections.id),
    sourceType: sectionSourceType("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("section_dependencies_unique").on(
      table.sectionId,
      table.sourceType,
      table.sourceId,
    ),
    index("section_dependencies_section_id_idx").on(table.sectionId),
    index("section_dependencies_source_idx").on(table.sourceType, table.sourceId),
  ],
);

export const specificationDocuments = pgTable(
  "specification_documents",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    documentType: specificationDocumentType("document_type").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    status: specificationDocumentStatus("status").notNull().default("DRAFT"),
    currentVersion: integer("current_version").notNull().default(1),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("specification_documents_project_id_type_unique").on(
      table.projectId,
      table.documentType,
    ),
    index("specification_documents_project_id_idx").on(table.projectId),
  ],
);

export const specificationSections = pgTable(
  "specification_sections",
  {
    ...uuidPrimaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => specificationDocuments.id),
    sectionKey: varchar("section_key", { length: 128 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    structuredContent: jsonb("structured_content"),
    renderedContent: text("rendered_content").notNull().default(""),
    status: specificationSectionStatus("status").notNull().default("CURRENT"),
    dependencyHash: varchar("dependency_hash", { length: 64 }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("specification_sections_document_id_key_unique").on(
      table.documentId,
      table.sectionKey,
    ),
    index("specification_sections_document_id_idx").on(table.documentId),
  ],
);

export const specificationVersions = pgTable(
  "specification_versions",
  {
    ...uuidPrimaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => specificationDocuments.id),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    projectStateVersion: integer("project_state_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("specification_versions_document_id_version_unique").on(
      table.documentId,
      table.version,
    ),
    index("specification_versions_document_id_idx").on(table.documentId),
  ],
);

// Proposed-change lifecycle (TASK-132, database-schema.md §35).
//
// AI-generated modifications awaiting human review. MVP targets
// SPECIFICATION_SECTION rows only — the generic (target_type, target_id)
// shape leaves room for future targets without a schema change.
// base_state_version is the canonical clock (TASK-020): a proposal created
// at state N whose project has since moved to N+1 is stale and must not
// apply over newer state. Polymorphic target refs follow §67: the domain
// service validates same-project scope instead of the database.
export const proposalTargetType = pgEnum("proposal_target_type", ["SPECIFICATION_SECTION"]);

export const proposalChangeType = pgEnum("proposal_change_type", ["UPDATE_CONTENT"]);

export const proposalStatus = pgEnum("proposal_status", ["PENDING", "ACCEPTED", "REJECTED"]);

export const proposedChanges = pgTable(
  "proposed_changes",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    targetType: proposalTargetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    changeType: proposalChangeType("change_type").notNull(),
    previousContent: jsonb("previous_content"),
    proposedContent: jsonb("proposed_content").notNull(),
    reason: text("reason"),
    baseStateVersion: integer("base_state_version").notNull(),
    status: proposalStatus("status").notNull().default("PENDING"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    index("proposed_changes_project_id_idx").on(table.projectId),
    index("proposed_changes_project_id_status_idx").on(table.projectId, table.status),
    index("proposed_changes_target_idx").on(table.targetType, table.targetId),
  ],
);
