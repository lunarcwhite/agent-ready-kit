// TASK-107 acceptance: records carry source state version, target, and
// generated time; staleness is determinable live; history is
// project-scoped.
//
// Unit tests pin validation without a DB. History proofs run as
// rolled-back integration tests — skipped, not failed, without
// TEST_DATABASE_URL/DATABASE_URL.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createDecision } from "../decisions/decisions";
import { AgentKitValidationError } from "./errors";
import { getLastExport, isLastExportStale, listExports, recordExport } from "./history";

describe("export history validation (unit, no database)", () => {
  const db = {} as AppDatabase;

  it("rejects malformed calls before touching the database", async () => {
    await expect(
      recordExport(db, "  ", "p-1", { sourceStateVersion: 1, artifactCount: 3 }),
    ).rejects.toBeInstanceOf(AgentKitValidationError);
    await expect(
      recordExport(db, "u-1", "p-1", { sourceStateVersion: 0, artifactCount: 3 }),
    ).rejects.toBeInstanceOf(AgentKitValidationError);
    await expect(
      recordExport(db, "u-1", "p-1", { sourceStateVersion: 1, artifactCount: 0 }),
    ).rejects.toBeInstanceOf(AgentKitValidationError);
    await expect(
      recordExport(db, "u-1", "p-1", {
        target: "Bad Name",
        sourceStateVersion: 1,
        artifactCount: 3,
      }),
    ).rejects.toBeInstanceOf(AgentKitValidationError);
    await expect(listExports(db, "u-1", "p-1", 0)).rejects.toBeInstanceOf(AgentKitValidationError);
    await expect(isLastExportStale(db, "", "p-1")).rejects.toBeInstanceOf(AgentKitValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("export history (integration)", () => {
  it("records exports and reports live staleness under project scope", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `hist-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "H", idea: "History." });
        const pid = created.project.id;
        const version = await getStateVersion(db, owner.id, pid);

        // No export yet: stale, nothing to download.
        expect(await getLastExport(db, owner.id, pid)).toBeNull();
        const empty = await isLastExportStale(db, owner.id, pid);
        expect(empty).toMatchObject({ stale: true, lastExport: null });

        const recorded = await recordExport(db, owner.id, pid, {
          sourceStateVersion: version,
          artifactCount: 4,
        });
        expect(recorded).toMatchObject({
          projectId: pid,
          target: "generic",
          sourceStateVersion: version,
          artifactCount: 4,
        });
        expect(recorded.createdAt).toBeInstanceOf(Date);

        // Recording is bookkeeping: the state version does not move.
        expect(await getStateVersion(db, owner.id, pid)).toBe(version);
        const fresh = await isLastExportStale(db, owner.id, pid);
        expect(fresh.stale).toBe(false);
        expect(fresh.lastExport?.id).toBe(recorded.id);

        // A canonical change stales the last export.
        await createDecision(db, owner.id, pid, {
          decisionKey: "authentication.required",
          category: "AUTH",
          title: "Require auth",
          status: "CONFIRMED",
          impact: "HIGH",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: true,
        });
        const stale = await isLastExportStale(db, owner.id, pid);
        expect(stale.stale).toBe(true);
        expect(stale.currentStateVersion).toBeGreaterThan(version);

        const listed = await listExports(db, owner.id, pid);
        expect(listed).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });
});
