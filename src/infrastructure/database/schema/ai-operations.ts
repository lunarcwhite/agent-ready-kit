// AI operation ledger tables (TASK-043, database-schema.md §52–§55).
//
// Observability, not canonical state: every AI invocation records who ran
// what, on which project and state version, with which prompt version, at
// what cost and latency, and how it failed. Bulky payloads live in
// ai_operation_payloads (retention-trimmable) so the ledger stays lean.
// Writes here never bump the project state version.
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { projects } from "./projects";
import { users } from "./auth";

export const aiOperationStatus = pgEnum("ai_operation_status", [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const aiOperations = pgTable(
  "ai_operations",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id").references(() => projects.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    operationType: varchar("operation_type", { length: 64 }).notNull(),
    capability: varchar("capability", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    promptKey: varchar("prompt_key", { length: 128 }),
    promptVersion: varchar("prompt_version", { length: 16 }),
    projectStateVersion: integer("project_state_version"),
    status: aiOperationStatus("status").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCost: numeric("estimated_cost"),
    latencyMs: integer("latency_ms"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    index("ai_operations_project_id_idx").on(table.projectId),
    index("ai_operations_user_id_idx").on(table.userId),
  ],
);

export const aiOperationPayloads = pgTable("ai_operation_payloads", {
  ...uuidPrimaryKey(),
  aiOperationId: uuid("ai_operation_id")
    .notNull()
    .references(() => aiOperations.id),
  inputPayload: jsonb("input_payload"),
  outputPayload: jsonb("output_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
