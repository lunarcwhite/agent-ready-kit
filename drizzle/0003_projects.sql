-- TASK-011: Project aggregate (docs/database-schema.md §5/§7/§60, FR-001).
-- `projects` is the aggregate root (owner + lifecycle + state version +
-- soft-delete marker). `project_inputs` preserves the original idea capture
-- separately from normalized knowledge. `project_settings` holds the D-A05
-- canonical preferences (preferred_language default "en", preferred_stack).
--> statement-breakpoint
CREATE TYPE "project_lifecycle_state" AS ENUM('DISCOVERY', 'DRAFT', 'NEEDS_REVIEW', 'IMPLEMENTATION_READY');
--> statement-breakpoint
CREATE TYPE "project_discovery_level" AS ENUM('INITIAL', 'QUICK_DRAFT', 'DETAILED', 'AGENT_READY');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "name" varchar(255) NOT NULL,
  "slug" varchar(255) NOT NULL,
  "description" text,
  "lifecycle_state" "project_lifecycle_state" NOT NULL DEFAULT 'DISCOVERY',
  "discovery_level" "project_discovery_level" NOT NULL DEFAULT 'INITIAL',
  "readiness_score" integer NOT NULL DEFAULT 0,
  "state_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "idea" text NOT NULL,
  "target_users" text,
  "constraints" text,
  "references" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_inputs_project_id_idx" ON "project_inputs" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_settings_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
