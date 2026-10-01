// TASK-045 acceptance: no canonical writes, traceable operations, invalid
// output rejected, failures preserve state, bounded recovery, fakes only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { OrchestratorError } from "./errors";
import { orchestrate, type OrchestrateInput } from "./orchestrator";

const SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1 },
          value: { type: "boolean", required: true },
        },
        additionalProperties: false,
      },
    },
  },
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

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("orchestrator (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "O", idea: "orchestrated" });
    return { owner, projectId: project.project.id };
  }

  function input(
    ownerId: string,
    projectId: string,
    overrides: Partial<OrchestrateInput> = {},
  ): OrchestrateInput {
    return {
      userId: ownerId,
      projectId,
      capability: "answer-extraction",
      operationType: "ANSWER_EXTRACTION",
      promptKey: "discovery.extract-answer",
      taskInput: "No login, single user.",
      schema: SCHEMA,
      ...overrides,
    };
  }

  it("succeeds on valid output and records a traceable operation", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `orc-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);
        const provider = new FakeProvider([
          { kind: "structured", json: '{"decisions":[{"key":"a.b","value":true}]}' },
        ]);

        const result = await orchestrate(db, input(owner.id, projectId), {
          provider,
          prompts: prompts(),
        });

        expect(result.data).toEqual({ decisions: [{ key: "a.b", value: true }] });
        expect(result.promptVersion).toBe("1.0");
        expect(result.repaired).toBe(false);
        const operation = await getOperation(db, owner.id, result.operationId);
        expect(operation.status).toBe("SUCCEEDED");
        expect(operation.promptKey).toBe("discovery.extract-answer");
        expect(operation.projectStateVersion).toBe(versionBefore);
        // Orchestrator writes ledger only: canonical version untouched.
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
      });
    } finally {
      await pool.end();
    }
  });

  it("repairs invalid output once, then fails without touching state", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `repr-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);

        const repairable = new FakeProvider([
          { kind: "structured", json: '{"decisions":[{"key":"a.b"}]}' },
          { kind: "structured", json: '{"decisions":[{"key":"a.b","value":false}]}' },
        ]);
        const repaired = await orchestrate(db, input(owner.id, projectId), {
          provider: repairable,
          prompts: prompts(),
        });
        expect(repaired.repaired).toBe(true);
        expect(repaired.data).toEqual({ decisions: [{ key: "a.b", value: false }] });
        expect(repairable.calls).toHaveLength(2);

        const hopeless = new FakeProvider([
          { kind: "structured", json: '{"nope":1}' },
          { kind: "structured", json: '{"still":2}' },
        ]);
        const failure = await orchestrate(db, input(owner.id, projectId), {
          provider: hopeless,
          prompts: prompts(),
        }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(OrchestratorError);
        expect((failure as OrchestratorError).code).toBe("VALIDATION");
        expect(hopeless.calls).toHaveLength(2);
        const operation = await getOperation(
          db,
          owner.id,
          (failure as OrchestratorError).operationId,
        );
        expect(operation.status).toBe("FAILED");
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
      });
    } finally {
      await pool.end();
    }
  });

  it("retries retryable provider errors once and gives up on permanent ones", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `retr-${Date.now()}@example.com`);

        const flaky = new FakeProvider([
          { kind: "fail", code: "RATE_LIMITED" },
          { kind: "structured", json: '{"decisions":[]}' },
        ]);
        const recovered = await orchestrate(db, input(owner.id, projectId), {
          provider: flaky,
          prompts: prompts(),
        });
        expect(recovered.data).toEqual({ decisions: [] });
        expect(flaky.calls).toHaveLength(2);

        const dead = new FakeProvider([
          { kind: "fail", code: "RATE_LIMITED" },
          { kind: "fail", code: "RATE_LIMITED" },
        ]);
        const failure = await orchestrate(db, input(owner.id, projectId), {
          provider: dead,
          prompts: prompts(),
        }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(OrchestratorError);
        expect((failure as OrchestratorError).code).toBe("RATE_LIMITED");
        expect(dead.calls).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });
});

describe("orchestrator boundaries (static)", () => {
  it("never imports canonical-state writers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/ai/orchestration/orchestrator.ts"),
      "utf-8",
    );
    const runtimeImports = source
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type"));
    const forbidden = [
      "modules/decisions/decisions",
      "modules/requirements/requirements",
      "modules/discovery/discovery",
      "modules/discovery/conversation",
    ];
    for (const line of runtimeImports) {
      for (const banned of forbidden) {
        expect(line).not.toContain(banned);
      }
    }
  });
});
