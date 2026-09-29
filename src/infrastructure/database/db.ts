import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type AppDatabase = NodePgDatabase<typeof schema>;

// Application-wide database handle for server runtime (route handlers,
// server actions, Auth.js). Pool construction is lazy — no connection is
// opened here — so importing this module never throws and never leaks the
// URL; query failures surface through each caller's error boundary.
// Cached on globalThis so Next.js dev hot-reloads don't exhaust the pool.
// Scripts and tests keep using createDatabaseConnection() (client.ts),
// which probes eagerly and redacts failures as DatabaseError.
export function getDb(): AppDatabase {
  const globalForDb = globalThis as unknown as { __arkDb?: AppDatabase };
  if (!globalForDb.__arkDb) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "", max: 10 });
    globalForDb.__arkDb = drizzle(pool, { schema });
  }
  return globalForDb.__arkDb;
}
