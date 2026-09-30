-- TASK-070: Validation issue domain model (docs/database-schema.md §39-43).
-- `validation_issues` stores Validation Engine findings with stable ISSUE-*
-- codes (atomic counter, never reused); `issue_references` links issues to
-- source/affected artifacts (polymorphic refs validated in domain, §67).
-- Resolved/ignored rows stay queryable so history remains auditable.
-- Idempotent like 0003-0011.
CREATE TYPE "issue_type" AS ENUM('COMPLETENESS', 'CONSISTENCY', 'DEPENDENCY', 'IMPLEMENTATION_COVERAGE', 'ASSUMPTION', 'ORPHAN', 'SECURITY');--> statement-breakpoint
CREATE TYPE "issue_severity" AS ENUM('BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO');--> statement-breakpoint
CREATE TYPE "issue_status" AS ENUM('OPEN', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "issue_relationship" AS ENUM('SOURCE', 'AFFECTED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "validation_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects" ("id"),
  "issue_code" varchar(16) NOT NULL,
  "type" "issue_type" NOT NULL,
  "severity" "issue_severity" NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "status" "issue_status" NOT NULL DEFAULT 'OPEN',
  "metadata" jsonb,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "validation_issues_project_id_issue_code_unique" ON "validation_issues" ("project_id","issue_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_issues_project_id_status_idx" ON "validation_issues" ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_issues_project_id_severity_idx" ON "validation_issues" ("project_id","severity");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "issue_id" uuid NOT NULL REFERENCES "validation_issues" ("id"),
  "reference_type" varchar(32) NOT NULL,
  "reference_id" uuid NOT NULL,
  "relationship" "issue_relationship" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_references_issue_id_idx" ON "issue_references" ("issue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_references_reference_idx" ON "issue_references" ("reference_type","reference_id");
