// TASK-050 acceptance: structured output, explicit facts, unknowns,
// candidate decisions, separate assumptions, no silent confirmation,
// failure leaves project creation intact. Fakes only — no live providers.
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
import { createProject, getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { ProjectNotFoundError } from "../projects/errors";
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import { getOperation } from "../../ai/operations/ledger";
import { validateStructuredOutput } from "../../ai/validation/validator";
import { IDEA_ANALYSIS_SCHEMA, type IdeaAnalysis } from "../../ai/schemas/idea-analysis";
import {
  IDEA_ANALYSIS_PROMPT,
  IDEA_ANALYSIS_PROMPT_KEY,
  IDEA_ANALYSIS_PROMPT_VERSION,
} from "../../ai/prompts/idea-analysis";
import { analyzeIdea, IdeaAnalysisError } from "./idea-analyst";
import { DiscoveryValidationError } from "./errors";

const VALID_ANALYSIS: IdeaAnalysis = {
  summary: "A calm single-user planner for solo founders.",
  productCategory: "Productivity",
  knownFacts: [{ statement: "Single user application", evidence: "cuma saya sendiri yang pakai" }],
  candidateKnowledge: [{ domain: "USER", statement: "Single solo-founder user" }],
  candidateDecisions: [
    {
      key: "authentication.required",
      title: "Authentication required",
      confidence: "EXPLICIT",
      rationale: "User said no login needed.",
    },
    {
      key: "storage.type",
      title: "Storage type",
      confidence: "INFERRED",
      rationale: "Browser storage implied.",
    },
  ],
  unknownDomains: [{ domain: "integrations", question: "Are external integrations needed?" }],
  assumptions: [
    {
      statement: "Local browser storage suffices",
      impact: "MEDIUM",
      rationale: "No sync mentioned.",
    },
  ],
};

function registry(): PromptRegistry {
  return new PromptRegistry();
}

function providerFor(payload: unknown): FakeProvider {
  return new FakeProvider([{ kind: "structured", json: JSON.stringify(payload) }]);
}

describe("idea-analysis schema (unit, no database)", () => {
  it("accepts a well-formed analysis", () => {
    expect(validateStructuredOutput(IDEA_ANALYSIS_SCHEMA, VALID_ANALYSIS)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("requires every acceptance section", () => {
    const result = validateStructuredOutput(IDEA_ANALYSIS_SCHEMA, {
      summary: "x",
      productCategory: "y",
    });
    expect(result.ok).toBe(false);
    const paths = result.issues.map((issue) => issue.path);
    expect(paths).toContain("$.knownFacts");
    expect(paths).toContain("$.candidateDecisions");
    expect(paths).toContain("$.unknownDomains");
    expect(paths).toContain("$.assumptions");
  });

  it("rejects silently-confirmed or assumed candidate decisions", () => {
    const smuggled = {
      ...VALID_ANALYSIS,
      candidateDecisions: [{ key: "a.b", title: "T", confidence: "ASSUMED" }],
    };
    expect(validateStructuredOutput(IDEA_ANALYSIS_SCHEMA, smuggled).ok).toBe(false);

    const confirmed = {
      ...VALID_ANALYSIS,
      candidateDecisions: [{ key: "a.b", title: "T", confidence: "CONFIRMED" }],
    };
    expect(validateStructuredOutput(IDEA_ANALYSIS_SCHEMA, confirmed).ok).toBe(false);
  });

  it("rejects extra properties and bad assumption impact", () => {
    const extra = { ...VALID_ANALYSIS, hacked: true };
    expect(validateStructuredOutput(IDEA_ANALYSIS_SCHEMA, extra).ok).toBe(false);
    const badImpact = {
      ...VALID_ANALYSIS,
      assumptions: [{ statement: "s", impact: "BLOCKER" }],
    };
    expect(validateStructuredOutput(IDEA_ANALYSIS_SCHEMA, badImpact).ok).toBe(false);
  });
});

describe("idea-analysis prompt (unit, no database)", () => {
  it("has a stable key and version", () => {
    expect(IDEA_ANALYSIS_PROMPT_KEY).toBe("discovery.idea-analysis");
    expect(IDEA_ANALYSIS_PROMPT_VERSION).toBe("1.0");
    expect(IDEA_ANALYSIS_PROMPT.key).toBe("discovery.idea-analysis");
    expect(IDEA_ANALYSIS_PROMPT.version).toBe("1.0");
  });

  it("forbids silent confirmation in boundaries", () => {
    const text = IDEA_ANALYSIS_PROMPT.boundaries.join(" ").toLowerCase();
    expect(text).toContain("confirm");
    expect(text).toContain("assumption");
    expect(IDEA_ANALYSIS_PROMPT.outputSchema).toBe("idea-analysis/v1");
  });

  it("registers idempotently", () => {
    const prompts = registry();
    prompts.register({ ...IDEA_ANALYSIS_PROMPT });
    expect(() => prompts.register({ ...IDEA_ANALYSIS_PROMPT })).toThrow();
    expect(prompts.resolve(IDEA_ANALYSIS_PROMPT_KEY).version).toBe("1.0");
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("analyzeIdea (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, {
      name: "Planner",
      idea: "A calm planner, cuma saya sendiri yang pakai, datanya cukup di browser.",
      targetUsers: "solo founders",
    });
    return { owner, projectId: created.project.id };
  }

  it("produces structured output and leaves canonical state untouched", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `idea-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);

        const result = await analyzeIdea(db, owner.id, projectId, {
          provider: providerFor(VALID_ANALYSIS),
          prompts: registry(),
        });

        expect(result.analysis.summary).toBe(VALID_ANALYSIS.summary);
        expect(result.analysis.knownFacts.length).toBeGreaterThan(0);
        expect(result.analysis.unknownDomains.length).toBeGreaterThan(0);
        expect(result.analysis.candidateDecisions.length).toBeGreaterThan(0);
        expect(result.analysis.assumptions.length).toBeGreaterThan(0);
        // Assumptions stay separate: no candidate decision smuggles ASSUMED.
        for (const decision of result.analysis.candidateDecisions) {
          expect(["EXPLICIT", "INFERRED"]).toContain(decision.confidence);
        }
        expect(result.promptKey).toBe("discovery.idea-analysis");
        expect(result.promptVersion).toBe("1.0");
        expect(result.stateVersion).toBe(versionBefore);

        // Traceable operation, canonical version untouched, no decisions made.
        const operation = await getOperation(db, owner.id, result.operationId);
        expect(operation.status).toBe("SUCCEEDED");
        expect(operation.capability).toBe("idea-analysis");
        expect(operation.operationType).toBe("IDEA_ANALYSIS");
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

  it("failure leaves project creation intact", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `idea-fail-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);

        const dead = new FakeProvider([{ kind: "fail", code: "RATE_LIMITED" }]);
        const failure = await analyzeIdea(db, owner.id, projectId, {
          provider: dead,
          prompts: registry(),
        }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(IdeaAnalysisError);

        // Project still retrievable, version unchanged.
        const project = await getProject(db, owner.id, projectId);
        expect(project.project.id).toBe(projectId);
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);

        // Invalid model output also fails without touching state.
        const hopeless = new FakeProvider([
          { kind: "structured", json: '{"nope":1}' },
          { kind: "structured", json: '{"still":2}' },
        ]);
        const invalid = await analyzeIdea(db, owner.id, projectId, {
          provider: hopeless,
          prompts: registry(),
        }).catch((error: unknown) => error);
        expect(invalid).toBeInstanceOf(IdeaAnalysisError);
        expect(await getProject(db, owner.id, projectId)).toBeDefined();
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects blank owner and cross-user access", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { projectId } = await setup(db, `idea-auth-${Date.now()}@example.com`);
        const [other] = await db
          .insert(schema.users)
          .values({ email: `idea-other-${Date.now()}@example.com` })
          .returning();

        await expect(
          analyzeIdea(db, "  ", projectId, {
            provider: providerFor(VALID_ANALYSIS),
            prompts: registry(),
          }),
        ).rejects.toBeInstanceOf(DiscoveryValidationError);
        await expect(
          analyzeIdea(db, other.id, projectId, {
            provider: providerFor(VALID_ANALYSIS),
            prompts: registry(),
          }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});

describe("idea-analyst boundaries (static)", () => {
  it("never imports provider SDKs or canonical-state writers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/discovery/idea-analyst.ts"),
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
    // Orchestrator is the only AI runtime dependency — provider isolation holds.
    expect(source).toContain("ai/orchestration/orchestrator");
  });
});
