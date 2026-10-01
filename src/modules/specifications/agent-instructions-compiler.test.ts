// TASK-101 acceptance: AGENTS.md instructs coding-agent behavior, stays
// distinct from the target product's docs/agents.md, names authoritative
// spec locations, forbids silent requirement changes, and makes the task
// workflow explicit.
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
import { AGENT_INSTRUCTIONS_COMPILATION_PROMPT_KEY } from "../../ai/prompts/agent-instructions-compilation";
import type { AgentInstructionsCompilation } from "../../ai/schemas/agent-instructions-compilation";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { createRequirement } from "../requirements/requirements";
import { createMilestone } from "../tasks/milestones";
import { createUserTask } from "../tasks/user-tasks";
import { getSection, listDocuments, listSections } from "./documents";
import { listSectionDependencies } from "./dependencies";
import {
  compileAgentInstructions,
  AgentInstructionsCompilerError,
} from "./agent-instructions-compiler";

const SPECS = [
  "docs/PRD.md",
  "docs/architecture.md",
  "docs/database-schema.md",
  "docs/design.md",
  "docs/tasks.md",
].join(", ");

const EIGHT_SECTIONS: AgentInstructionsCompilation = {
  sections: [
    { key: "agents.orientation", body: `Build the spec planner. Truth lives in ${SPECS}.` },
    {
      key: "agents.reading_order",
      body: "Read context.md, then the active task, then docs/PRD.md, docs/architecture.md.",
    },
    { key: "agents.sources", body: `Product → ${SPECS}.` },
    {
      key: "agents.workflow",
      body: "Pick the active UTASK-001 from docs/tasks.md; respect dependencies; implement only its scope.",
      requirementCodes: ["FR-001"],
    },
    {
      key: "agents.boundaries",
      body: "Modular monolith; no new services.",
      knowledgeKeys: ["tech.stack"],
    },
    {
      key: "agents.requirement_changes",
      body: "Never silently change requirements — propose and wait for review.",
    },
    { key: "agents.testing", body: "Run typecheck, lint, and unit tests before completion." },
    { key: "agents.completion", body: "DONE needs acceptance criteria verified and checks green." },
  ],
  unknowns: [{ topic: "Language", detail: "Should AGENTS.md ship in Indonesian too?" }],
};

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("agent-instructions compiler input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(compileAgentInstructions(db, "  ", "p-1")).rejects.toBeInstanceOf(
      AgentInstructionsCompilerError,
    );
    await expect(compileAgentInstructions(db, "u-1", "  ")).rejects.toBeInstanceOf(
      AgentInstructionsCompilerError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("agent-instructions compiler (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, {
      name: "Agt",
      idea: "Spec planning SaaS.",
      targetUsers: "Solo developers.",
      constraints: "Single user for MVP.",
      preferredStack: "Next.js + Postgres.",
    });
    const pid = created.project.id;
    const stack = await createKnowledgeItem(db, owner.id, pid, {
      knowledgeKey: "tech.stack",
      domain: "TECHNICAL",
      title: "Stack",
      content: { summary: "Next.js + Postgres, modular monolith." },
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
    await createMilestone(db, owner.id, pid, { title: "Foundation" });
    await createUserTask(db, owner.id, pid, {
      title: "Implement sign-in",
      objective: "Build the sign-in flow.",
      priority: "P1",
      acceptanceCriteria: ["User can sign in."],
      definitionOfDone: ["Tests pass."],
      references: { requirements: [requirement.requirementCode] },
    });
    return { owner, pid, stack, requirement };
  }

  it("compiles the full instruction set from approved state without mutating it", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, stack, requirement } = await setup(db, `agt-${Date.now()}@example.com`);
        const before = await getStateVersion(db, owner.id, pid);

        const compiled = await compileAgentInstructions(db, owner.id, pid, depsFor(EIGHT_SECTIONS));

        expect(compiled.promptKey).toBe(AGENT_INSTRUCTIONS_COMPILATION_PROMPT_KEY);
        expect(compiled.operationId).not.toBeNull();
        expect(compiled.stateVersion).toBe(before);
        expect(compiled.sections).toHaveLength(8);

        const workflow = await getSection(
          db,
          owner.id,
          pid,
          "AGENT_INSTRUCTIONS",
          "agents.workflow",
        );
        expect(workflow.title).toBe("Task Workflow");
        expect(workflow.status).toBe("PROPOSED");
        expect(workflow.renderedContent).toContain("UTASK-001");
        const changes = await getSection(
          db,
          owner.id,
          pid,
          "AGENT_INSTRUCTIONS",
          "agents.requirement_changes",
        );
        expect(changes.renderedContent).toContain("Never silently change requirements");
        expect(compiled.unknowns?.renderedContent).toContain("Indonesian");

        const deps = await listSectionDependencies(
          db,
          owner.id,
          pid,
          "AGENT_INSTRUCTIONS",
          "agents.workflow",
        );
        expect(deps.map((dep) => dep.sourceId)).toEqual([requirement.id]);
        const boundaryDeps = await listSectionDependencies(
          db,
          owner.id,
          pid,
          "AGENT_INSTRUCTIONS",
          "agents.boundaries",
        );
        expect(boundaryDeps.map((dep) => dep.sourceId)).toEqual([stack.id]);

        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });

  it("supports scoped recompiles of single sections", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `agt-scope-${Date.now()}@example.com`);
        const scoped: AgentInstructionsCompilation = {
          sections: [
            {
              key: "agents.testing",
              body: "Run typecheck and lint. See docs/tasks.md for the checklist.",
            },
          ],
          unknowns: [],
        };
        const compiled = await compileAgentInstructions(db, owner.id, pid, {
          ...depsFor(scoped),
          onlySectionKeys: ["agents.testing"],
        });
        expect(compiled.sections.map((section) => section.sectionKey)).toEqual(["agents.testing"]);
        const rows = await listSections(db, owner.id, pid, "AGENT_INSTRUCTIONS");
        expect(rows.map((row) => row.sectionKey)).toEqual(["agents.testing"]);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects proposals that never name the spec locations", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `agt-loc-${Date.now()}@example.com`);
        const vague: AgentInstructionsCompilation = {
          sections: EIGHT_SECTIONS.sections.map((section) => ({
            ...section,
            body: "Follow the specifications and implement the task workflow for UTASK items.",
          })),
          unknowns: [],
        };
        await expect(
          compileAgentInstructions(db, owner.id, pid, depsFor(vague)),
        ).rejects.toBeInstanceOf(AgentInstructionsCompilerError);
        const docs = await listDocuments(db, owner.id, pid);
        expect(docs.map((doc) => doc.documentType)).not.toContain("AGENT_INSTRUCTIONS");
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects a workflow section that never names the task system", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `agt-wf-${Date.now()}@example.com`);
        const vague: AgentInstructionsCompilation = {
          sections: EIGHT_SECTIONS.sections.map((section) =>
            section.key === "agents.workflow"
              ? { ...section, body: `Just build things. Specs: ${SPECS}.` }
              : section,
          ),
          unknowns: [],
        };
        await expect(
          compileAgentInstructions(db, owner.id, pid, depsFor(vague)),
        ).rejects.toBeInstanceOf(AgentInstructionsCompilerError);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects invented references and incomplete full compiles", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setup(db, `agt-bad-${Date.now()}@example.com`);
        const bad: AgentInstructionsCompilation = {
          sections: EIGHT_SECTIONS.sections.map((section) =>
            section.key === "agents.boundaries"
              ? { ...section, knowledgeKeys: ["rumor.mill"] }
              : section,
          ),
          unknowns: [],
        };
        await expect(
          compileAgentInstructions(db, owner.id, pid, depsFor(bad)),
        ).rejects.toBeInstanceOf(AgentInstructionsCompilerError);

        const partial: AgentInstructionsCompilation = {
          sections: EIGHT_SECTIONS.sections.slice(0, 4),
          unknowns: [],
        };
        await expect(
          compileAgentInstructions(db, owner.id, pid, depsFor(partial)),
        ).rejects.toBeInstanceOf(AgentInstructionsCompilerError);
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
        const { owner, pid } = await setup(db, `agt-fail-${Date.now()}@example.com`);
        const before = await getStateVersion(db, owner.id, pid);
        await expect(
          compileAgentInstructions(db, owner.id, pid, depsFor(null, true)),
        ).rejects.toBeInstanceOf(AgentInstructionsCompilerError);
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
        const docs = await listDocuments(db, owner.id, pid);
        expect(docs.map((doc) => doc.documentType)).not.toContain("AGENT_INSTRUCTIONS");
      });
    } finally {
      await pool.end();
    }
  });
});
