// TASK-069 acceptance: changed dependencies identify affected sections,
// unaffected sections preserve version/content, proposals are reviewable,
// stable identifiers survive, failure preserves the last approved state.
//
// Unit tests pin validation without a database. Row-level proofs run as
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
import { createVersion, getSection, listSections, listVersions, upsertSection } from "./documents";
import { markStaleDependents, setSectionDependencies } from "./dependencies";
import { planRegeneration, regenerateAffectedSections, RegenerationError } from "./regeneration";
import { PrdCompilerError } from "./prd-compiler";

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("regeneration input validation", () => {
  it("rejects blank owner and unknown document types without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(planRegeneration(db, "  ", "p-1")).rejects.toBeInstanceOf(RegenerationError);
    await expect(regenerateAffectedSections(db, "u-1", "  ")).rejects.toBeInstanceOf(
      RegenerationError,
    );
    await expect(planRegeneration(db, "u-1", "p-1", ["PRD", "NOPE"])).rejects.toBeInstanceOf(
      RegenerationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("incremental regeneration (integration, fakes only)", () => {
  async function setupTwoSections(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "R", idea: "regen" });
    const pid = project.project.id;
    const requirement = await createRequirement(db, owner.id, pid, {
      type: "FUNCTIONAL",
      title: "Login",
      description: "Users can log in.",
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
    await upsertSection(db, owner.id, pid, "PRD", {
      sectionKey: "product.scope",
      title: "Scope",
      renderedContent: "Old scope text.",
    });
    await upsertSection(db, owner.id, pid, "PRD", {
      sectionKey: "product.users",
      title: "Users",
      renderedContent: "Users text.",
    });
    await setSectionDependencies(db, owner.id, pid, "PRD", "product.scope", [
      { sourceType: "REQUIREMENT", sourceId: requirement.id },
    ]);
    await setSectionDependencies(db, owner.id, pid, "PRD", "product.users", [
      { sourceType: "KNOWLEDGE", sourceId: knowledge.id },
    ]);
    return { owner, pid, requirement, knowledge };
  }

  it("plans exactly the stale sections with human reasons", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, requirement } = await setupTwoSections(
          db,
          `regen-plan-${Date.now()}@example.com`,
        );
        await markStaleDependents(db, owner.id, pid, "REQUIREMENT", requirement.id);

        const plan = await planRegeneration(db, owner.id, pid, ["PRD"]);
        expect(plan.affected).toHaveLength(1);
        expect(plan.affected[0]?.sectionKey).toBe("product.scope");
        expect(plan.affected[0]?.documentType).toBe("PRD");
        expect(plan.affected[0]?.sources.map((source) => source.label)).toContain(
          requirement.requirementCode,
        );
        expect(plan.unaffectedCurrentCount).toBe(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("regenerates only affected sections and preserves the rest byte-identical", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, requirement, knowledge } = await setupTwoSections(
          db,
          `regen-run-${Date.now()}@example.com`,
        );
        await markStaleDependents(db, owner.id, pid, "REQUIREMENT", requirement.id);
        const before = await getStateVersion(db, owner.id, pid);
        const staleBefore = await getSection(db, owner.id, pid, "PRD", "product.scope");
        const keptBefore = await getSection(db, owner.id, pid, "PRD", "product.users");

        const proposal: ProductCompilation = {
          sections: [
            {
              key: "product.scope",
              title: "Scope",
              body: "New scope text. Implements FR-001.",
              requirementCodes: [requirement.requirementCode],
              knowledgeKeys: [knowledge.knowledgeKey],
            },
          ],
          unknowns: [],
        };
        const result = await regenerateAffectedSections(db, owner.id, pid, {
          ...depsFor(proposal),
          documentTypes: ["PRD"],
        });
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0]?.status).toBe("regenerated");
        expect(result.documents[0]?.regeneratedKeys).toEqual(["product.scope"]);
        expect(result.documents[0]?.pendingKeys).toEqual([]);
        expect(result.stateVersion).toBe(before);

        // Affected section: same stable id, new PROPOSED content.
        const staleAfter = await getSection(db, owner.id, pid, "PRD", "product.scope");
        expect(staleAfter.id).toBe(staleBefore.id);
        expect(staleAfter.status).toBe("PROPOSED");
        expect(staleAfter.renderedContent).toBe("New scope text. Implements FR-001.");

        // Unaffected section: byte-identical, still CURRENT.
        const keptAfter = await getSection(db, owner.id, pid, "PRD", "product.users");
        expect(keptAfter.id).toBe(keptBefore.id);
        expect(keptAfter.title).toBe(keptBefore.title);
        expect(keptAfter.renderedContent).toBe(keptBefore.renderedContent);
        expect(keptAfter.status).toBe("CURRENT");

        // Canonical version untouched; approval still binds to it.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
        const snap = await createVersion(db, owner.id, pid, "PRD");
        expect(snap.projectStateVersion).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects out-of-scope proposals without writing anything", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, requirement } = await setupTwoSections(
          db,
          `regen-scope-${Date.now()}@example.com`,
        );
        await markStaleDependents(db, owner.id, pid, "REQUIREMENT", requirement.id);

        const wandering: ProductCompilation = {
          sections: [
            {
              key: "product.scope",
              title: "Scope",
              body: "New scope.",
              requirementCodes: [requirement.requirementCode],
            },
            {
              key: "product.surprise",
              title: "Surprise",
              body: "Unrequested rewrite.",
            },
          ],
          unknowns: [],
        };
        await expect(
          regenerateAffectedSections(db, owner.id, pid, {
            ...depsFor(wandering),
            documentTypes: ["PRD"],
          }),
        ).rejects.toBeInstanceOf(PrdCompilerError);

        expect((await getSection(db, owner.id, pid, "PRD", "product.scope")).status).toBe("STALE");
        expect(await listSections(db, owner.id, pid, "PRD")).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("preserves the last approved specification when generation fails", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, requirement } = await setupTwoSections(
          db,
          `regen-fail-${Date.now()}@example.com`,
        );
        await markStaleDependents(db, owner.id, pid, "REQUIREMENT", requirement.id);
        await createVersion(db, owner.id, pid, "PRD");
        const versionsBefore = await listVersions(db, owner.id, pid, "PRD");
        const sectionsBefore = await listSections(db, owner.id, pid, "PRD");

        await expect(
          regenerateAffectedSections(db, owner.id, pid, {
            ...depsFor(null, true),
            documentTypes: ["PRD"],
          }),
        ).rejects.toThrow();

        expect(await listVersions(db, owner.id, pid, "PRD")).toEqual(versionsBefore);
        expect(await listSections(db, owner.id, pid, "PRD")).toEqual(sectionsBefore);
      });
    } finally {
      await pool.end();
    }
  });
});
