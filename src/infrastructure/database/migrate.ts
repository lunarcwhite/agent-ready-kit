import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { toDatabaseError } from "./errors";

// Applies every pending migration in ./drizzle. Safe to re-run:
// applied migrations are recorded in __drizzle_migrations and skipped.
export async function runMigrations(
  db: NodePgDatabase,
  migrationsFolder = "./drizzle",
): Promise<void> {
  try {
    await migrate(db, { migrationsFolder });
  } catch (cause) {
    throw toDatabaseError("migration", cause);
  }
}
