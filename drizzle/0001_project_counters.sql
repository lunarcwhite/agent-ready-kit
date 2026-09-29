-- TASK-004: per-project atomic counters backing deterministic stable IDs
-- (docs/database-schema.md §69-70). FK to projects.id is deferred to TASK-011:
-- the projects table does not exist yet, so project_id is unconstrained until
-- then; namespace isolation is enforced meanwhile by the unique
-- (project_id, counter_type) constraint.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_counters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "counter_type" varchar(32) NOT NULL,
  "current_value" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_counters_project_id_counter_type_unique" UNIQUE("project_id", "counter_type")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_counters_project_id_idx" ON "project_counters" ("project_id");
--> statement-breakpoint
