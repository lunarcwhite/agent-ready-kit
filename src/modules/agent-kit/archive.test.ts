// TASK-105 acceptance: ZIP generates, filename safe, structure correct,
// project authorization enforced, no temp files, failures leave project
// state intact.
//
// Unit tests pin validation without a DB. Export proofs run as
// rolled-back integration tests — skipped, not failed, without
// TEST_DATABASE_URL/DATABASE_URL. Archive openability is additionally
// verified outside CI with a third-party opener (Expand-Archive).
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { strFromU8, unzipSync } from "fflate";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createVersion, ensureDocument, upsertSection } from "../specifications/documents";
import { AgentKitValidationError } from "./errors";
import { exportAgentKitZip } from "./archive";

describe("zip export validation (unit, no database)", () => {
  it("rejects blank owners without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(exportAgentKitZip(db, "  ", "p-1")).rejects.toBeInstanceOf(
      AgentKitValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("zip export (integration)", () => {
  async function setup(db: AppDatabase, email: string, name: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name, idea: "Export." });
    const pid = created.project.id;
    await ensureDocument(db, owner.id, pid, "CONTEXT");
    await upsertSection(db, owner.id, pid, "CONTEXT", {
      sectionKey: "context.mission",
      title: "Mission",
      renderedContent: "Ship FR-001.",
    });
    await createVersion(db, owner.id, pid, "CONTEXT");
    await ensureDocument(db, owner.id, pid, "AGENT_INSTRUCTIONS");
    await upsertSection(db, owner.id, pid, "AGENT_INSTRUCTIONS", {
      sectionKey: "agents.orientation",
      title: "Project Orientation",
      renderedContent: "Read context.md first.",
    });
    await createVersion(db, owner.id, pid, "AGENT_INSTRUCTIONS");
    return { owner, pid };
  }

  it("generates a safe-named, correct, openable archive without touching state", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `zip-${Date.now()}@example.com`, "Rencana Café ☕");
        const before = await getStateVersion(db, owner.id, pid);

        const archive = await exportAgentKitZip(db, owner.id, pid, {
          generatedAt: "2026-01-01T00:00:00.000Z",
        });

        // Filename is safe ASCII with no traversal.
        expect(archive.filename).toBe("rencana-cafe-agent-kit.zip");
        expect(archive.filename).not.toContain("..");
        expect(archive.filename).not.toMatch(/[^a-z0-9.\-]/);
        expect(archive.fileCount).toBe(4);

        // Structure correct: every expected entry unzips with intact content.
        const entries = unzipSync(archive.bytes);
        const paths = Object.keys(entries).sort();
        expect(paths).toEqual([
          ".agent-ready/manifest.json",
          "AGENTS.md",
          "README.md",
          "context.md",
        ]);
        expect(strFromU8(entries["context.md"]!)).toContain("FR-001");
        const manifest = JSON.parse(strFromU8(entries[".agent-ready/manifest.json"]!));
        expect(manifest.target).toBe("generic");
        expect(manifest.artifacts.map((a: { path: string }) => a.path).sort()).toEqual([
          "AGENTS.md",
          "context.md",
        ]);
        expect(archive.sourceStateVersion).toBe(manifest.sourceStateVersion);

        // Failed and successful exports leave canonical state intact.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
        await expect(
          exportAgentKitZip(db, owner.id, "00000000-0000-0000-0000-000000000000"),
        ).rejects.toThrow();
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });
});
