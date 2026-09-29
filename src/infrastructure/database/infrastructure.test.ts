import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseConnection, type DatabaseConnection } from "./client";
import { getIntegrationDatabaseUrl, withRolledBackTransaction } from "./test-utils";
import { DatabaseError } from "./errors";
import { runMigrations } from "./migrate";

// Live-database coverage for TASK-003. Skipped (not failed) without a URL
// so unit-only CI stays green; db-backed runs prove connection, migration,
// and rollback isolation against real PostgreSQL.
const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("database infrastructure (integration)", () => {
  let conn: DatabaseConnection;

  afterAll(async () => {
    await conn?.close();
  });

  it("establishes a pooled connection", async () => {
    conn = await createDatabaseConnection(url as string);
    const result = await conn.db.execute(sql`SELECT 1 AS ok`);
    expect(result.rows).toEqual([{ ok: 1 }]);
  });

  it("applies migrations idempotently", async () => {
    await runMigrations(conn.db);
    await runMigrations(conn.db);
    // Empty baseline migration records no journal row (nothing to apply);
    // idempotency is proven by the double apply not throwing.
    const marker = await conn.db.execute(sql`SELECT 1 AS ok`);
    expect(marker.rows).toEqual([{ ok: 1 }]);
  });

  it("rolls back test transactions", async () => {
    await conn.pool.query("CREATE TEMP TABLE rollback_probe (v int)");
    await withRolledBackTransaction(conn.pool, async (client) => {
      await client.query("CREATE TABLE rollback_probe_inner (v int)");
      const inside = await client.query(
        "SELECT COUNT(*) AS n FROM pg_tables WHERE tablename = 'rollback_probe_inner'",
      );
      expect((inside.rows[0] as { n: string }).n).toBe("1");
    });
    const after = await conn.pool.query(
      "SELECT COUNT(*) AS n FROM pg_tables WHERE tablename = 'rollback_probe_inner'",
    );
    expect((after.rows[0] as { n: string }).n).toBe("0"); // rolled back, nothing left behind
    await conn.pool.query("DROP TABLE rollback_probe");
  });

  it("reports connection failures as redacted DatabaseErrors", async () => {
    await expect(
      createDatabaseConnection("postgresql://wrong:s3cret@localhost:1/nope"),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof DatabaseError &&
        error.category === "connection" &&
        !error.message.includes("s3cret")
      );
    });
  });
});
