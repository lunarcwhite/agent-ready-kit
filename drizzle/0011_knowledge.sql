-- TASK-055: Knowledge domain model (docs/database-schema.md §18-21, FR-030-032).
-- `knowledge_items` holds normalized canonical understanding (unique per
-- project+key, canonical §19 domains); `knowledge_sources` keeps provenance
-- answering "why do we believe this?". Idempotent like 0003-0010.
CREATE TYPE "knowledge_domain" AS ENUM('PRODUCT', 'USER', 'FEATURE', 'BUSINESS_RULE', 'ACCESS', 'DATA', 'UX', 'TECHNICAL', 'INTEGRATION', 'AI', 'NON_FUNCTIONAL');--> statement-breakpoint
CREATE TYPE "knowledge_status" AS ENUM('CURRENT', 'STALE', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "knowledge_confidence" AS ENUM('EXPLICIT', 'INFERRED', 'ASSUMED');--> statement-breakpoint
CREATE TYPE "knowledge_source_type" AS ENUM('DECISION', 'USER_MESSAGE', 'PROJECT_INPUT', 'AI_INFERENCE', 'REQUIREMENT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "knowledge_key" varchar(128) NOT NULL,
  "domain" "knowledge_domain" NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" jsonb NOT NULL,
  "confidence" "knowledge_confidence" NOT NULL,
  "status" "knowledge_status" NOT NULL DEFAULT 'CURRENT',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_items_project_id_knowledge_key_unique" ON "knowledge_items" ("project_id","knowledge_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_items_project_id_domain_idx" ON "knowledge_items" ("project_id","domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_items_project_id_status_idx" ON "knowledge_items" ("project_id","status");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "knowledge_item_id" uuid NOT NULL REFERENCES "knowledge_items" ("id"),
  "source_type" "knowledge_source_type" NOT NULL,
  "source_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_sources_item_idx" ON "knowledge_sources" ("knowledge_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_sources_source_idx" ON "knowledge_sources" ("source_type","source_id");
