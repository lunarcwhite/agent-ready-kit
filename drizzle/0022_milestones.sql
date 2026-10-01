-- TASK-091: Milestone domain model (docs/database-schema.md §46).
-- `milestones` groups ordered user tasks per project with stable MS-*
-- codes (atomic counter, never reused). user_tasks.milestone_id replaces
-- the TASK-090 free-text milestone label: membership is a same-project FK,
-- so moves are validated links that keep stable UTASK codes.
-- Terminal milestone rows stay queryable so history remains auditable.
-- Idempotent like previous migrations.
CREATE TYPE "milestone_status" AS ENUM('PLANNED', 'ACTIVE', 'COMPLETED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "milestone_code" varchar(16) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "status" "milestone_status" NOT NULL DEFAULT 'PLANNED',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "milestones_project_id_milestone_code_unique" ON "milestones" ("project_id","milestone_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "milestones_project_id_status_idx" ON "milestones" ("project_id","status");--> statement-breakpoint
ALTER TABLE "user_tasks" ADD COLUMN IF NOT EXISTS "milestone_id" uuid REFERENCES "milestones" ("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tasks_milestone_id_idx" ON "user_tasks" ("milestone_id");--> statement-breakpoint
ALTER TABLE "user_tasks" DROP COLUMN IF EXISTS "milestone";
