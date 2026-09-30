-- TASK-043: AI operation ledger (docs/database-schema.md §52-§55).
-- Observability rows: who ran what, on which project/state version, with
-- which prompt version, at what cost/latency, and how it failed. Payloads
-- split out for future retention trimming. Idempotent like 0003-0009.
CREATE TYPE "ai_operation_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid REFERENCES "projects" ("id"),
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "operation_type" varchar(64) NOT NULL,
  "capability" varchar(64) NOT NULL,
  "provider" varchar(32) NOT NULL,
  "model" varchar(128) NOT NULL,
  "prompt_key" varchar(128),
  "prompt_version" varchar(16),
  "project_state_version" integer,
  "status" "ai_operation_status" NOT NULL,
  "input_tokens" integer,
  "output_tokens" integer,
  "estimated_cost" numeric,
  "latency_ms" integer,
  "error_code" varchar(64),
  "error_message" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_operations_project_id_idx" ON "ai_operations" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_operations_user_id_idx" ON "ai_operations" ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_operation_payloads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ai_operation_id" uuid NOT NULL REFERENCES "ai_operations" ("id"),
  "input_payload" jsonb,
  "output_payload" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
