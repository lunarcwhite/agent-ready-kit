-- TASK-033: Discovery conversation persistence (docs/database-schema.md §8-§9).
-- `discovery_sessions` groups a run of questions/answers per project;
-- `discovery_messages` stores raw evidence (role/content/order plus validated
-- metadata for topic, AI operation ref, interpretation link). History is
-- evidence, never canonical state. Idempotent (IF NOT EXISTS) like 0008.
CREATE TYPE "discovery_session_status" AS ENUM('ACTIVE', 'COMPLETED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "discovery_message_role" AS ENUM('USER', 'ASSISTANT', 'SYSTEM');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovery_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "status" "discovery_session_status" NOT NULL DEFAULT 'ACTIVE',
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_sessions_project_id_idx" ON "discovery_sessions" ("project_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovery_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "discovery_sessions" ("id"),
  "role" "discovery_message_role" NOT NULL,
  "content" text NOT NULL,
  "sequence_number" integer NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_messages_session_id_sequence_number_unique" ON "discovery_messages" ("session_id","sequence_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_messages_session_id_idx" ON "discovery_messages" ("session_id");
