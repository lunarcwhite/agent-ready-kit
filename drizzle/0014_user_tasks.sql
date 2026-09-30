-- TASK-090: User-project task domain model (docs/database-schema.md §47-49,
-- tasks.md §4-5, spec-decisions.md D-A10b).
-- `user_tasks` holds the user's project tasks (UTASK-001… via the atomic
-- per-project counter, never reused); `user_task_dependencies` is the
-- queryable prerequisite graph (unique pair, no self-dep, app-level cycle
-- check). Physical `user_*` names keep the bare `tasks` namespace free for a
-- future implementation-plan domain. Idempotent like 0003-0011.
CREATE TYPE "user_task_status" AS ENUM('PENDING', 'READY', 'BLOCKED', 'REVIEW_REQUIRED', 'DONE');--> statement-breakpoint
CREATE TYPE "user_task_priority" AS ENUM('P0', 'P1', 'P2');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "task_code" varchar(16) NOT NULL,
  "title" varchar(255) NOT NULL,
  "objective" text NOT NULL,
  "status" "user_task_status" NOT NULL DEFAULT 'PENDING',
  "priority" "user_task_priority" NOT NULL,
  "milestone" varchar(64),
  "implementation_notes" text,
  "acceptance_criteria" jsonb NOT NULL,
  "definition_of_done" jsonb NOT NULL,
  "references" jsonb,
  "sort_order" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_tasks_project_id_task_code_unique" ON "user_tasks" ("project_id","task_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tasks_project_id_status_idx" ON "user_tasks" ("project_id","status");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_task_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL REFERENCES "user_tasks" ("id"),
  "depends_on_task_id" uuid NOT NULL REFERENCES "user_tasks" ("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_task_dependencies_task_id_depends_on_unique" ON "user_task_dependencies" ("task_id","depends_on_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_task_dependencies_task_id_idx" ON "user_task_dependencies" ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_task_dependencies_depends_on_task_id_idx" ON "user_task_dependencies" ("depends_on_task_id");
