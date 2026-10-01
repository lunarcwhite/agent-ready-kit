// TASK-073 acceptance: relevant pairs selected, structured issue schema,
// sources identified, low-confidence noise suppressed, no direct state
// rewrite, resolvable conflicts. Fakes only — no live providers.
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
import { upsertSection } from "../specifications/documents";
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import { validateStructuredOutput } from "../../ai/validation/validator";
import {
  SEMANTIC_VALIDATION_SCHEMA,
  type SemanticIssue,
  type SemanticValidation,
} from "../../ai/schemas/semantic-validation";
import {
  SEMANTIC_VALIDATION_PROMPT,
  SEMANTIC_VALIDATION_PROMPT_KEY,
} from "../../ai/prompts/semantic-validation";
import { listIssues, resolveIssue } from "./issues";
import {
  normalizeFinding,
  runSemanticValidation,
  selectActionableFindings,
  selectValidationPairs,
  SEMANTIC_RULE,
  SEMANTIC_VALIDATOR,
  SemanticValidatorError,
  type ValidationPair,
} from "./semantic";
import type { SpecificationSectionRow } from "../specifications/documents";

// Representative fixture (FR-061 example): PRD mandates Google-only auth
// while the design spec contains a password flow.
const AUTH_CONTRADICTION: SemanticValidation = {
  issues: [
    {
      title: "Password authentication in design contradicts Google-only PRD",
      description:
        "PRD requires Google-only sign-in with no passwords, but the design login form includes a password field and forgot-password flow.",
      severity: "BLOCKER",
      confidence: "HIGH",
      pair: "PRD::ARCHITECTURE",
      sources: [
        { documentType: "PRD", sectionKey: "product.auth" },
        { documentType: "ARCHITECTURE", sectionKey: "architecture.authentication" },
      ],
      suggestedResolution: "Decide whether passwords are supported, then align both specs.",
    },
  ],
};

function pairMap(pairs: ValidationPair[]): Map<string, ValidationPair> {
  return new Map(pairs.map((pair) => [pair.key, pair]));
}

function sectionIndex(
  entries: Array<{ documentType: string; sectionKey: string; title?: string }>,
): Map<string, SpecificationSectionRow> {
  const map = new Map<string, SpecificationSectionRow>();
  for (const entry of entries) {
    map.set(`${entry.documentType}::${entry.sectionKey}`, {
      id: `00000000-0000-4000-8000-${String(map.size).padStart(12, "0")}`,
      documentId: "00000000-0000-4000-8000-000000000000",
      sectionKey: entry.sectionKey,
      title: entry.title ?? entry.sectionKey,
      sortOrder: 0,
      structuredContent: null,
      renderedContent: "",
      status: "CURRENT",
      dependencyHash: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
  }
  return map;
}

const PAIRS = pairMap(selectValidationPairs(["PRD", "ARCHITECTURE", "DESIGN", "DATABASE_SCHEMA"]));
const SECTIONS = sectionIndex([
  { documentType: "PRD", sectionKey: "product.auth", title: "Authentication" },
  {
    documentType: "ARCHITECTURE",
    sectionKey: "architecture.authentication",
    title: "Authentication Strategy",
  },
]);

describe("semantic-validation schema (unit, no database)", () => {
  it("accepts a representative contradiction payload", () => {
    expect(validateStructuredOutput(SEMANTIC_VALIDATION_SCHEMA, AUTH_CONTRADICTION)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("rejects bad severity, bad confidence, missing sources, and extra properties", () => {
    const [issue] = AUTH_CONTRADICTION.issues;
    expect(
      validateStructuredOutput(SEMANTIC_VALIDATION_SCHEMA, {
        issues: [{ ...issue, severity: "CRITICAL" }],
      }).ok,
    ).toBe(false);
    expect(
      validateStructuredOutput(SEMANTIC_VALIDATION_SCHEMA, {
        issues: [{ ...issue, confidence: "CERTAIN" }],
      }).ok,
    ).toBe(false);
    expect(
      validateStructuredOutput(SEMANTIC_VALIDATION_SCHEMA, { issues: [{ ...issue, sources: [] }] })
        .ok,
    ).toBe(true);
    expect(
      validateStructuredOutput(SEMANTIC_VALIDATION_SCHEMA, {
        issues: [{ ...issue, sources: [{ documentType: "PRD" }] }],
      }).ok,
    ).toBe(false);
    expect(
      validateStructuredOutput(SEMANTIC_VALIDATION_SCHEMA, {
        issues: [{ ...issue, invented: true }],
      }).ok,
    ).toBe(false);
    expect(validateStructuredOutput(SEMANTIC_VALIDATION_SCHEMA, { conflicts: [] }).ok).toBe(false);
  });
});

describe("selectValidationPairs (unit, no database)", () => {
  it("selects relevant pairs in priority order and excludes missing documents", () => {
    expect(selectValidationPairs(["PRD", "ARCHITECTURE"]).map((pair) => pair.key)).toEqual([
      "PRD::ARCHITECTURE",
    ]);
    expect(
      selectValidationPairs(["DESIGN", "DATABASE_SCHEMA", "ARCHITECTURE", "PRD"]).map(
        (pair) => pair.key,
      ),
    ).toEqual([
      "PRD::ARCHITECTURE",
      "PRD::DESIGN",
      "PRD::DATABASE_SCHEMA",
      "ARCHITECTURE::DATABASE_SCHEMA",
    ]);
    expect(selectValidationPairs(["PRD"])).toEqual([]);
    expect(selectValidationPairs([])).toEqual([]);
  });

  it("is deterministic and case-insensitive", () => {
    const first = selectValidationPairs(["prd", "architecture", "design"]);
    const second = selectValidationPairs(["DESIGN", "PRD", "ARCHITECTURE"]);
    expect(first).toEqual(second);
  });
});

describe("finding normalization (unit, no database)", () => {
  it("normalizes a grounded finding with identified sources", () => {
    const [issue] = AUTH_CONTRADICTION.issues;
    const normalized = normalizeFinding(issue, PAIRS, SECTIONS);
    expect(normalized).not.toBeNull();
    expect(normalized?.rule).toBe(SEMANTIC_RULE);
    expect(normalized?.severity).toBe("BLOCKER");
    expect(normalized?.title).toContain("PRD ↔ ARCHITECTURE");
    expect(normalized?.description).toContain("product.auth");
    expect(normalized?.description).toContain("architecture.authentication");
    expect(normalized?.description).toContain("Decide whether passwords are supported");
    expect(normalized?.targetKey.startsWith("prd-architecture::")).toBe(true);
  });

  it("drops blank text, unknown pairs, empty sources, and unresolvable sections", () => {
    const [issue] = AUTH_CONTRADICTION.issues;
    expect(normalizeFinding({ ...issue, title: "  " }, PAIRS, SECTIONS)).toBeNull();
    expect(normalizeFinding({ ...issue, description: "" }, PAIRS, SECTIONS)).toBeNull();
    expect(normalizeFinding({ ...issue, pair: "PRD::SOUL" }, PAIRS, SECTIONS)).toBeNull();
    expect(normalizeFinding({ ...issue, sources: [] }, PAIRS, SECTIONS)).toBeNull();
    expect(
      normalizeFinding(
        { ...issue, sources: [{ documentType: "PRD", sectionKey: "product.missing" }] },
        PAIRS,
        SECTIONS,
      ),
    ).toBeNull();
    // A DESIGN source does not belong to a PRD::ARCHITECTURE finding.
    expect(
      normalizeFinding(
        {
          ...issue,
          sources: [
            { documentType: "PRD", sectionKey: "product.auth" },
            { documentType: "DESIGN", sectionKey: "design.login" },
          ],
        },
        pairMap(selectValidationPairs(["PRD", "ARCHITECTURE", "DESIGN"])),
        sectionIndex([
          { documentType: "PRD", sectionKey: "product.auth" },
          { documentType: "DESIGN", sectionKey: "design.login" },
        ]),
      ),
    ).toBeNull();
    expect(
      normalizeFinding({ ...issue, suggestedResolution: "  " } as SemanticIssue, PAIRS, SECTIONS),
    ).toBeNull();
  });

  it("suppresses LOW-confidence findings while keeping HIGH and MEDIUM", () => {
    const [issue] = AUTH_CONTRADICTION.issues;
    const actionable = selectActionableFindings([
      issue,
      { ...issue, title: "Medium signal", confidence: "MEDIUM" },
      { ...issue, title: "Stylistic wording difference", confidence: "LOW" },
    ]);
    expect(actionable.map((entry) => entry.title)).toEqual([issue.title, "Medium signal"]);
  });
});

describe("semantic-validation prompt (unit, no database)", () => {
  it("has a stable key and suppresses stylistic noise", () => {
    expect(SEMANTIC_VALIDATION_PROMPT_KEY).toBe("validation.semantic-consistency");
    expect(SEMANTIC_VALIDATION_PROMPT.version).toBe("1.0");
    const text = SEMANTIC_VALIDATION_PROMPT.boundaries.join(" ").toLowerCase();
    expect(text).toContain("stylistic");
    expect(`${SEMANTIC_VALIDATION_PROMPT.role} `.toLowerCase()).toContain("never rewrite");
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("runSemanticValidation (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "V", idea: "A notes app." });
    const projectId = created.project.id;
    await upsertSection(db, owner.id, projectId, "PRD", {
      sectionKey: "product.auth",
      title: "Authentication",
      renderedContent: "Sign-in is Google-only. No passwords are supported.",
    });
    await upsertSection(db, owner.id, projectId, "ARCHITECTURE", {
      sectionKey: "architecture.authentication",
      title: "Authentication Strategy",
      renderedContent: "Login form with email, password field, and forgot-password flow.",
    });
    return { owner, projectId };
  }

  function providerFor(payload: unknown): FakeProvider {
    return new FakeProvider([{ kind: "structured", json: JSON.stringify(payload) }]);
  }

  it("persists contradictions as resolvable CONSISTENCY issues without duplicates", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `semantic-${Date.now()}@example.com`);

        const first = await runSemanticValidation(db, owner.id, projectId, {
          provider: providerFor(AUTH_CONTRADICTION),
          prompts: new PromptRegistry(),
          cache: null,
        });
        expect(first.pairs).toEqual(["PRD::ARCHITECTURE"]);
        expect(first.findings).toHaveLength(1);
        expect(first.suppressed).toBe(0);
        expect(first.created).toHaveLength(1);
        expect(first.operationId).not.toBeNull();

        const issues = await listIssues(db, owner.id, projectId, { type: "CONSISTENCY" });
        expect(issues).toHaveLength(1);
        expect(issues[0]?.severity).toBe("BLOCKER");
        expect(issues[0]?.description).toContain("product.auth");
        expect(issues[0]?.metadata?.["validator"]).toBe(SEMANTIC_VALIDATOR);

        // Rerun with the same model output: no duplicate issue.
        const second = await runSemanticValidation(db, owner.id, projectId, {
          provider: providerFor(AUTH_CONTRADICTION),
          prompts: new PromptRegistry(),
          cache: null,
        });
        expect(second.created).toHaveLength(0);
        expect(second.unchangedOpen).toEqual(first.created);

        // The user can resolve the detected conflict through TASK-070.
        const code = first.created[0];
        expect(code).toBeDefined();
        const resolved = await resolveIssue(
          db,
          owner.id,
          projectId,
          code as string,
          "Aligned on passwords.",
        );
        expect(resolved.status).toBe("RESOLVED");
      });
    } finally {
      await pool.end();
    }
  });

  it("short-circuits without an AI call when nothing is comparable", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `semantic-empty-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "W", idea: "A timer." });
        const provider = providerFor(AUTH_CONTRADICTION);
        const report = await runSemanticValidation(db, owner.id, created.project.id, {
          provider,
          prompts: new PromptRegistry(),
          cache: null,
        });
        expect(report.pairs).toEqual([]);
        expect(report.findings).toEqual([]);
        expect(report.operationId).toBeNull();
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
        const { owner, projectId } = await setup(db, `semantic-fail-${Date.now()}@example.com`);
        const failing = new FakeProvider([
          { kind: "fail", code: "PROVIDER_UNAVAILABLE", message: "Down." },
        ]);
        await expect(
          runSemanticValidation(db, owner.id, projectId, {
            provider: failing,
            prompts: new PromptRegistry(),
            cache: null,
          }),
        ).rejects.toBeInstanceOf(SemanticValidatorError);
        const issues = await listIssues(db, owner.id, projectId, { type: "CONSISTENCY" });
        expect(issues).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });
});
