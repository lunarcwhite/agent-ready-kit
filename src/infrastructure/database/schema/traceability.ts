// Traceability graph (TASK-024, database-schema.md §44, FR-050).
//
// Directed links between canonical artifacts across domain tables.
// Polymorphic by design (§67): (source_type, source_id) and
// (target_type, target_id) reference rows in different tables, so
// PostgreSQL cannot enforce the FKs — the domain service validates node
// existence, type membership, and same-project scope instead. Node types
// and relationship shapes are controlled vocabularies in the domain layer;
// the columns stay varchar so future artifact kinds (ENT, ARC, SCREEN,
// TASK, KNOWLEDGE) extend the registry without a schema change.
//
// No cycle check: unlike decision dependencies (which EXECUTE), these links
// document — mutual references (A implements B, B references A) are legit.
import { index, pgTable, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { projects } from "./projects";

export const traceabilityLinks = pgTable(
  "traceability_links",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    sourceId: uuid("source_id").notNull(),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id").notNull(),
    relationshipType: varchar("relationship_type", { length: 64 }).notNull(),
    ...timestampColumns(),
  },
  (table) => [
    // Exact duplicates are impossible at the storage level; the domain
    // maps the violation to a friendly error. Directed: A→B and B→A with
    // the same relationship are DISTINCT links.
    uniqueIndex("traceability_links_unique").on(
      table.projectId,
      table.sourceType,
      table.sourceId,
      table.targetType,
      table.targetId,
      table.relationshipType,
    ),
    index("traceability_links_source_idx").on(table.projectId, table.sourceType, table.sourceId),
    index("traceability_links_target_idx").on(table.projectId, table.targetType, table.targetId),
  ],
);
