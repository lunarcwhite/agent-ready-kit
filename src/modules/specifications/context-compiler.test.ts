// TASK-100 acceptance: compact context from approved state, no full-PRD
// duplication, unknowns explicit, understandable without UI context.
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
import type { ContextCompilation } from "../../ai/schemas/context-compilation";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { createRequirement } from "../requirements/requirements";
import { createUserTask } from "../tasks/user-tasks";
import { getSection, listDocuments, listSections } from "./documents";
import { listSectionDependencies } from "./dependencies";
import { CONTEXT_COMPILATION_PROMPT_KEY } from "../../ai/prompts/context-compilation";
import {
  compileContext,
  ContextCompilerError,
} from "./context-compiler";

const SEVEN_SECTIONS: ContextCompilation = {
  sections: [
    { key: "context.mission", body: "Help teams ship specs.", knowledgeKeys: ["vision.summary"] },
    { key: "context.users", body: "Solo developers.", knowledgeKeys: ["user.audience"] },
    { key: "context.scope", body: "MVP planning only." },
    {
      key: "context.capabilities",
      body: "Projects, discovery, specs.",
      requirementCodes: ["FR-001"],
    },
    { key: "context.architecture", body: "Modular monolith." },
    { key: "context.stack", body: "Next.js + Postgres.", knowledgeKeys: ["tech.stack"] },
    { key: "context.constraints", body: "Single user for MVP." },
  ],
  unknowns: [{ topic: "Billing", detail: "Is billing in scope for MVP?" }],
};

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("context compiler input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(compileContext(db, "  ", "p-1")).rejects.toBeInstanceOf(ContextCompilerError);
    await expect(compileContext(db, "u-1", "  ")).rejects.toBeInstanceOf(ContextCompilerError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("context compiler (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, {
      name: "Ctx",
      idea: "Spec planning SaaS.",
      targetUsers: "Solo developers.",
      constraints: "Single user for MVP.",
      preferredStack: "Next.js + Postgres.",
    });
    const pid = created.project.id;
    const vision = await createKnowledgeItem(db, owner.id, pid, {
      knowledgeKey: "vision.summary",
      domain: "PRODUCT",
      title: "Vision",
      content: { summary: "Help teams ship specs." },
      confidence: "EXPLICIT",
      sources: [{ type: "PROJECT_INPUT" }],
    });
    await createKnowledgeItem(db, owner.id, pid, {
      knowledgeKey: "user.audience",
      domain: "USER",
      title: "Audience",
      content: { summary: "Solo developers." },
      confidence: "EXPLICIT",
      sources: [{ type: "PROJECT_INPUT" }],
    });
    await createKnowledgeItem(db, owner.id, pid, {
      knowledgeKey: "tech.stack",
      domain: "TECHNICAL",
      title: "Stack",
      content: { summary: "Next.js + Postgres." },
      confidence: "EXPLICIT",
      sources: [{ type: "PROJECT_INPUT" }],
    });
    const requirement = await createRequirement(db, owner.id, pid, {
      type: "FUNCTIONAL",
      title: "Create project",
      description: "Users can create projects.",
      priority: "MUST",
      status: "CONFIRMED",
    });
    await createUserTask(db, owner.id, pid, {
      title: "Implement sign-in",
      objective: "Build the sign-in flow.",
      priority: "P1",
      acceptanceCriteria: ["User can sign in."],
      definitionOfDone: ["Tests pass."],
      references: { requirements: [requirement.requirementCode] },
    });
    return { owner, pid, vision, requirement };
  }

  it("compiles the full bootstrap from approved state without mutating it", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, vision, requirement } = await setup(
          db,
          `ctx-${Date.now()}@example.com`,
        );
        const before = await getStateVersion(db, owner.id, pid);

        const compiled = await compileContext(db, owner.id, pid, depsFor(SEVEN_SECTIONS));

        expect(compiled.promptKey).toBe(CONTEXT_COMPILATION_PROMPT_KEY);
        expect(compiled.operationId).not.toBeNull();
        expect(compiled.stateVersion).toBe(before);
        // Seven AI sections plus the two deterministic facts.
        expect(compiled.sections).toHaveLength(9);

        const mission = await getSection(db, owner.id, pid, "CONTEXT", "context.mission");
        expect(mission.title).toBe("Mission");
        expect(mission.status).toBe("PROPOSED");
        expect(mission.renderedContent).toBe("Help teams ship specs.");
        const phase = await getSection(db, owner.id, pid, "CONTEXT", "context.phase");
        expect(phase.renderedContent).toContain("Lifecycle: DISCOVERY");
        expect(phase.renderedContent).toContain("Discovery: INITIAL");
        expect(phase.renderedContent).toContain("UTASK");
        const sources = await getSection(db, owner.id, pid, "CONTEXT", "context.sources");
        expect(sources.renderedContent).toContain("docs/PRD.md");
        expect(sources.renderedContent).toContain("docs/tasks.md");
        expect(compiled.unknowns?.renderedContent).toContain("Billing");

        // Dependencies declare the grounding (AC: current approved state).
        const deps = await listSectionDependencies(
          db,
          owner.id,
          pid,
          "CONTEXT",
          "context.capabilities",
        );
        expect(deps.map((dep) => dep.sourceType).sort()).toEqual(["REQUIREMENT"]);
        const missionDeps = await listSectionDependencies(
          db,
          owner.id,
          pid,
          "CONTEXT",
          "context.mission",
        );
        expect(missionDeps.map((dep) => dep.sourceId)).toEqual([vision.id]);
        void requirement;

        // Compilation is proposal-only: canonical version untouched.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });

  it("skips the provider when only deterministic sections are requested", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `ctx-scope-${Date.now()}@example.com`);
        const provider = new FakeProvider([
          { kind: "structured", json: JSON.stringify(SEVEN_SECTIONS) },
        ]);
        const compiled = await compileContext(db, owner.id, pid, {
          provider,
          prompts: new PromptRegistry(),
          cache: null,
          onlySectionKeys: ["context.phase"],
        });
        expect(provider.calls).toHaveLength(0);
        expect(compiled.operationId).toBeNull();
        expect(compiled.sections.map((section) => section.sectionKey)).toEqual(["context.phase"]);
        const rows = await listSections(db, owner.id, pid, "CONTEXT");
        expect(rows.map((row) => row.sectionKey)).toEqual(["context.phase"]);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects invented references and writes nothing", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `ctx-bad-${Date.now()}@example.com`);
        const bad: ContextCompilation = {
          sections: SEVEN_SECTIONS.sections.map((section) =>
            section.key === "context.mission"
              ? { ...section, knowledgeKeys: ["rumor.mill"] }
              : section,
          ),
          unknowns: [],
        };
        await expect(compileContext(db, owner.id, pid, depsFor(bad))).rejects.toBeInstanceOf(
          ContextCompilerError,
        );
        const docs = await listDocuments(db, owner.id, pid);
        expect(docs.map((doc) => doc.documentType)).not.toContain("CONTEXT");
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects incomplete full compiles missing required sections", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `ctx-part-${Date.now()}@example.com`);
        const partial: ContextCompilation = {
          sections: SEVEN_SECTIONS.sections.slice(0, 3),
          unknowns: [],
        };
        await expect(compileContext(db, owner.id, pid, depsFor(partial))).rejects.toBeInstanceOf(
          ContextCompilerError,
        );
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
        const { owner, pid } = await setup(db, `ctx-fail-${Date.now()}@example.com`);
        const before = await getStateVersion(db, owner.id, pid);
        await expect(compileContext(db, owner.id, pid, depsFor(null, true))).rejects.toBeInstanceOf(
          ContextCompilerError,
        );
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
        const docs = await listDocuments(db, owner.id, pid);
        expect(docs.map((doc) => doc.documentType)).not.toContain("CONTEXT");
      });
    } finally {
      await pool.end();
    }
  });
});
