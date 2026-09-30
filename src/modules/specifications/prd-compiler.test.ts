// TASK-062 acceptance: existing FR identifiers preserved, unknowns stay
// explicit, no invented product behavior, priorities preserved, output
// references the source state version, deterministic rendering.
//
// Unit tests pin validation without AI or DB. Compiler proofs run as
// rolled-back integration tests with a scripted FakeProvider — skipped,
// not failed, without TEST_DATABASE_URL/DATABASE_URL.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import type { ProductCompilation } from "../../ai/schemas/product-compilation";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createRequirement } from "../requirements/requirements";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { createVersion, getSection, listDocuments, listSections } from "./documents";
import { listSectionDependencies } from "./dependencies";
import { compilePrd, PrdCompilerError } from "./prd-compiler";

const EMPTY: ProductCompilation = { sections: [], unknowns: [] };

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("prd compiler input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(compilePrd(db, "  ", "p-1")).rejects.toBeInstanceOf(PrdCompilerError);
    await expect(compilePrd(db, "u-1", "  ")).rejects.toBeInstanceOf(PrdCompilerError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("prd compiler (integration, fakes only)", () => {
  it("compiles sections with preserved FR codes and explicit unknowns", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `prd-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "P", idea: "prd" });
        const pid = project.project.id;
        const requirement = await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Create project",
          description: "The user can create a new project.",
          priority: "MUST",
          status: "CONFIRMED",
          acceptanceCriteria: ["Name is required"],
        });
        const knowledge = await createKnowledgeItem(db, owner.id, pid, {
          knowledgeKey: "vision.summary",
          domain: "Vision",
          title: "Tracker",
          content: { summary: "task tracker" },
          confidence: "EXPLICIT",
          sources: [{ type: "PROJECT_INPUT" }],
        });
        const before = await getStateVersion(db, owner.id, pid);

        const proposal: ProductCompilation = {
          sections: [
            {
              key: "product.overview",
              title: "Overview",
              body: "A task tracker. Implements FR-001.",
              requirementCodes: [requirement.requirementCode],
              knowledgeKeys: [knowledge.knowledgeKey],
            },
          ],
          unknowns: [{ topic: "Pricing", detail: "Is there a paid tier?" }],
        };
        const compiled = await compilePrd(db, owner.id, pid, depsFor(proposal));
        expect(compiled.sections).toHaveLength(1);
        expect(compiled.sections[0]?.status).toBe("PROPOSED");
        expect(compiled.unknowns?.sectionKey).toBe("product.unknowns");
        // Canonical version untouched by derived compilation.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        // Priorities preserved by construction from the table.
        const stored = await getSection(db, owner.id, pid, "PRD", "product.overview");
        const structured = stored.structuredContent as {
          requirements: { code: string; priority: string }[];
        };
        expect(structured.requirements).toEqual([
          { code: "FR-001", title: "Create project", priority: "MUST", status: "CONFIRMED" },
        ]);
        const deps = await listSectionDependencies(db, owner.id, pid, "PRD", "product.overview");
        expect(deps.map((dep) => dep.sourceType).sort()).toEqual(["KNOWLEDGE", "REQUIREMENT"]);

        // Approval snapshots bind content to the source state version.
        const snap = await createVersion(db, owner.id, pid, "PRD");
        expect(snap.projectStateVersion).toBe(before);
        expect(snap.content).toContain("A task tracker");
        expect(await listSections(db, owner.id, pid, "PRD")).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects invented FR codes and superseded references", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `prdbad-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "B", idea: "bad" });
        const pid = project.project.id;
        await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Real",
          description: "A real requirement.",
          priority: "MUST",
          status: "CONFIRMED",
        });

        const invented: ProductCompilation = {
          sections: [
            {
              key: "product.overview",
              title: "Overview",
              body: "Implements FR-999.",
              requirementCodes: ["FR-999"],
            },
          ],
          unknowns: [],
        };
        await expect(compilePrd(db, owner.id, pid, depsFor(invented))).rejects.toBeInstanceOf(
          PrdCompilerError,
        );
        // Nothing persisted on rejection (no document container created).
        expect(await listDocuments(db, owner.id, pid)).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("leaves approved state intact when the provider fails", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `prdfail-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "F", idea: "fail" });
        const pid = project.project.id;
        const before = await getStateVersion(db, owner.id, pid);

        await expect(compilePrd(db, owner.id, pid, depsFor(EMPTY, true))).rejects.toBeInstanceOf(
          PrdCompilerError,
        );
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });
});
