// Background job persistence tables (TASK-131, spec-decisions.md D-A07/08/09).
//
// SPEC GAP (documented, not resolved silently): docs/database-schema.md
// defines NO jobs table — its §81 deferred list does not include one — so
// TASK-131 itself is the column authority. This table follows the shape the
// task mandates: status lifecycle, ai_operations link, bounded retry budget,
// and a scoped idempotency key.
//
// Operational, not canonical: like the ai_operations ledger (which never
// bumps the project state version), rows here observe and schedule work —
// they never carry approved product decisions. Job writes therefore never
// bump the project state version, and job rows are never a source of truth
// for decisions, requirements, knowledge, or specifications.
//
// Scoping: every row carries user_id (the cross-user isolation gate, always
// enforced at query level). project_id is nullable because some jobs are
// user-level (no project gate, unlike project-owned domain tables).
// ai_operation_id links long-running AI work to its ledger row.
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { aiOperations } from "./ai-operations";
import { projects } from "./projects";
import { users } from "./auth";

// Lifecycle mirrors architecture §56 and the in-memory runner in
// src/infrastructure/jobs/jobs.ts: PENDING → RUNNING → SUCCEEDED | FAILED.
export const jobStatus = pgEnum("job_status", ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    ...uuidPrimaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    projectId: uuid("project_id").references(() => projects.id),
    aiOperationId: uuid("ai_operation_id").references(() => aiOperations.id),
    kind: varchar("kind", { length: 64 }).notNull(),
    status: jobStatus("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    payload: jsonb("payload"),
    result: jsonb("result"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    // One logical job per (user, key): NULL keys are unrestricted, so the
    // partial predicate makes the intent explicit at the DDL level.
    uniqueIndex("background_jobs_user_id_idempotency_key_unique")
      .on(table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("background_jobs_user_id_status_idx").on(table.userId, table.status),
    index("background_jobs_project_id_idx").on(table.projectId),
  ],
);
