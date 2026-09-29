import type { Pool, PoolClient } from "pg";

// Test isolation strategy: each test runs inside a transaction that is
// always rolled back, so tests never need cleanup and cannot pollute each
// other — regardless of which domain tables exist yet.
export async function withRolledBackTransaction(
  pool: Pool,
  fn: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

// Integration tests require a live database. They skip — not fail — when
// neither TEST_DATABASE_URL nor DATABASE_URL is set, so unit-only CI stays
// green while db-backed environments exercise the real pipeline.
export function getIntegrationDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.TEST_DATABASE_URL ?? env.DATABASE_URL;
}
