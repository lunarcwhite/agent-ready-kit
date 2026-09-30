-- TASK-064: Domain entity model (docs/database-schema.md §26-28).
-- Stable ENT-* codes (atomic counter, never reused); attributes describe
-- fields of one entity; relationships link two same-project entities.
-- Supersede chains via status + metadata instead of a history table.
-- Idempotent like 0012-0018.
CREATE TYPE "entity_status" AS ENUM('DRAFT', 'CONFIRMED', 'DEFERRED', 'SUPERSEDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "entity_relationship_type" AS ENUM('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "entity_code" varchar(16) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "ownership_model" jsonb,
  "lifecycle" jsonb,
  "status" "entity_status" NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domain_entities_project_id_entity_code_unique" ON "domain_entities" ("project_id","entity_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_entities_project_id_idx" ON "domain_entities" ("project_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_attributes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_id" uuid NOT NULL REFERENCES "domain_entities" ("id"),
  "name" varchar(255) NOT NULL,
  "data_type" varchar(64) NOT NULL,
  "required" boolean NOT NULL DEFAULT false,
  "unique_value" boolean NOT NULL DEFAULT false,
  "default_value" jsonb,
  "constraints" jsonb,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_attributes_entity_id_name_unique" ON "entity_attributes" ("entity_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_attributes_entity_id_idx" ON "entity_attributes" ("entity_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "source_entity_id" uuid NOT NULL REFERENCES "domain_entities" ("id"),
  "target_entity_id" uuid NOT NULL REFERENCES "domain_entities" ("id"),
  "relationship_type" "entity_relationship_type" NOT NULL,
  "name" varchar(255),
  "description" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_relationships_project_id_idx" ON "entity_relationships" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_relationships_source_idx" ON "entity_relationships" ("source_entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_relationships_target_idx" ON "entity_relationships" ("target_entity_id");
