-- TASK-107: Export history ledger (Agent Kit packages per project).
-- Append-only: which target was exported, from which project state
-- version, with how many files. Recording never mutates canonical state
-- (no version bump), so staleness stays a live comparison.
-- Idempotent like previous migrations.
CREATE TABLE IF NOT EXISTS "export_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "target" varchar(32) NOT NULL,
  "source_state_version" integer NOT NULL,
  "artifact_count" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_history_project_id_created_at_idx" ON "export_history" ("project_id","created_at");
