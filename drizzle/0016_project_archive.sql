-- TASK-130: Project archive marker (docs/database-schema.md §63, D-A07/08/09).
-- `archived_at` is the read-only marker, separate from the `deleted_at`
-- soft-delete marker: archived projects stay visible in reads but reject
-- updates until restored. Idempotent like 0003-0011. No cleanup job ships
-- with this migration — retention rows are kept (deferrable per TASK-130).
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_archived_at_idx" ON "projects" ("archived_at");
