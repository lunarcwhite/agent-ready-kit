// Discovery Map tables (TASK-030, database-schema.md §10, architecture.md §9).
//
// `discovery_nodes` is canonical structured state: one row per
// (project, node_key) holding the UNKNOWN → PARTIAL → RESOLVED lifecycle
// (or NOT_APPLICABLE for out-of-scope branches). `node_key` values for the
// nine seeded domains are fixed slugs owned by the domain layer — never by
// an LLM.
//
// `discovery_node_decisions` is the explicit node↔decision association
// TASK-030 requires ("relevant decisions can be associated"). It is a join
// table rather than a metadata array so links stay queryable both ways and
// cross-project links are unrepresentable (both ends resolve inside one
// project scope). Like traceability links (TASK-024) these rows are
// bookkeeping: linking never bumps the project state version.
//
// Level calculation (TASK-031), prioritization (TASK-032), and conversation
// persistence (TASK-033) build on this model; they do not live here.
//
// Conversation tables (TASK-033, database-schema.md §8–§9) store raw
// evidence: sessions group a run of questions/answers, messages carry the
// text plus validated metadata (topic node, AI operation ref, interpretation
// link). History is evidence, never canonical state — writes here never bump
// the project state version.
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
import { timestampColumns, uuidPrimaryKey } from "./helpers";
import { decisions } from "./decisions";
import { projects } from "./projects";

export const discoveryStatus = pgEnum("discovery_status", [
  "UNKNOWN",
  "PARTIAL",
  "RESOLVED",
  "NOT_APPLICABLE",
]);

// Priority weight for future topic ordering (TASK-032) — mirrors the
// decision impact scale, kept as its own enum so discovery stays
// independent of the decisions module.
export const discoveryImpact = pgEnum("discovery_impact", ["HIGH", "MEDIUM", "LOW"]);

export const discoveryNodes = pgTable(
  "discovery_nodes",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    nodeKey: varchar("node_key", { length: 64 }).notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    status: discoveryStatus("status").notNull(),
    priority: integer("priority").notNull().default(0),
    impact: discoveryImpact("impact"),
    metadata: jsonb("metadata"),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("discovery_nodes_project_id_node_key_unique").on(table.projectId, table.nodeKey),
    index("discovery_nodes_project_id_idx").on(table.projectId),
  ],
);

export const discoveryNodeDecisions = pgTable(
  "discovery_node_decisions",
  {
    ...uuidPrimaryKey(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => discoveryNodes.id),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => decisions.id),
    // Append-only like decision_history: links are added or removed, never
    // updated, so there is no updated_at.
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discovery_node_decisions_unique").on(table.nodeId, table.decisionId),
    index("discovery_node_decisions_node_idx").on(table.nodeId),
    index("discovery_node_decisions_decision_idx").on(table.decisionId),
  ],
);

export const discoverySessionStatus = pgEnum("discovery_session_status", [
  "ACTIVE",
  "COMPLETED",
  "ABANDONED",
]);

export const discoverySessions = pgTable(
  "discovery_sessions",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    status: discoverySessionStatus("status").notNull().default("ACTIVE"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [index("discovery_sessions_project_id_idx").on(table.projectId)],
);

export const discoveryMessageRole = pgEnum("discovery_message_role", [
  "USER",
  "ASSISTANT",
  "SYSTEM",
]);

export const discoveryMessages = pgTable(
  "discovery_messages",
  {
    ...uuidPrimaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => discoverySessions.id),
    role: discoveryMessageRole("role").notNull(),
    content: text("content").notNull(),
    sequenceNumber: integer("sequence_number").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discovery_messages_session_id_sequence_number_unique").on(
      table.sessionId,
      table.sequenceNumber,
    ),
    index("discovery_messages_session_id_idx").on(table.sessionId),
  ],
);
