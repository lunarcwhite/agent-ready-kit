-- TASK-074: Assumption domain model (docs/database-schema.md §36-38).
-- `assumptions` are first-class project objects with stable ASM-* codes
-- (atomic counter, never reused); `assumption_impacts` links assumptions to
-- affected artifacts (polymorphic refs validated in domain, §67).
-- Terminal rows stay queryable so history remains auditable.
-- Idempotent like previous migrations.
CREATE TYPE "assumption_status" AS ENUM('OPEN', 'CONFIRMED', 'REPLACED', 'DEFERRED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "assumption_impact" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "assumption_confidence" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "assumption_source" AS ENUM('USER_IMPLIED', 'AI_ASSUMED', 'AI_RECOMMENDED', 'SYSTEM_DERIVED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assumptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "assumption_code" varchar(16) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "impact" "assumption_impact" NOT NULL,
  "confidence" "assumption_confidence" NOT NULL,
  "source" "assumption_source" NOT NULL,
  "status" "assumption_status" NOT NULL DEFAULT 'OPEN',
  "resolution" text,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assumptions_project_id_assumption_code_unique" ON "assumptions" ("project_id","assumption_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assumptions_project_id_status_idx" ON "assumptions" ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assumptions_project_id_impact_idx" ON "assumptions" ("project_id","impact");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assumption_impacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "assumption_id" uuid NOT NULL REFERENCES "assumptions" ("id"),
  "target_type" varchar(32) NOT NULL,
  "target_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assumption_impacts_assumption_id_idx" ON "assumption_impacts" ("assumption_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assumption_impacts_target_idx" ON "assumption_impacts" ("target_type","target_id");
