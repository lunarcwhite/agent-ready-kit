// TASK-092 acceptance: structured output, bounded tasks, requirement
// references, proposed dependencies, preserved acceptance criteria,
// present definitions of done, no mega-tasks, no invented requirements.
// Fakes only — no live providers.
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
import { createRequirement } from "../requirements/requirements";
import { createComponent } from "../architecture/components";
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import { validateStructuredOutput } from "../../ai/validation/validator";
import { TASK_GENERATION_SCHEMA, type TaskGeneration } from "../../ai/schemas/task-generation";
import {
  TASK_GENERATION_PROMPT,
  TASK_GENERATION_PROMPT_KEY,
} from "../../ai/prompts/task-generation";
import { getUserTaskByCode, listUserTasks } from "./user-tasks";
import { listTaskPrerequisites } from "./dependencies";
import { listMilestones } from "./milestones";
import { PlannerError, generatePlan } from "./planner";

// Representative fixture: Google sign-in requirement decomposed into two
// bounded tasks, the second depending on the first.
const SIGNIN_PLAN: TaskGeneration = {
  milestones: [
    {
      title: "Foundation",
      tasks: [
        {
          key: "auth-google-login",
          title: "Implement Google OAuth login",
          objective: "Wire Google OAuth into the login flow behind the identity abstraction.",
          priority: "P0",
          requirementCodes: ["FR-001"],
          acceptanceCriteria: ["User signs in with Google", "Session survives navigation"],
          definitionOfDone: ["Unit tests pass", "Lint passes"],
        },
        {
          key: "auth-session-tests",
          title: "Cover session handling with tests",
          objective: "Add integration tests for session creation, refresh, and expiry.",
          priority: "P1",
          requirementCodes: ["FR-001", "FR-999"],
          dependsOn: ["auth-google-login", "auth-google-login", "no-such-task"],
          acceptanceCriteria: [],
          definitionOfDone: ["Integration tests pass"],
        },
      ],
    },
  ],
};

describe("task-generation schema (unit, no database)", () => {
  it("accepts a representative milestone plan", () => {
    expect(validateStructuredOutput(TASK_GENERATION_SCHEMA, SIGNIN_PLAN)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("rejects bad priorities, unknown fields, and missing milestones", () => {
    const [milestone] = SIGNIN_PLAN.milestones;
    const [task] = milestone.tasks;
    expect(
      validateStructuredOutput(TASK_GENERATION_SCHEMA, {
        milestones: [{ ...milestone, tasks: [{ ...task, priority: "URGENT" }] }],
      }).ok,
    ).toBe(false);
    expect(
      validateStructuredOutput(TASK_GENERATION_SCHEMA, {
        milestones: [{ ...milestone, tasks: [{ ...task, status: "DONE" }] }],
      }).ok,
    ).toBe(false);
    expect(validateStructuredOutput(TASK_GENERATION_SCHEMA, { milestones: [] }).ok).toBe(true);
    expect(validateStructuredOutput(TASK_GENERATION_SCHEMA, {}).ok).toBe(false);
  });
});

describe("task-generation prompt (unit, no database)", () => {
  it("has a stable key and forbids mega-tasks and invented scope", () => {
    expect(TASK_GENERATION_PROMPT_KEY).toBe("planning.generate-tasks");
    expect(TASK_GENERATION_PROMPT.version).toBe("1.0");
    const text = TASK_GENERATION_PROMPT.boundaries.join(" ").toLowerCase();
    expect(text).toContain("mega-tasks");
    expect(text).toContain("never invent requirements");
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("generatePlan (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "P", idea: "Task planning." });
    return { owner, projectId: created.project.id };
  }

  function providerFor(payload: unknown): FakeProvider {
    return new FakeProvider([{ kind: "structured", json: JSON.stringify(payload) }]);
  }

  const REQUIREMENT = {
    type: "FUNCTIONAL" as const,
    title: "Google sign-in",
    description: "Users sign in with Google.",
    priority: "MUST" as const,
    status: "CONFIRMED" as const,
    acceptanceCriteria: ["User signs in with Google"],
  };

  it("persists milestones, PENDING tasks, refs, and edges without invented scope", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `plan-${Date.now()}@example.com`);
        await createRequirement(db, owner.id, projectId, REQUIREMENT);
        const component = await createComponent(db, owner.id, projectId, {
          name: "AuthService",
          status: "DRAFT",
        });
        const payload: TaskGeneration = {
          milestones: [
            {
              ...SIGNIN_PLAN.milestones[0],
              tasks: [
                { ...SIGNIN_PLAN.milestones[0].tasks[0], architectureRefs: [component.id] },
                SIGNIN_PLAN.milestones[0].tasks[1],
              ],
            },
          ],
        };

        const report = await generatePlan(db, owner.id, projectId, {
          provider: providerFor(payload),
          prompts: new PromptRegistry(),
          cache: null,
        });

        expect(report.milestones).toEqual([
          { milestoneCode: "MS-001", title: "Foundation", created: true },
        ]);
        expect(report.tasks.map((row) => row.taskCode)).toEqual(["UTASK-001", "UTASK-002"]);
        // Unknown FR-999 and unknown dep dropped (duplicate dep skipped silently).
        expect(report.droppedRefs).toBe(2);
        // Empty model criteria inherited verbatim from FR-001.
        expect(report.inheritedCriteria).toBe(1);
        expect(report.dependencies).toEqual([{ from: "UTASK-002", to: "UTASK-001" }]);

        const first = await getUserTaskByCode(db, owner.id, projectId, "UTASK-001");
        expect(first.status).toBe("PENDING");
        expect(first.references?.requirements).toEqual(["FR-001"]);
        const second = await getUserTaskByCode(db, owner.id, projectId, "UTASK-002");
        expect(second.acceptanceCriteria).toEqual(["User signs in with Google"]);
        expect(second.references?.requirements).toEqual(["FR-001"]);
        const prerequisites = await listTaskPrerequisites(db, owner.id, projectId, "UTASK-002");
        expect(prerequisites.map((row) => row.dependsOnCode)).toEqual(["UTASK-001"]);

        // Rerun extends the same milestone instead of forking a duplicate.
        const rerun = await generatePlan(db, owner.id, projectId, {
          provider: providerFor(payload),
          prompts: new PromptRegistry(),
          cache: null,
        });
        expect(rerun.milestones).toEqual([
          { milestoneCode: "MS-001", title: "Foundation", created: false },
        ]);
        expect(await listMilestones(db, owner.id, projectId)).toHaveLength(1);
        expect(await listUserTasks(db, owner.id, projectId)).toHaveLength(4);
      });
    } finally {
      await pool.end();
    }
  });

  it("refuses to plan from nothing without calling the provider", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `plan-empty-${Date.now()}@example.com`);
        const provider = providerFor(SIGNIN_PLAN);
        await expect(
          generatePlan(db, owner.id, projectId, {
            provider,
            prompts: new PromptRegistry(),
            cache: null,
          }),
        ).rejects.toBeInstanceOf(PlannerError);
        expect(provider.calls).toHaveLength(0);
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
        const { owner, projectId } = await setup(db, `plan-fail-${Date.now()}@example.com`);
        await createRequirement(db, owner.id, projectId, REQUIREMENT);
        const failing = new FakeProvider([
          { kind: "fail", code: "PROVIDER_UNAVAILABLE", message: "Down." },
        ]);
        await expect(
          generatePlan(db, owner.id, projectId, {
            provider: failing,
            prompts: new PromptRegistry(),
            cache: null,
          }),
        ).rejects.toBeInstanceOf(PlannerError);
        expect(await listUserTasks(db, owner.id, projectId)).toHaveLength(0);
        expect(await listMilestones(db, owner.id, projectId)).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });
});
