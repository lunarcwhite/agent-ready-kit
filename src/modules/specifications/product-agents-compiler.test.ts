// TASK-066 acceptance: applicability is determined, non-AI projects get no
// fabricated agents, every role has explicit boundaries, output stays
// distinct from Agent Ready Kit internals.
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
import type { ProductAgentsCompilation } from "../../ai/schemas/product-agents-compilation";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createRequirement } from "../requirements/requirements";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { getSection, listDocuments, listSections } from "./documents";
import { listSectionDependencies } from "./dependencies";
import {
  compileProductAgents,
  evaluateProductAgentsApplicability,
  ProductAgentsCompilerError,
} from "./product-agents-compiler";

const EMPTY: ProductAgentsCompilation = { sections: [], unknowns: [] };

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("product agents compiler input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(compileProductAgents(db, "  ", "p-1")).rejects.toBeInstanceOf(
      ProductAgentsCompilerError,
    );
    await expect(compileProductAgents(db, "u-1", "  ")).rejects.toBeInstanceOf(
      ProductAgentsCompilerError,
    );
    await expect(evaluateProductAgentsApplicability(db, "  ", "p-1")).rejects.toBeInstanceOf(
      ProductAgentsCompilerError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("product agents compiler (integration, fakes only)", () => {
  async function setupAiProject(
    db: AppDatabase,
    email: string,
    confidence: "EXPLICIT" | "INFERRED" | "ASSUMED",
  ) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "P", idea: "ai novelist" });
    const pid = project.project.id;
    const knowledge = await createKnowledgeItem(db, owner.id, pid, {
      knowledgeKey: "ai.behavior",
      domain: "AI",
      title: "Writing assistant",
      content: { summary: "helps draft chapters" },
      confidence,
      sources: [{ type: "PROJECT_INPUT" }],
    });
    return { owner, pid, knowledge };
  }

  it("skips non-AI projects without calling the provider", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `agents-skip-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "P", idea: "expense tracker" });
        const pid = project.project.id;

        const provider = new FakeProvider([{ kind: "structured", json: JSON.stringify(EMPTY) }]);
        const compiled = await compileProductAgents(db, owner.id, pid, {
          provider,
          prompts: new PromptRegistry(),
          cache: null,
        });
        expect(compiled.applicable).toBe(false);
        expect(compiled.sections).toEqual([]);
        expect(compiled.unknowns).toBeNull();
        expect(compiled.operationId).toBeNull();
        expect(provider.calls).toHaveLength(0);
        const docs = await listDocuments(db, owner.id, pid);
        expect(docs.map((doc) => doc.documentType)).not.toContain("PRODUCT_AGENTS");
      });
    } finally {
      await pool.end();
    }
  });

  it("skips ASSUMED-only AI knowledge instead of fabricating roles", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupAiProject(
          db,
          `agents-assumed-${Date.now()}@example.com`,
          "ASSUMED",
        );
        const applicability = await evaluateProductAgentsApplicability(db, owner.id, pid);
        expect(applicability.applicable).toBe(false);
        expect(applicability.aiKnowledgeCount).toBe(1);
        expect(applicability.confirmedAiKnowledgeCount).toBe(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("compiles bounded roles with preserved FR codes and explicit unknowns", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, knowledge } = await setupAiProject(
          db,
          `agents-${Date.now()}@example.com`,
          "EXPLICIT",
        );
        const requirement = await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Draft chapters",
          description: "The assistant drafts chapters from an outline.",
          priority: "MUST",
          status: "CONFIRMED",
          acceptanceCriteria: ["Draft follows the outline"],
        });
        const before = await getStateVersion(db, owner.id, pid);

        const proposal: ProductAgentsCompilation = {
          sections: [
            {
              key: "agents.planner",
              title: "Story Planner",
              body: "Plans chapters from the outline. Implements FR-001.",
              agent: {
                name: "Story Planner",
                objective: "Turn outlines into chapter plans.",
                boundaries: ["Must not write final prose."],
                inputs: ["Chapter outline."],
                outputs: ["Chapter plan."],
              },
              requirementCodes: [requirement.requirementCode],
              knowledgeKeys: [knowledge.knowledgeKey],
            },
          ],
          unknowns: [{ topic: "Memory", detail: "How much story history is visible?" }],
        };
        const compiled = await compileProductAgents(db, owner.id, pid, depsFor(proposal));
        expect(compiled.applicable).toBe(true);
        expect(compiled.sections).toHaveLength(1);
        expect(compiled.sections[0]?.status).toBe("PROPOSED");
        expect(compiled.unknowns?.sectionKey).toBe("agents.unknowns");
        expect(compiled.operationId).not.toBeNull();
        // Canonical version untouched by derived compilation.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        const stored = await getSection(db, owner.id, pid, "PRODUCT_AGENTS", "agents.planner");
        const structured = stored.structuredContent as {
          agent: { name: string; boundaries: string[] };
          requirements: { code: string; priority: string }[];
        };
        expect(structured.agent.name).toBe("Story Planner");
        expect(structured.agent.boundaries).toEqual(["Must not write final prose."]);
        expect(structured.requirements).toEqual([
          {
            code: "FR-001",
            title: "Draft chapters",
            priority: "MUST",
            status: "CONFIRMED",
          },
        ]);
        const deps = await listSectionDependencies(
          db,
          owner.id,
          pid,
          "PRODUCT_AGENTS",
          "agents.planner",
        );
        expect(deps.map((dep) => dep.sourceType).sort()).toEqual(["KNOWLEDGE", "REQUIREMENT"]);
        expect(await listSections(db, owner.id, pid, "PRODUCT_AGENTS")).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects unbounded roles and invented FR codes", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupAiProject(
          db,
          `agents-bad-${Date.now()}@example.com`,
          "EXPLICIT",
        );
        const unbounded: ProductAgentsCompilation = {
          sections: [
            {
              key: "agents.vague",
              title: "Helper",
              body: "Helps with things.",
              agent: {
                name: "Helper",
                objective: "Help.",
                boundaries: [],
                inputs: ["Anything."],
                outputs: ["Anything."],
              },
            },
          ],
          unknowns: [],
        };
        await expect(
          compileProductAgents(db, owner.id, pid, depsFor(unbounded)),
        ).rejects.toBeInstanceOf(ProductAgentsCompilerError);
        const invented: ProductAgentsCompilation = {
          sections: [
            {
              key: "agents.ghost",
              title: "Ghost",
              body: "Implements nothing.",
              agent: {
                name: "Ghost",
                objective: "Haunt.",
                boundaries: ["Must not exist."],
                inputs: ["Nothing."],
                outputs: ["Nothing."],
              },
              requirementCodes: ["FR-999"],
            },
          ],
          unknowns: [],
        };
        await expect(
          compileProductAgents(db, owner.id, pid, depsFor(invented)),
        ).rejects.toBeInstanceOf(ProductAgentsCompilerError);
      });
    } finally {
      await pool.end();
    }
  });
});
