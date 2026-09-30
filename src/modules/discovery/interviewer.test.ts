// TASK-052 acceptance: topic received (never reordered), concise question,
// meaningful options, identified recommendation with rationale, custom
// answers stay possible, invalid output rejected, failures preserve state.
// Fakes only — no live providers.
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
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { ProjectNotFoundError } from "../projects/errors";
import { ensureDiscoveryMap, updateDiscoveryNode } from "./discovery";
import { appendDiscoveryMessage } from "./conversation";
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import { getOperation } from "../../ai/operations/ledger";
import { validateStructuredOutput } from "../../ai/validation/validator";
import {
  DISCOVERY_QUESTION_SCHEMA,
  type DiscoveryQuestion,
} from "../../ai/schemas/discovery-question";
import {
  DISCOVERY_QUESTION_PROMPT,
  DISCOVERY_QUESTION_PROMPT_KEY,
} from "../../ai/prompts/discovery-question";
import {
  generateDiscoveryQuestion,
  InterviewerError,
  assertQuestionBusinessRules,
} from "./interviewer";
import { DiscoveryValidationError } from "./errors";

const VALID_QUESTION: DiscoveryQuestion = {
  question: "Apakah pengguna perlu memiliki akun, atau aplikasi dapat digunakan tanpa login?",
  options: [{ label: "Tanpa login" }, { label: "Google saja" }, { label: "Google + Email" }],
  recommendation: {
    optionLabel: "Tanpa login",
    rationale: "Aplikasi pribadi satu pengguna tidak membutuhkan akun.",
  },
};

function registry(): PromptRegistry {
  return new PromptRegistry();
}

describe("discovery-question schema (unit, no database)", () => {
  it("accepts a well-formed question with recommendation", () => {
    expect(validateStructuredOutput(DISCOVERY_QUESTION_SCHEMA, VALID_QUESTION)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("accepts a question without recommendation", () => {
    const bare = { question: VALID_QUESTION.question, options: VALID_QUESTION.options };
    expect(validateStructuredOutput(DISCOVERY_QUESTION_SCHEMA, bare)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("rejects missing questions, empty labels, and extra properties", () => {
    expect(validateStructuredOutput(DISCOVERY_QUESTION_SCHEMA, {}).ok).toBe(false);
    expect(
      validateStructuredOutput(DISCOVERY_QUESTION_SCHEMA, {
        question: "Q?",
        options: [{ label: "" }],
      }).ok,
    ).toBe(false);
    expect(
      validateStructuredOutput(DISCOVERY_QUESTION_SCHEMA, { ...VALID_QUESTION, decided: true }).ok,
    ).toBe(false);
  });

  it("rejects whitespace-only text and stray recommendations at the service boundary", () => {
    expect(() =>
      assertQuestionBusinessRules({
        question: "Q?",
        options: [{ label: "  " }],
      }),
    ).toThrow(InterviewerError);
    expect(() =>
      assertQuestionBusinessRules({
        question: "  ",
        options: [{ label: "A" }],
      }),
    ).toThrow(InterviewerError);
    expect(() =>
      assertQuestionBusinessRules({
        ...VALID_QUESTION,
        recommendation: { optionLabel: "Carrier pigeon", rationale: "Why not." },
      }),
    ).toThrow(InterviewerError);
    expect(() => assertQuestionBusinessRules(VALID_QUESTION)).not.toThrow();
  });

  it("rejects recommendations without rationale", () => {
    expect(
      validateStructuredOutput(DISCOVERY_QUESTION_SCHEMA, {
        question: "Q?",
        options: [{ label: "A" }],
        recommendation: { optionLabel: "A" },
      }).ok,
    ).toBe(false);
  });
});

describe("discovery-question prompt (unit, no database)", () => {
  it("has a stable key and forbids reordering topics", () => {
    expect(DISCOVERY_QUESTION_PROMPT_KEY).toBe("discovery.generate-question");
    expect(DISCOVERY_QUESTION_PROMPT.version).toBe("1.0");
    const text = DISCOVERY_QUESTION_PROMPT.boundaries.join(" ").toLowerCase();
    expect(text).toContain("only the given topic");
    expect(text).toContain("reorder");
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("generateDiscoveryQuestion (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, {
      name: "Q",
      idea: "A personal planner without login.",
    });
    await ensureDiscoveryMap(db, owner.id, created.project.id);
    return { owner, projectId: created.project.id };
  }

  function providerFor(payload: unknown): FakeProvider {
    return new FakeProvider([{ kind: "structured", json: JSON.stringify(payload) }]);
  }

  it("asks about the given topic without touching canonical state", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ask-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);

        const result = await generateDiscoveryQuestion(db, owner.id, projectId, "access", {
          provider: providerFor(VALID_QUESTION),
          prompts: registry(),
        });

        expect(result.nodeKey).toBe("access");
        expect(result.question.question).toBe(VALID_QUESTION.question);
        expect(result.question.options.map((o) => o.label)).toEqual([
          "Tanpa login",
          "Google saja",
          "Google + Email",
        ]);
        expect(result.question.recommendation?.optionLabel).toBe("Tanpa login");
        expect(result.promptKey).toBe("discovery.generate-question");

        const operation = await getOperation(db, owner.id, result.operationId);
        expect(operation.status).toBe("SUCCEEDED");
        expect(operation.capability).toBe("discovery-question");
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects resolved topics and recommendations outside the options", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ask-bad-${Date.now()}@example.com`);
        await updateDiscoveryNode(db, owner.id, projectId, "access", { status: "RESOLVED" });
        await expect(
          generateDiscoveryQuestion(db, owner.id, projectId, "access", {
            provider: providerFor(VALID_QUESTION),
            prompts: registry(),
          }),
        ).rejects.toBeInstanceOf(DiscoveryValidationError);

        const stray = {
          ...VALID_QUESTION,
          recommendation: { optionLabel: "Carrier pigeon", rationale: "Why not." },
        };
        const failure = await generateDiscoveryQuestion(db, owner.id, projectId, "data", {
          provider: providerFor(stray),
          prompts: registry(),
        }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(InterviewerError);
      });
    } finally {
      await pool.end();
    }
  });

  it("stores generated questions as evidence without canonical writes", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ask-ev-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);
        const { startDiscoverySession } = await import("./conversation");
        const session = await startDiscoverySession(db, owner.id, projectId);
        const generated = await generateDiscoveryQuestion(db, owner.id, projectId, "access", {
          provider: providerFor(VALID_QUESTION),
          prompts: registry(),
        });
        const stored = await appendDiscoveryMessage(db, owner.id, projectId, session.id, {
          role: "ASSISTANT",
          content: generated.question.question,
          nodeKey: "access",
          aiOperationId: generated.operationId,
          options: generated.question.options.map((o) => o.label),
          recommendation: generated.question.recommendation,
        });
        expect(stored.metadata?.options).toEqual(["Tanpa login", "Google saja", "Google + Email"]);
        expect(stored.metadata?.recommendation?.optionLabel).toBe("Tanpa login");
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
        await expect(
          generateDiscoveryQuestion(
            db,
            owner.id,
            "00000000-0000-0000-0000-000000000000",
            "access",
            {
              provider: providerFor(VALID_QUESTION),
              prompts: registry(),
            },
          ),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});

describe("interviewer boundaries (static)", () => {
  it("never imports provider SDKs or canonical-state writers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/discovery/interviewer.ts"),
      "utf-8",
    );
    const runtimeImports = source
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type"));
    const forbidden = [
      "modules/decisions/decisions",
      "modules/requirements/requirements",
      "modules/discovery/conversation",
      "ai/providers/openai",
      "ai/providers/anthropic",
      "openai",
      "@anthropic",
    ];
    for (const line of runtimeImports) {
      for (const banned of forbidden) {
        expect(line).not.toContain(banned);
      }
    }
    expect(source).toContain("ai/orchestration/orchestrator");
  });
});
