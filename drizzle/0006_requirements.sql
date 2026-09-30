-- TASK-023: Requirement domain model (docs/database-schema.md §22-25).
-- Stable FR-* codes (atomic counter, never reused); supersede chains via
-- status + metadata instead of a history table. Idempotent like 0003-0005.
CREATE TYPE "requirement_type" AS ENUM('FUNCTIONAL', 'NON_FUNCTIONAL', 'BUSINESS_RULE', 'CONSTRAINT');--> statement-breakpoint
CREATE TYPE "requirement_priority" AS ENUM('MUST', 'SHOULD', 'COULD', 'WONT');--> statement-breakpoint
CREATE TYPE "requirement_status" AS ENUM('DRAFT', 'CONFIRMED', 'DEFERRED', 'SUPERSEDED', 'REMOVED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "requirement_code" varchar(16) NOT NULL,
  "type" "requirement_type" NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "priority" "requirement_priority" NOT NULL,
  "status" "requirement_status" NOT NULL,
  "acceptance_criteria" jsonb,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "requirements_project_id_requirement_code_unique" ON "requirements" ("project_id","requirement_code");
