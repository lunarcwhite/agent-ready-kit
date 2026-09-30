-- TASK-131: Background job persistence (spec-decisions.md D-A07/08/09).
-- TASK-131 is the column authority here: docs/database-schema.md defines no
-- jobs table, so this migration introduces `background_jobs` directly —
-- status lifecycle, ai_operations link, bounded retry budget, and a scoped
-- idempotency key. Numbered 0015: 0012-0014 are reserved for parallel tasks.
-- Idempotent (IF NOT EXISTS) like 0003-0011.
CREATE TYPE "job_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "project_id" uuid REFERENCES "projects" ("id"),
  "ai_operation_id" uuid REFERENCES "ai_operations" ("id"),
  "kind" varchar(64) NOT NULL,
  "status" "job_status" NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "idempotency_key" varchar(128),
  "payload" jsonb,
  "result" jsonb,
  "error_code" varchar(64),
  "error_message" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "background_jobs_user_id_idempotency_key_unique" ON "background_jobs" ("user_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_user_id_status_idx" ON "background_jobs" ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_project_id_idx" ON "background_jobs" ("project_id");
