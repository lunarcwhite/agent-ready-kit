import { timestamp, uuid } from "drizzle-orm/pg-core";

// Table conventions per docs/database-schema.md §2.
// Spread these into every pgTable so PK, timestamp, and soft-delete
// shapes stay uniform across domain tables (TASK-011 onwards).
export function uuidPrimaryKey() {
  return {
    id: uuid("id").primaryKey().defaultRandom(),
  };
}

export function timestampColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // $onUpdate is application-level (no DDL change, no migration): Drizzle
    // stamps updated_at on every UPDATE so "last updated" in TASK-012's
    // project list reflects real edits, not creation time.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  };
}
