// TASK-102 acceptance: deterministic output for approved content, stable
// identifiers preserved, internal metadata excluded, UTF-8 intact,
// optional documents omitted.
//
// Unit tests pin pure validation without a DB. Renderer proofs run as
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
import {
  AGENT_KIT_FILE_PATHS,
  renderAgentKitFiles,
  renderApprovedDocument,
  renderReadme,
} from "./renderer";

describe("renderer input validation (unit, no database)", () => {
  const db = {} as AppDatabase;

  it("rejects blank owners and unknown document types without touching the database", async () => {
    await expect(renderApprovedDocument(db, "  ", "p-1", "CONTEXT")).rejects.toBeInstanceOf(
      AgentKitValidationError,
    );
    await expect(renderApprovedDocument(db, "u-1", "p-1", "MANIFESTO")).rejects.toBeInstanceOf(
      AgentKitValidationError,
    );
    await expect(renderAgentKitFiles(db, "", "p-1")).rejects.toBeInstanceOf(
      AgentKitValidationError,
    );
    expect(() => renderReadme("  ", [])).toThrow(AgentKitValidationError);
  });

  it("renders a deterministic UTF-8 README without timestamps or ids", () => {
    const files = [{ path: "AGENTS.md" }, { path: "context.md" }, { path: "docs/PRD.md" }];
    const first = renderReadme("Rencana Café ☕", files);
    const second = renderReadme("Rencana Café ☕", files);
    expect(second).toBe(first);
    expect(first).toContain("# Rencana Café ☕ — Agent Kit");
    expect(first).toContain("`docs/PRD.md`");
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(first).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("markdown renderer (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "R", idea: "Renderer." });
    const pid = created.project.id;
    await ensureDocument(db, owner.id, pid, "CONTEXT");
    await upsertSection(db, owner.id, pid, "CONTEXT", {
      sectionKey: "context.mission",
      title: "Mission",
      renderedContent: "Membantu tim mencapai FR-001 dan UTASK-001. ☕",
    });
    await upsertSection(db, owner.id, pid, "CONTEXT", {
      sectionKey: "context.scope",
      title: "Scope",
      renderedContent: "MVP saja.",
    });
    return { owner, pid };
  }

  it("renders the latest approved snapshot byte-identically", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `rk-${Date.now()}@example.com`);
        const v1 = await createVersion(db, owner.id, pid, "CONTEXT");
        await upsertSection(db, owner.id, pid, "CONTEXT", {
          sectionKey: "context.scope",
          title: "Scope",
          renderedContent: "MVP saja, plus alpha.",
        });
        const v2 = await createVersion(db, owner.id, pid, "CONTEXT");

        const rendered = await renderApprovedDocument(db, owner.id, pid, "CONTEXT");

        // Latest snapshot wins; stable IDs and UTF-8 survive untouched.
        expect(rendered).toMatchObject({
          documentType: "CONTEXT",
          path: "context.md",
          version: v2.version,
          projectStateVersion: v2.projectStateVersion,
        });
        expect(rendered?.content).toBe(v2.content);
        expect(rendered?.content).toContain("FR-001");
        expect(rendered?.content).toContain("UTASK-001");
        expect(rendered?.content).toContain("☕");
        expect(rendered?.content).toContain("plus alpha");
        expect(v1.content).not.toContain("plus alpha");

        // Deterministic: repeated renders are byte-identical.
        const again = await renderApprovedDocument(db, owner.id, pid, "CONTEXT");
        expect(again).toEqual(rendered);

        // Internal metadata never leaks into the artifact.
        expect(JSON.stringify(rendered)).not.toContain("dependencyHash");
        expect(rendered?.content).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
      });
    } finally {
      await pool.end();
    }
  });

  it("omits documents with nothing approved and orders the kit set", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `rk-omit-${Date.now()}@example.com`);
        // PRD document exists but was never approved: omitted, not empty.
        await ensureDocument(db, owner.id, pid, "PRD");
        await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "product.vision",
          title: "Vision",
          renderedContent: "Draft only.",
          status: "PROPOSED",
        });
        await createVersion(db, owner.id, pid, "CONTEXT");
        await ensureDocument(db, owner.id, pid, "AGENT_INSTRUCTIONS");
        await upsertSection(db, owner.id, pid, "AGENT_INSTRUCTIONS", {
          sectionKey: "agents.orientation",
          title: "Project Orientation",
          renderedContent: "Read context.md first.",
        });
        await createVersion(db, owner.id, pid, "AGENT_INSTRUCTIONS");

        expect(await renderApprovedDocument(db, owner.id, pid, "PRD")).toBeNull();
        expect(await renderApprovedDocument(db, owner.id, pid, "SOUL")).toBeNull();

        const files = await renderAgentKitFiles(db, owner.id, pid);
        expect(files.map((file) => file.path)).toEqual(["AGENTS.md", "context.md"]);
        expect(files[0]?.path).toBe(AGENT_KIT_FILE_PATHS.AGENT_INSTRUCTIONS);

        const readme = renderReadme("R", files);
        expect(readme).toContain("`AGENTS.md`");
        expect(readme).toContain("`context.md`");
        expect(readme).not.toContain("docs/PRD.md");
      });
    } finally {
      await pool.end();
    }
  });
});
