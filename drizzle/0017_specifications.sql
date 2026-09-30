-- TASK-060: Specification domain model (docs/database-schema.md §29-33).
-- Derived artifacts: documents (one logical doc per project+type),
-- independently manageable sections, and immutable version snapshots bound
-- to a project state version. Idempotent like previous migrations.
CREATE TYPE "specification_document_type" AS ENUM('PRD', 'ARCHITECTURE', 'DATABASE_SCHEMA', 'DESIGN', 'PRODUCT_AGENTS', 'SOUL', 'TASKS', 'CONTEXT', 'AGENT_INSTRUCTIONS');--> statement-breakpoint
CREATE TYPE "specification_document_status" AS ENUM('DRAFT', 'CURRENT', 'STALE', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE TYPE "specification_section_status" AS ENUM('CURRENT', 'STALE', 'PROPOSED', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "specification_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "document_type" "specification_document_type" NOT NULL,
  "title" varchar(255) NOT NULL,
  "status" "specification_document_status" NOT NULL DEFAULT 'DRAFT',
  "current_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "specification_documents_project_id_type_unique" ON "specification_documents" ("project_id","document_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "specification_documents_project_id_idx" ON "specification_documents" ("project_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "specification_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "specification_documents" ("id"),
  "section_key" varchar(128) NOT NULL,
  "title" varchar(255) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "structured_content" jsonb,
  "rendered_content" text NOT NULL DEFAULT '',
  "status" "specification_section_status" NOT NULL DEFAULT 'CURRENT',
  "dependency_hash" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "specification_sections_document_id_key_unique" ON "specification_sections" ("document_id","section_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "specification_sections_document_id_idx" ON "specification_sections" ("document_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "specification_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "specification_documents" ("id"),
  "version" integer NOT NULL,
  "content" text NOT NULL,
  "project_state_version" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "specification_versions_document_id_version_unique" ON "specification_versions" ("document_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "specification_versions_document_id_idx" ON "specification_versions" ("document_id");
