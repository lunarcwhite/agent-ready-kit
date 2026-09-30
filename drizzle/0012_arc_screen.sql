-- TASK-059: Architecture component + screen models (docs/database-schema.md §45-§45a).
-- Stable ARC-*/SCREEN-* codes (atomic counter, never reused); supersede chains via
-- status + metadata instead of a history table. Idempotent like 0003-0011.
CREATE TYPE "architecture_status" AS ENUM('DRAFT', 'CONFIRMED', 'DEFERRED', 'SUPERSEDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "screen_status" AS ENUM('DRAFT', 'CONFIRMED', 'DEFERRED', 'SUPERSEDED', 'REMOVED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "architecture_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "component_code" varchar(16) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "status" "architecture_status" NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "architecture_components_project_id_component_code_unique" ON "architecture_components" ("project_id","component_code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "screen_code" varchar(16) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "route_hint" varchar(255),
  "status" "screen_status" NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "screens_project_id_screen_code_unique" ON "screens" ("project_id","screen_code");
