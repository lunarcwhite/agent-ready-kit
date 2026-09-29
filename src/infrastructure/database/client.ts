import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { toDatabaseError } from "./errors";

export interface DatabaseConnection {
  db: NodePgDatabase;
  pool: Pool;
  close: () => Promise<void>;
}

// Establishes a pooled connection and probes it once so misconfiguration
// surfaces here — as a redacted DatabaseError — instead of at first query.
export async function createDatabaseConnection(url: string): Promise<DatabaseConnection> {
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool);
  try {
    await pool.query("SELECT 1");
  } catch (cause) {
    await pool.end().catch(() => undefined);
    throw toDatabaseError("connection", cause);
  }
  return { db, pool, close: () => pool.end() };
}
