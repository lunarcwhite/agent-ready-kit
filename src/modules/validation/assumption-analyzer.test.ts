// TASK-075 acceptance: implementation-relevant focus, cosmetic noise
// suppressed, structured output, duplicates normalized, readiness seam
// (impact stored + filterable). Fakes only — no live providers.
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
import { createDecision } from "../decisions/decisions";
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import { validateStructuredOutput } from "../../ai/validation/validator";
import {
  ASSUMPTION_DETECTION_SCHEMA,
  type AssumptionDetection,
} from "../../ai/schemas/assumption-detection";
import {
  ASSUMPTION_DETECTION_PROMPT,
  ASSUMPTION_DETECTION_PROMPT_KEY,
} from "../../ai/prompts/assumption-detection";
import { listAssumptions } from "./assumptions";
import {
  AssumptionAnalyzerError,
  detectAssumptions,
  normalizeDetected,
} from "./assumption-analyzer";

// Representative fixture (agents.md §33): profile-image upload leaves
// storage, size, format, and deletion behavior unspecified.
const UPLOAD_GAPS: AssumptionDetection = {
  assumptions: [
    {
      statement: "Profile image storage provider, max size, and accepted formats are undefined",
      impact: "HIGH",
      confidence: "HIGH",
      area: "ARCHITECTURE",
      requirementCodes: ["FR-010"],
      decisionKeys: [],
      suggestedCheck: "Ask for storage limits and format policy.",
    },
    {
      statement: "Uploaded image deletion behavior on account removal is undefined",
      impact: "MEDIUM",
      confidence: "MEDIUM",
      area: "DATA_MODEL",
      requirementCodes: ["FR-010"],
      decisionKeys: [],
    },
  ],
};

describe("assumption-detection schema (unit, no database)", () => {
  it("accepts representative gap findings", () => {
    expect(validateStructuredOutput(ASSUMPTION_DETECTION_SCHEMA, UPLOAD_GAPS)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("rejects bad areas, bad impact, and extra properties", () => {
    const [first] = UPLOAD_GAPS.assumptions;
    expect(
      validateStructuredOutput(ASSUMPTION_DETECTION_SCHEMA, {
        assumptions: [{ ...first, area: "COSMETIC" }],
      }).ok,
    ).toBe(false);
    expect(
      validateStructuredOutput(ASSUMPTION_DETECTION_SCHEMA, {
        assumptions: [{ ...first, impact: "CRITICAL" }],
      }).ok,
    ).toBe(false);
    expect(
      validateStructuredOutput(ASSUMPTION_DETECTION_SCHEMA, {
        assumptions: [{ ...first, invented: true }],
      }).ok,
    ).toBe(false);
    expect(validateStructuredOutput(ASSUMPTION_DETECTION_SCHEMA, { gaps: [] }).ok).toBe(false);
  });
});

describe("normalizeDetected (unit, no database)", () => {
  const requirements = new Map([["FR-010", "11111111-1111-4111-8111-111111111111"]]);
  const decisions = new Map([["storage.type", "22222222-2222-4222-8222-222222222222"]]);

  it("grounds references and keeps implementation-relevant areas", () => {
    const [first] = UPLOAD_GAPS.assumptions;
    const normalized = normalizeDetected(first, requirements, decisions);
    expect(normalized).not.toBeNull();
    expect(normalized?.impacts).toEqual([
      { targetType: "REQUIREMENT", targetId: "11111111-1111-4111-8111-111111111111" },
    ]);
    expect(normalized?.description).toContain("Ask for storage limits");
    expect(normalized?.dedupeKey).toBeTruthy();
  });

  it("drops cosmetic areas, blank statements, and unknown references", () => {
    const [first] = UPLOAD_GAPS.assumptions;
    expect(normalizeDetected({ ...first, area: "OTHER" }, requirements, decisions)).toBeNull();
    expect(normalizeDetected({ ...first, statement: "  " }, requirements, decisions)).toBeNull();
    // Unknown codes drop the reference, not the finding.
    const orphaned = normalizeDetected(
      { ...first, requirementCodes: ["FR-999"], decisionKeys: ["nope"] },
      requirements,
      decisions,
    );
    expect(orphaned).not.toBeNull();
    expect(orphaned?.impacts).toEqual([]);
    expect(
      normalizeDetected({ ...first, suggestedCheck: "  " }, requirements, decisions),
    ).toBeNull();
  });
});

describe("assumption-detection prompt (unit, no database)", () => {
  it("has a stable key and restricts itself to implementation-relevant gaps", () => {
    expect(ASSUMPTION_DETECTION_PROMPT_KEY).toBe("validation.assumption-detection");
    expect(ASSUMPTION_DETECTION_PROMPT.version).toBe("1.0");
    const text = ASSUMPTION_DETECTION_PROMPT.boundaries.join(" ").toLowerCase();
    expect(text).toContain("cosmetic");
    expect(`${ASSUMPTION_DETECTION_PROMPT.role} `.toLowerCase()).toContain("never confirm");
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("detectAssumptions (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "G", idea: "Photo profiles." });
    return { owner, projectId: created.project.id };
  }

  function providerFor(payload: unknown): FakeProvider {
    return new FakeProvider([{ kind: "structured", json: JSON.stringify(payload) }]);
  }

  it("persists grounded assumptions once and normalizes reruns", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `detect-${Date.now()}@example.com`);

        const first = await detectAssumptions(db, owner.id, projectId, {
          provider: providerFor(UPLOAD_GAPS),
          prompts: new PromptRegistry(),
          cache: null,
        });
        // No requirements exist yet: references drop, findings persist.
        expect(first.findings).toHaveLength(2);
        expect(first.created).toEqual(["ASM-001", "ASM-002"]);
        expect(first.operationId).toBeTruthy();

        const stored = await listAssumptions(db, owner.id, projectId, { status: "OPEN" });
        expect(stored).toHaveLength(2);
        expect(stored[0]?.source).toBe("AI_ASSUMED");
        expect(stored[0]?.impact).toBe("HIGH");
        // Readiness seam: HIGH-impact OPEN assumptions are directly queryable.
        expect(
          await listAssumptions(db, owner.id, projectId, { status: "OPEN", impact: "HIGH" }),
        ).toHaveLength(1);

        // Rerun: same statements skip as duplicates, nothing new created.
        const second = await detectAssumptions(db, owner.id, projectId, {
          provider: providerFor(UPLOAD_GAPS),
          prompts: new PromptRegistry(),
          cache: null,
        });
        expect(second.created).toEqual([]);
        expect(second.skippedDuplicates).toHaveLength(2);
        expect(await listAssumptions(db, owner.id, projectId)).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("links requirement references and suppresses cosmetic findings", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `detect-ref-${Date.now()}@example.com`);
        const decision = await createDecision(db, owner.id, projectId, {
          decisionKey: "storage.type",
          category: "DATA",
          title: "Storage type",
          status: "CONFIRMED",
          impact: "HIGH",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: "local_browser",
        });
        const payload: AssumptionDetection = {
          assumptions: [
            {
              statement: "Browser storage quota for offline data is unmeasured",
              impact: "MEDIUM",
              confidence: "HIGH",
              area: "DATA_MODEL",
              decisionKeys: ["storage.type"],
            },
            {
              statement: "Button label wording could be friendlier",
              impact: "LOW",
              confidence: "LOW",
              area: "OTHER",
            },
          ],
        };
        const report = await detectAssumptions(db, owner.id, projectId, {
          provider: providerFor(payload),
          prompts: new PromptRegistry(),
          cache: null,
        });
        expect(report.created).toHaveLength(1);
        expect(report.droppedCosmetic).toBe(1);
        const [row] = await listAssumptions(db, owner.id, projectId);
        expect(row?.impacts).toEqual([
          expect.objectContaining({ targetType: "DECISION", targetId: decision.id }),
        ]);
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
        const { owner, projectId } = await setup(db, `detect-fail-${Date.now()}@example.com`);
        const failing = new FakeProvider([
          { kind: "fail", code: "PROVIDER_UNAVAILABLE", message: "Down." },
        ]);
        await expect(
          detectAssumptions(db, owner.id, projectId, {
            provider: failing,
            prompts: new PromptRegistry(),
            cache: null,
          }),
        ).rejects.toBeInstanceOf(AssumptionAnalyzerError);
        expect(await listAssumptions(db, owner.id, projectId)).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });
});
