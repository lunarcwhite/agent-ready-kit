-- TASK-061: Specification dependency tracking (docs/database-schema.md §34).
-- Polymorphic section→canonical links with a reverse index for staleness
-- propagation. Idempotent like previous migrations.
CREATE TYPE "section_source_type" AS ENUM('DECISION', 'KNOWLEDGE', 'REQUIREMENT', 'ENTITY');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "section_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "section_id" uuid NOT NULL REFERENCES "specification_sections" ("id"),
  "source_type" "section_source_type" NOT NULL,
  "source_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "section_dependencies_unique" ON "section_dependencies" ("section_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "section_dependencies_section_id_idx" ON "section_dependencies" ("section_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "section_dependencies_source_idx" ON "section_dependencies" ("source_type","source_id");
