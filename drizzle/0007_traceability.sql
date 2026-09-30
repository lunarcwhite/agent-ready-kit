-- TASK-024: Traceability graph (docs/database-schema.md §44, FR-050).
-- Directed polymorphic links; exact duplicates impossible by constraint.
-- Idempotent like 0003-0006.
CREATE TABLE IF NOT EXISTS "traceability_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "source_type" varchar(32) NOT NULL,
  "source_id" uuid NOT NULL,
  "target_type" varchar(32) NOT NULL,
  "target_id" uuid NOT NULL,
  "relationship_type" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "traceability_links_unique" ON "traceability_links" ("project_id","source_type","source_id","target_type","target_id","relationship_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traceability_links_source_idx" ON "traceability_links" ("project_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traceability_links_target_idx" ON "traceability_links" ("project_id","target_type","target_id");
