-- TASK-030: Discovery Map persistence (docs/database-schema.md §10, architecture.md §9).
-- `discovery_nodes` holds one row per (project, node_key); `discovery_node_decisions`
-- is the explicit node↔decision association (queryable both ways, never hidden
-- inside metadata jsonb). Idempotent (IF NOT EXISTS) like 0003-0007.
CREATE TYPE "discovery_status" AS ENUM('UNKNOWN', 'PARTIAL', 'RESOLVED', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "discovery_impact" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovery_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "node_key" varchar(64) NOT NULL,
  "category" varchar(32) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "status" "discovery_status" NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "impact" "discovery_impact",
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_nodes_project_id_node_key_unique" ON "discovery_nodes" ("project_id","node_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_nodes_project_id_idx" ON "discovery_nodes" ("project_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovery_node_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "discovery_nodes" ("id"),
  "decision_id" uuid NOT NULL REFERENCES "decisions" ("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_node_decisions_unique" ON "discovery_node_decisions" ("node_id","decision_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_node_decisions_node_idx" ON "discovery_node_decisions" ("node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_node_decisions_decision_idx" ON "discovery_node_decisions" ("decision_id");
