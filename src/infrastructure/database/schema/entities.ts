// Domain entity records (TASK-064, database-schema.md §26–§28).
//
// Stable implementation-relevant entities stored independently from
// generated database-schema prose (compiled later in TASK-064). Codes
// (ENT-001…) come from the atomic per-project counter, never from an LLM,
// and are never reused — not after supersede, not after removal (§68–§69).
//
// Domain ≠ persistence (agents.md §23): a Product Entity such as
// Subscription exists before physical tables are generated; the data
// compiler performs that translation explicitly into PROPOSED sections.
//
// Versioning story: deliberately NO history table. A replaced row freezes
// as SUPERSEDED in place and its successor carries metadata.supersedes;
// the old row is the audit trail. SUPERSEDED is server-managed (only
// supersedeEntity writes it); REMOVED marks withdrawal without deleting
// the row (only removeEntity writes it). Rows are never hard-deleted.
//
// entity_attributes describe fields of one entity; entity_relationships
// link two same-project entities with an explicit ONE_TO_ONE /
// ONE_TO_MANY / MANY_TO_MANY type. Attributes and relationships are
// canonical state (they bump the project version with the entity write
// path) — the compiler only reads them.
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { projects } from "./projects";

export const entityStatus = pgEnum("entity_status", [
  "DRAFT",
  "CONFIRMED",
  "DEFERRED",
  "SUPERSEDED",
  "REMOVED",
]);

export const entityRelationshipType = pgEnum("entity_relationship_type", [
  "ONE_TO_ONE",
  "ONE_TO_MANY",
  "MANY_TO_MANY",
]);

export const domainEntities = pgTable(
  "domain_entities",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    entityCode: varchar("entity_code", { length: 16 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    ownershipModel: jsonb("ownership_model"),
    lifecycle: jsonb("lifecycle"),
    status: entityStatus("status").notNull(),
    metadata: jsonb("metadata"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("domain_entities_project_id_entity_code_unique").on(
      table.projectId,
      table.entityCode,
    ),
    index("domain_entities_project_id_idx").on(table.projectId),
  ],
);

export const entityAttributes = pgTable(
  "entity_attributes",
  {
    ...uuidPrimaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => domainEntities.id),
    name: varchar("name", { length: 255 }).notNull(),
    dataType: varchar("data_type", { length: 64 }).notNull(),
    required: boolean("required").notNull().default(false),
    uniqueValue: boolean("unique_value").notNull().default(false),
    defaultValue: jsonb("default_value"),
    constraints: jsonb("constraints"),
    description: text("description"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("entity_attributes_entity_id_name_unique").on(table.entityId, table.name),
    index("entity_attributes_entity_id_idx").on(table.entityId),
  ],
);

export const entityRelationships = pgTable(
  "entity_relationships",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => domainEntities.id),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => domainEntities.id),
    relationshipType: entityRelationshipType("relationship_type").notNull(),
    name: varchar("name", { length: 255 }),
    description: text("description"),
    metadata: jsonb("metadata"),
    ...timestampColumns(),
  },
  (table) => [
    index("entity_relationships_project_id_idx").on(table.projectId),
    index("entity_relationships_source_idx").on(table.sourceEntityId),
    index("entity_relationships_target_idx").on(table.targetEntityId),
  ],
);
