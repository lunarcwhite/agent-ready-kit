// Identity tables (TASK-010, database-schema.md §4).
//
// `users` stays the canonical SaaS user record: uuid PK, unique email,
// display name, avatar. Two nullable auth-owned columns ride along instead
// of a separate table (YAGNI for MVP): `email_verified` (set by OAuth
// account linking) and `password_hash` (Email+password; null for OAuth-only
// users). Both are nullable and non-canonical — domain logic must never
// treat them as product decisions.
// `accounts` is the external-identity mapping the schema anticipates
// ("handled separately"): one row per linked OAuth account, owned by
// Auth.js through the Drizzle adapter.
//
// Adapter contract: the Drizzle adapter addresses columns by their
// JavaScript property names, so `users` keeps the adapter's property names
// (id/name/email/emailVerified/image) while column names follow repository
// snake_case conventions — image ↔ avatar_url. On `accounts`, the OAuth
// token fields keep the adapter's snake_case property names
// (refresh_token, …) because linkAccount() inserts adapter-keyed objects;
// userId/type/provider/providerAccountId stay camelCase, matching both.
import { integer, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestampColumns, uuidPrimaryKey } from "./helpers";

export const users = pgTable("users", {
  ...uuidPrimaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  image: text("avatar_url"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  passwordHash: text("password_hash"),
  ...timestampColumns(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    // Lookup direction is provider → user, but per-user cleanup and
    // future authorization joins need the reverse.
  ],
);
