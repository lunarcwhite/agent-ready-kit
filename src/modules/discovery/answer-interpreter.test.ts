// TASK-053 acceptance: explicit vs inferred classification, assumptions
// kept separate, multi-decision extraction, no invented decisions, strict
// schema, invalid identifiers rejected, representative natural-language
// answers. Fakes only — no live providers.
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
import { ensureDiscoveryMap } from "./discovery";
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import { getOperation } from "../../ai/operations/ledger";
import { validateStructuredOutput } from "../../ai/validation/validator";
import {
  ANSWER_INTERPRETATION_SCHEMA,
  type AnswerInterpretation,
} from "../../ai/schemas/answer-interpretation";
import {
  ANSWER_INTERPRETATION_PROMPT,
  ANSWER_INTERPRETATION_PROMPT_KEY,
} from "../../ai/prompts/answer-interpretation";
import {
  assertInterpretationBusinessRules,
  interpretAnswer,
  InterpreterError,
} from "./answer-interpreter";
import { DiscoveryValidationError } from "./errors";

// Representative fixture 1 (agents.md §11): Google-only login, no passwords.
const GOOGLE_ONLY: AnswerInterpretation = {
  decisions: [
    {
      key: "authentication.required",
      value: true,
      confidence: "EXPLICIT",
      rationale: "Login pakai Google.",
    },
    {
      key: "authentication.methods",
      value: ["GOOGLE"],
      confidence: "EXPLICIT",
      rationale: "Google saja.",
    },
    {
      key: "authentication.password",
      value: false,
      confidence: "INFERRED",
      rationale: "Tidak mau mengurus password.",
    },
  ],
  assumptions: [],
  unresolved: [{ topic: "access.session", question: "How long should sessions last?" }],
};

// Representative fixture 2 (AGENTS.md §32): personal app, no login, browser storage.
const PERSONAL_APP: AnswerInterpretation = {
  decisions: [
    {
      key: "multi_user",
      value: false,
      confidence: "EXPLICIT",
      rationale: "Cuma saya sendiri yang pakai.",
    },
    {
      key: "authentication.required",
      value: false,
      confidence: "EXPLICIT",
      rationale: "Tidak perlu login.",
    },
    {
      key: "storage.type",
      value: "local_browser",
      confidence: "EXPLICIT",
      rationale: "Cukup disimpan di browser.",
    },
    {
      key: "collaboration",
      value: "NOT_APPLICABLE",
      confidence: "INFERRED",
      rationale: "Single user implies no collaboration.",
    },
  ],
  assumptions: [
    { statement: "Browser storage quota suffices for the data volume", impact: "MEDIUM" },
  ],
  unresolved: [],
};

function registry(): PromptRegistry {
  return new PromptRegistry();
}

describe("answer-interpretation schema (unit, no database)", () => {
  it("accepts representative multi-decision answers", () => {
    expect(validateStructuredOutput(ANSWER_INTERPRETATION_SCHEMA, GOOGLE_ONLY)).toEqual({
      ok: true,
      issues: [],
    });
    expect(validateStructuredOutput(ANSWER_INTERPRETATION_SCHEMA, PERSONAL_APP)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("keeps decisions, assumptions, and unresolved structurally separate", () => {
    const mixed = {
      decisions: [{ key: "a.b", value: true, confidence: "ASSUMED" }],
      assumptions: [],
      unresolved: [],
    };
    expect(validateStructuredOutput(ANSWER_INTERPRETATION_SCHEMA, mixed).ok).toBe(false);
    expect(
      validateStructuredOutput(ANSWER_INTERPRETATION_SCHEMA, {
        decisions: [],
        assumptions: [{ statement: "s", impact: "BLOCKER" }],
        unresolved: [],
      }).ok,
    ).toBe(false);
  });

  it("rejects missing sections and extra properties", () => {
    expect(validateStructuredOutput(ANSWER_INTERPRETATION_SCHEMA, { decisions: [] }).ok).toBe(
      false,
    );
    expect(
      validateStructuredOutput(ANSWER_INTERPRETATION_SCHEMA, { ...GOOGLE_ONLY, decided: true }).ok,
    ).toBe(false);
  });
});

describe("interpretation business rules (unit, no database)", () => {
  it("classifies EXPLICIT vs INFERRED and keeps assumptions separate", () => {
    expect(() => assertInterpretationBusinessRules(GOOGLE_ONLY)).not.toThrow();
    expect(() => assertInterpretationBusinessRules(PERSONAL_APP)).not.toThrow();
    const explicit = GOOGLE_ONLY.decisions.filter((d) => d.confidence === "EXPLICIT");
    const inferred = GOOGLE_ONLY.decisions.filter((d) => d.confidence === "INFERRED");
    expect(explicit).toHaveLength(2);
    expect(inferred).toHaveLength(1);
    // Assumptions never leak into decisions.
    for (const decision of PERSONAL_APP.decisions) {
      expect(decision.confidence).not.toBe("ASSUMED");
    }
  });

  it("rejects invalid identifiers and blank text", () => {
    expect(() =>
      assertInterpretationBusinessRules({
        decisions: [{ key: "Has Spaces", value: true, confidence: "EXPLICIT" }],
        assumptions: [],
        unresolved: [],
      }),
    ).toThrow(InterpreterError);
    expect(() =>
      assertInterpretationBusinessRules({
        decisions: [{ key: "a.b", value: true, confidence: "EXPLICIT", rationale: "  " }],
        assumptions: [],
        unresolved: [],
      }),
    ).toThrow(InterpreterError);
    expect(() =>
      assertInterpretationBusinessRules({
        decisions: [],
        assumptions: [{ statement: "  ", impact: "LOW" }],
        unresolved: [],
      }),
    ).toThrow(InterpreterError);
  });

  it("rejects smuggled confirmation vocabulary", () => {
    expect(() =>
      assertInterpretationBusinessRules({
        decisions: [{ key: "a.b", value: true, confidence: "CONFIRMED" }],
        assumptions: [],
        unresolved: [],
      }),
    ).toThrow(InterpreterError);
  });
});

describe("answer-interpretation prompt (unit, no database)", () => {
  it("has a stable key and forbids invented decisions", () => {
    expect(ANSWER_INTERPRETATION_PROMPT_KEY).toBe("discovery.extract-answer");
    expect(ANSWER_INTERPRETATION_PROMPT.version).toBe("1.0");
    const text = ANSWER_INTERPRETATION_PROMPT.boundaries.join(" ").toLowerCase();
    expect(text).toContain("never invent");
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("interpretAnswer (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, {
      name: "I",
      idea: "A personal planner.",
    });
    await ensureDiscoveryMap(db, owner.id, created.project.id);
    return { owner, projectId: created.project.id };
  }

  function providerFor(payload: unknown): FakeProvider {
    return new FakeProvider([{ kind: "structured", json: JSON.stringify(payload) }]);
  }

  it("extracts multiple decisions from one answer without canonical writes", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `interp-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);

        const result = await interpretAnswer(
          db,
          owner.id,
          projectId,
          {
            answer: "Tidak perlu login, cuma saya sendiri yang pakai, data di browser.",
            nodeKey: "access",
          },
          { provider: providerFor(PERSONAL_APP), prompts: registry() },
        );

        expect(result.interpretation.decisions).toHaveLength(4);
        expect(result.promptKey).toBe("discovery.extract-answer");
        const operation = await getOperation(db, owner.id, result.operationId);
        expect(operation.status).toBe("SUCCEEDED");
        expect(operation.operationType).toBe("ANSWER_EXTRACTION");
        // Translation only: no decisions persisted, version untouched.
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
        const decisions = await db.query.decisions.findMany({
          where: (row, { eq }) => eq(row.projectId, projectId),
        });
        expect(decisions).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects blank answers, unknown topics, and provider failures intact", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `interp-bad-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);

        await expect(
          interpretAnswer(db, owner.id, projectId, { answer: "   " }, { prompts: registry() }),
        ).rejects.toBeInstanceOf(DiscoveryValidationError);
        await expect(
          interpretAnswer(
            db,
            owner.id,
            projectId,
            { answer: "No login.", nodeKey: "nope" },
            { provider: providerFor(PERSONAL_APP), prompts: registry() },
          ),
        ).rejects.toThrow();

        const dead = new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }]);
        const failure = await interpretAnswer(
          db,
          owner.id,
          projectId,
          { answer: "No login.", nodeKey: "access" },
          { provider: dead, prompts: registry() },
        ).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(InterpreterError);
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
      });
    } finally {
      await pool.end();
    }
  });
});

describe("interpreter boundaries (static)", () => {
  it("never imports provider SDKs or canonical-state writers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/discovery/answer-interpreter.ts"),
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
