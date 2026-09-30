-- TASK-021: Decision domain model (docs/database-schema.md §11-§16, FR-020-022).
-- `decisions` holds canonical structured state (stable DEC-* codes via
-- project_counters, never LLM-generated); `decision_history` keeps every
-- superseded snapshot append-only. Idempotent (IF NOT EXISTS) like 0003.
CREATE TYPE "decision_status" AS ENUM('UNRESOLVED', 'RECOMMENDED', 'CONFIRMED', 'DEFERRED', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "decision_impact" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "decision_source_type" AS ENUM('USER', 'AI_RECOMMENDATION', 'AI_INFERENCE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "decision_confidence" AS ENUM('EXPLICIT', 'INFERRED', 'ASSUMED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "decision_key" varchar(128) NOT NULL,
  "decision_code" varchar(32) NOT NULL,
  "category" varchar(16) NOT NULL,
  "title" varchar(255) NOT NULL,
  "value" jsonb,
  "rationale" text,
  "status" "decision_status" NOT NULL,
  "impact" "decision_impact" NOT NULL,
  "source_type" "decision_source_type" NOT NULL,
  "confidence" "decision_confidence" NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decisions_project_id_decision_key_unique" ON "decisions" ("project_id","decision_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decisions_project_id_decision_code_unique" ON "decisions" ("project_id","decision_code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "decision_id" uuid NOT NULL REFERENCES "decisions" ("id"),
  "version" integer NOT NULL,
  "value" jsonb,
  "rationale" text,
  "status" "decision_status" NOT NULL,
  "source_type" "decision_source_type" NOT NULL,
  "changed_by" uuid,
  "change_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_history_decision_id_idx" ON "decision_history" ("decision_id");
