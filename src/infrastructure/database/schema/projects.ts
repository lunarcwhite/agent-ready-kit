// Project aggregate tables (TASK-011, database-schema.md §5/§7/§60, FR-001).
//
// `projects` is the aggregate root: one row per user-owned project. Reads in
// the domain service always scope to (id, user_id) plus deleted_at IS NULL,
// so cross-user access is impossible at the query level (centralized policy
// lands in TASK-014). `deleted_at` exists now so rows are born soft-deletable;
// delete/archive behavior itself belongs to TASK-130.
//
// `project_inputs` preserves the original idea-capture separately from
// normalized knowledge (which lands in M5). `project_settings` holds free-form
// preferences per D-A05 (preferred_language default "en", preferred_stack) —
// the removed projects.preferred_language / project_inputs.preferred_stack
// columns live here now, not as columns.
//
// Canonical state columns (lifecycle_state, discovery_level, readiness_score,
// state_version) are persisted here but owned elsewhere: lifecycle/discovery
// transitions belong to TASK-020, readiness to the readiness engine. The
// TASK-011 service writes defaults on create and refuses to change them.
//
// `slug` is cosmetic for MVP (human-friendly URLs later): NOT NULL but not
// unique — lookup is always by id, so duplicate slugs across same-name
// projects are harmless. No per-owner uniqueness constraint (YAGNI).
//
// project_counters keeps its unconstrained project_id (no FK to projects.id):
// enforcing one now would reject stable-ID allocation for ad-hoc namespaces
// and couple identifier tests to project rows. Revisit with delete-cascade
// rules in TASK-130.
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
import { users } from "./auth";

export const projectLifecycleState = pgEnum("project_lifecycle_state", [
  "DISCOVERY",
  "DRAFT",
  "NEEDS_REVIEW",
  "IMPLEMENTATION_READY",
]);

export const projectDiscoveryLevel = pgEnum("project_discovery_level", [
  "INITIAL",
  "QUICK_DRAFT",
  "DETAILED",
  "AGENT_READY",
]);

export const projects = pgTable(
  "projects",
  {
    ...uuidPrimaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    lifecycleState: projectLifecycleState("lifecycle_state").notNull().default("DISCOVERY"),
    discoveryLevel: projectDiscoveryLevel("discovery_level").notNull().default("INITIAL"),
    readinessScore: integer("readiness_score").notNull().default(0),
    stateVersion: integer("state_version").notNull().default(1),
    ...timestampColumns(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("projects_user_id_idx").on(table.userId)],
);

export const projectInputs = pgTable(
  "project_inputs",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    idea: text("idea").notNull(),
    targetUsers: text("target_users"),
    constraints: text("constraints"),
    references: jsonb("references"),
    ...timestampColumns(),
  },
  (table) => [index("project_inputs_project_id_idx").on(table.projectId)],
);

export const projectSettings = pgTable(
  "project_settings",
  {
    ...uuidPrimaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    settings: jsonb("settings").notNull().default({}),
    ...timestampColumns(),
  },
  (table) => [uniqueIndex("project_settings_project_id_unique").on(table.projectId)],
);
