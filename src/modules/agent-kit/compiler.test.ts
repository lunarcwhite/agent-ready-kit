// TASK-104 acceptance: required files exist, optional files follow
// applicability, paths match the manifest, no secrets included,
// rebuildable from the same approved state, vendor-neutral.
//
// Unit tests pin validation without a DB. Assembly proofs run as
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
import { createVersion, ensureDocument, upsertSection } from "../specifications/documents";
import { AgentKitValidationError } from "./errors";
import { assembleAgentKit } from "./compiler";

describe("agent kit assembly validation (unit, no database)", () => {
  it("rejects blank owners without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(assembleAgentKit(db, "  ", "p-1")).rejects.toBeInstanceOf(AgentKitValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("generic agent kit compiler (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "K", idea: "Kit." });
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

  it("assembles the canonical package with matching manifest", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `kit-${Date.now()}@example.com`);

        const kit = await assembleAgentKit(db, owner.id, pid, {
          generatedAt: "2026-01-01T00:00:00.000Z",
        });

        // Required files exist; optional unapproved docs omitted, not empty.
        const paths = kit.files.map((file) => file.path);
        expect(paths).toEqual([
          "README.md",
          "AGENTS.md",
          "context.md",
          ".agent-ready/manifest.json",
        ]);
        expect(kit.files[1]?.content).toContain("Read context.md first.");
        expect(kit.files[2]?.content).toContain("FR-001");

        // Package paths match manifest.
        expect(kit.manifest.artifacts.map((artifact) => artifact.path)).toEqual([
          "AGENTS.md",
          "context.md",
        ]);
        expect(kit.manifest.target).toBe("generic");

        // No internal secrets: only expected keys, no tokens or user rows.
        const dumped = JSON.stringify(kit);
        expect(dumped).not.toContain(owner.id);
        expect(dumped).not.toContain("userId");
        expect(dumped).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}.*sk-/);
        expect(Object.keys(kit.manifest).sort()).toEqual(
          [
            "artifacts",
            "generatedAt",
            "projectId",
            "projectName",
            "readiness",
            "schemaVersion",
            "sourceStateVersion",
            "target",
          ].sort(),
        );

        // Rebuildable: same approved state plus timestamp → identical bytes.
        const rebuilt = await assembleAgentKit(db, owner.id, pid, {
          generatedAt: "2026-01-01T00:00:00.000Z",
        });
        expect(rebuilt).toEqual(kit);
      });
    } finally {
      await pool.end();
    }
  });

  it("refuses a hollow package without the bootstrap entries", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `kit-hollow-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "H", idea: "Hollow." });
        const pid = created.project.id;
        await expect(assembleAgentKit(db, owner.id, pid)).rejects.toBeInstanceOf(
          AgentKitValidationError,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
