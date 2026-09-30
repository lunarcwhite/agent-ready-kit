-- TASK-022: Decision dependency graph (docs/database-schema.md §17).
-- One row per deterministic rule (source_key value → effect on target_key).
-- Idempotent (IF NOT EXISTS) like 0003/0004.
CREATE TYPE "decision_dependency_effect" AS ENUM('ACTIVATE', 'REQUIRE', 'INVALIDATE', 'MARK_NOT_APPLICABLE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "source_decision_key" varchar(128) NOT NULL,
  "target_decision_key" varchar(128) NOT NULL,
  "condition" jsonb,
  "effect" "decision_dependency_effect" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_dependencies_project_id_idx" ON "decision_dependencies" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_dependencies_source_idx" ON "decision_dependencies" ("project_id","source_decision_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_dependencies_target_idx" ON "decision_dependencies" ("project_id","target_decision_key");
