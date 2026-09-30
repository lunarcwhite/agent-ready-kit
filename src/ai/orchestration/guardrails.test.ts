// TASK-046 acceptance: no uncontrolled repeated expensive operations,
// idempotent duplicate handling, understandable errors, inspectable usage.
// Size-budget tests are pure; enforcement tests use the ledger with fakes.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { createProject } from "../../modules/projects/repository";
import { getStateVersion } from "../../modules/projects/state-version";
import { FakeProvider } from "../providers/fake";
import { PromptRegistry } from "../prompts/registry";
import { getOperation } from "../operations/ledger";
import type { FieldSchema } from "../validation/schema";
import { orchestrate, type OrchestrateInput } from "./orchestrator";
import { OrchestratorError } from "./errors";
import {
  checkSizeLimits,
  DEFAULT_LIMITS,
  enforceGuards,
  getUsageSummary,
  GuardrailError,
} from "./guardrails";

const SCHEMA: FieldSchema = {
  type: "object",
  properties: { ok: { type: "boolean", required: true } },
  additionalProperties: false,
};

const PROMPT = {
  key: "discovery.extract-answer",
  version: "1.0",
  role: "You are the Answer Interpreter.",
  objective: "Extract supported project decisions.",
  boundaries: ["Do not invent unsupported decisions."],
  outputSchema: "answer-interpretation/v1",
  qualityCriteria: ["Every decision cites supporting text."],
};

function prompts(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register(PROMPT);
  return registry;
}

describe("guardrail budgets (unit, no database)", () => {
  it("rejects oversized inputs with understandable messages", () => {
    expect(() => checkSizeLimits("x".repeat(DEFAULT_LIMITS.maxTaskInputChars + 1), "{}")).toThrow(
      GuardrailError,
    );
    try {
      checkSizeLimits("x".repeat(DEFAULT_LIMITS.maxTaskInputChars + 1), "{}");
    } catch (error) {
      expect((error as GuardrailError).code).toBe("INPUT_TOO_LARGE");
      expect((error as Error).message).toContain("Shorten the input");
    }
    expect(() => checkSizeLimits("ok", "x".repeat(DEFAULT_LIMITS.maxContextChars + 1))).toThrow(
      expect.objectContaining({ code: "CONTEXT_TOO_LARGE" }),
    );
    expect(() => checkSizeLimits("ok", "{}")).not.toThrow();
  });

  it("rejects invalid usage windows without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(getUsageSummary(db, "  ")).rejects.toBeInstanceOf(GuardrailError);
    await expect(getUsageSummary(db, "u-1", { windowHours: 0 })).rejects.toBeInstanceOf(
      GuardrailError,
    );
  });

  it("exposes sane MVP defaults", () => {
    expect(DEFAULT_LIMITS.maxOpsPerUserPerHour).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.maxRunningPerProject).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.maxTaskInputChars).toBeGreaterThanOrEqual(20_000);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("guardrails (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "G", idea: "guarded" });
    return { owner, projectId: project.project.id };
  }

  function input(ownerId: string, projectId: string): OrchestrateInput {
    return {
      userId: ownerId,
      projectId,
      capability: "answer-extraction",
      operationType: "ANSWER_EXTRACTION",
      promptKey: "discovery.extract-answer",
      taskInput: "No login, single user.",
      schema: SCHEMA,
    };
  }

  function successProvider(): FakeProvider {
    return new FakeProvider([{ kind: "structured", json: '{"ok":true}' }]);
  }

  it("blocks operations past the hourly cap and records the refusal", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `gr-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);
        const limits = { maxOpsPerProjectPerHour: 1 };

        await orchestrate(db, input(owner.id, projectId), {
          provider: successProvider(),
          prompts: prompts(),
          limits,
        });
        const refusal = await orchestrate(db, input(owner.id, projectId), {
          provider: successProvider(),
          prompts: prompts(),
          limits,
        }).catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(OrchestratorError);
        expect((refusal as OrchestratorError).code).toBe("RATE_LIMITED");
        expect((refusal as Error).message).toContain("Try again later");
        const operation = await getOperation(
          db,
          owner.id,
          (refusal as OrchestratorError).operationId,
        );
        expect(operation.status).toBe("FAILED");
        // Refusals spend nothing and touch no canonical state.
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);

        const summary = await getUsageSummary(db, owner.id, { projectId });
        expect(summary.total).toBe(2);
        expect(summary.byStatus.SUCCEEDED).toBe(1);
        expect(summary.byStatus.FAILED).toBe(1);
        expect(summary.byCapability["answer-extraction"]).toBe(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("lets exactly one of two concurrent duplicates through", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `dup-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);
        const shared = new FakeProvider([
          { kind: "delay", delayMs: 500, then: { kind: "structured", json: '{"ok":true}' } },
          { kind: "structured", json: '{"ok":true}' },
        ]);
        const deps = { provider: shared, prompts: prompts(), limits: { maxRunningPerProject: 1 } };
        // First call holds a RUNNING row inside the delayed provider while
        // the second call arrives: exactly one survives the concurrency cap.
        const pending = orchestrate(db, input(owner.id, projectId), deps).catch(
          (error: unknown) => error,
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        const second = await orchestrate(db, input(owner.id, projectId), deps).catch(
          (error: unknown) => error,
        );
        const first = await pending;
        const codes = [first, second].map((result) =>
          result instanceof OrchestratorError ? result.code : "SUCCEEDED",
        );
        expect(codes.sort()).toEqual(["CONCURRENT_LIMIT", "SUCCEEDED"]);
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects oversized task input before any provider spend", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `big-${Date.now()}@example.com`);
        const provider = successProvider();
        const refusal = await orchestrate(
          db,
          {
            ...input(owner.id, projectId),
            taskInput: "x".repeat(DEFAULT_LIMITS.maxTaskInputChars + 1),
          },
          { provider, prompts: prompts() },
        ).catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(OrchestratorError);
        expect((refusal as OrchestratorError).code).toBe("INPUT_TOO_LARGE");
        expect(provider.calls).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("enforceGuards validates blank owners without a database round-trip", async () => {
    const db = {} as AppDatabase;
    await expect(
      enforceGuards(db, "u", "p", { taskInput: "x".repeat(1_000_000), contextJson: "{}" }),
    ).rejects.toBeInstanceOf(GuardrailError);
  });
});
