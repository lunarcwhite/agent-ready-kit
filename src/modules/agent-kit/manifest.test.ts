// TASK-103 acceptance: valid JSON, explicit schema version, paths match
// the declared contents, correct source state version, optional
// artifacts represented accurately.
//
// Unit tests pin structural validation without a DB. Manifest proofs run
// as rolled-back integration tests — skipped, not failed, without
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
import { AgentKitValidationError } from "./errors";
import {
  AGENT_KIT_MANIFEST_PATH,
  AGENT_KIT_MANIFEST_SCHEMA_VERSION,
  generateManifest,
  type ManifestArtifactInput,
} from "./manifest";

const FILES: ManifestArtifactInput[] = [
  { path: "AGENTS.md", documentType: "AGENT_INSTRUCTIONS", version: 2, projectStateVersion: 3 },
  { path: "context.md", documentType: "CONTEXT", version: 1, projectStateVersion: 3 },
];

describe("manifest validation (unit, no database)", () => {
  const db = {} as AppDatabase;

  it("rejects malformed calls before touching the database", async () => {
    await expect(generateManifest(db, "  ", "p-1", FILES)).rejects.toBeInstanceOf(
      AgentKitValidationError,
    );
    await expect(generateManifest(db, "u-1", "p-1", [])).rejects.toBeInstanceOf(
      AgentKitValidationError,
    );
    await expect(
      generateManifest(db, "u-1", "p-1", [...FILES, { ...FILES[0]! }]),
    ).rejects.toBeInstanceOf(AgentKitValidationError);
    await expect(
      generateManifest(db, "u-1", "p-1", [
        { path: "context.md", version: 0, projectStateVersion: 3 },
      ]),
    ).rejects.toBeInstanceOf(AgentKitValidationError);
    await expect(
      generateManifest(db, "u-1", "p-1", FILES, { generatedAt: "not-a-date" }),
    ).rejects.toBeInstanceOf(AgentKitValidationError);
    await expect(
      generateManifest(db, "u-1", "p-1", FILES, { target: "  " }),
    ).rejects.toBeInstanceOf(AgentKitValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("agent kit manifest (integration)", () => {
  it("records identity, state version, and exactly the declared artifacts", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `mk-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "M", idea: "Manifest." });
        const pid = created.project.id;
        const stateVersion = await getStateVersion(db, owner.id, pid);

        const manifest = await generateManifest(db, owner.id, pid, FILES, {
          generatedAt: "2026-01-01T00:00:00.000Z",
        });

        // Valid JSON round-trip with an explicit schema version.
        const parsed = JSON.parse(JSON.stringify(manifest));
        expect(parsed.schemaVersion).toBe(AGENT_KIT_MANIFEST_SCHEMA_VERSION);
        expect(AGENT_KIT_MANIFEST_PATH).toBe(".agent-ready/manifest.json");
        expect(manifest.projectId).toBe(pid);
        expect(manifest.projectName).toBe("M");
        expect(manifest.sourceStateVersion).toBe(stateVersion);
        expect(manifest.target).toBe("generic");
        expect(manifest.readiness.lifecycleState).toBe("DISCOVERY");
        // Paths match the declared contents — nothing added, nothing lost.
        expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual([
          "AGENTS.md",
          "context.md",
        ]);
        expect(manifest.artifacts[0]).toMatchObject({
          documentType: "AGENT_INSTRUCTIONS",
          version: 2,
          projectStateVersion: 3,
        });
      });
    } finally {
      await pool.end();
    }
  });
});
