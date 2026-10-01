-- TASK-132: Proposed-change lifecycle (docs/database-schema.md §35).
-- AI-generated modifications awaiting review, with the canonical clock
-- (base_state_version) that makes stale proposals detectable when project
-- state moves on. MVP targets specification sections; the polymorphic
-- (target_type, target_id) shape reserves room for future targets.
-- Idempotent like previous migrations.
CREATE TYPE "proposal_target_type" AS ENUM('SPECIFICATION_SECTION');--> statement-breakpoint
CREATE TYPE "proposal_change_type" AS ENUM('UPDATE_CONTENT');--> statement-breakpoint
CREATE TYPE "proposal_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposed_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "target_type" "proposal_target_type" NOT NULL,
  "target_id" uuid NOT NULL,
  "change_type" "proposal_change_type" NOT NULL,
  "previous_content" jsonb,
  "proposed_content" jsonb NOT NULL,
  "reason" text,
  "base_state_version" integer NOT NULL,
  "status" "proposal_status" NOT NULL DEFAULT 'PENDING',
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposed_changes_project_id_idx" ON "proposed_changes" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposed_changes_project_id_status_idx" ON "proposed_changes" ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposed_changes_target_idx" ON "proposed_changes" ("target_type","target_id");
