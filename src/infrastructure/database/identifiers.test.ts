import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IdentifierError } from "../../shared/identifiers";
import { allocateStableId } from "./identifiers";
import { getIntegrationDatabaseUrl, withRolledBackTransaction } from "./test-utils";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";

// Live-database coverage: atomic per-project sequences, namespace isolation,
// and rejection of malformed requests before any row is written.
// Skipped (not failed) without a URL, same as infrastructure.test.ts.
const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("stable identifier allocation (integration)", () => {
  it("allocates monotonic per-project sequences", async () => {
    const pool = new PgPool({ connectionString: url as string });
    try {
      await withRolledBackTransaction(pool as unknown as Pool, async (client) => {
        const projectId = randomUUID();
        expect(await allocateStableId(client, projectId, "FR")).toBe("FR-001");
        expect(await allocateStableId(client, projectId, "FR")).toBe("FR-002");
        expect(await allocateStableId(client, projectId, "DEC", "AUTH")).toBe("DEC-AUTH-001");
        expect(await allocateStableId(client, projectId, "DEC", "AUTH")).toBe("DEC-AUTH-002");
        expect(await allocateStableId(client, projectId, "DEC", "USER")).toBe("DEC-USER-001");
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates namespaces between projects", async () => {
    const pool = new PgPool({ connectionString: url as string });
    try {
      await withRolledBackTransaction(pool as unknown as Pool, async (client) => {
        expect(await allocateStableId(client, randomUUID(), "TASK")).toBe("TASK-001");
        expect(await allocateStableId(client, randomUUID(), "TASK")).toBe("TASK-001");
      });
    } finally {
      await pool.end();
    }
  });

  it("never hands out the same sequence twice under concurrency", async () => {
    const pool = new PgPool({ connectionString: url as string });
    try {
      const projectId = randomUUID();
      const codes = await Promise.all(
        Array.from({ length: 10 }, () =>
          allocateStableId(pool as unknown as Pool, projectId, "ENT"),
        ),
      );
      expect(new Set(codes).size).toBe(10);
      const sequences = codes.map((code) => Number(code.split("-")[1])).sort((a, b) => a - b);
      expect(sequences[0]).toBe(1);
      expect(sequences[9]).toBe(10);
      await pool.query("DELETE FROM project_counters WHERE project_id = $1", [projectId]);
    } finally {
      await pool.end();
    }
  });

  it("rejects malformed requests without advancing the counter", async () => {
    const pool = new PgPool({ connectionString: url as string });
    try {
      await withRolledBackTransaction(pool as unknown as Pool, async (client) => {
        const projectId = randomUUID();
        await expect(allocateStableId(client, projectId, "DEC")).rejects.toBeInstanceOf(
          IdentifierError,
        );
        // Counter untouched: the next valid allocation still starts at 1.
        expect(await allocateStableId(client, projectId, "FR")).toBe("FR-001");
      });
    } finally {
      await pool.end();
    }
  });
});
