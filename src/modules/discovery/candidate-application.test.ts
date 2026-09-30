// TASK-054 acceptance: pre-persistence validation, explicit→confirmed,
// inferred→recommended (never auto-confirmed), dependency execution,
// provenance, atomic version updates, failed transactions leave state
// intact. Pure mapping tests run without a database.
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
import { createDecision, getDecisionByKey, getDecisionHistory } from "../decisions/decisions";
import { registerDependency } from "../decisions/dependencies";
import { ensureDiscoveryMap } from "./discovery";
import type { AnswerInterpretation } from "../../ai/schemas/answer-interpretation";
import {
  applyInterpretation,
  classifyDecisionImpact,
  deriveDecisionCategory,
  humanizeDecisionTitle,
  parseAppliedCodes,
} from "./candidate-application";

const PERSONAL_APP: AnswerInterpretation = {
  decisions: [
    { key: "multi_user", value: false, confidence: "EXPLICIT", rationale: "Single user." },
    {
      key: "authentication.required",
      value: false,
      confidence: "EXPLICIT",
      rationale: "No login.",
    },
    { key: "storage.type", value: "local_browser", confidence: "EXPLICIT", rationale: "Browser." },
    {
      key: "collaboration",
      value: "NOT_APPLICABLE",
      confidence: "INFERRED",
      rationale: "Implied.",
    },
  ],
  assumptions: [{ statement: "Quota suffices", impact: "MEDIUM" }],
  unresolved: [{ topic: "access.session", question: "Session length?" }],
};

describe("candidate mapping (unit, no database)", () => {
  it("derives stable categories within the identifier contract", () => {
    expect(deriveDecisionCategory("authentication.required")).toBe("AUTH");
    expect(deriveDecisionCategory("multi_user")).toBe("USER");
    expect(deriveDecisionCategory("billing.provider")).toBe("BILL");
    expect(deriveDecisionCategory("ux")).toBe("UX");
    // Unknown prefixes fall back deterministically and stay valid.
    expect(deriveDecisionCategory("telemetry.enabled")).toBe("TELEMETR");
    expect(deriveDecisionCategory("a.b")).toBe("AX");
    for (const key of ["authentication.required", "telemetry.enabled", "a.b", "x"]) {
      expect(deriveDecisionCategory(key)).toMatch(/^[A-Z0-9]{2,8}$/);
    }
  });

  it("humanizes titles and classifies foundational impact HIGH", () => {
    expect(humanizeDecisionTitle("authentication.required")).toBe("Authentication required");
    expect(humanizeDecisionTitle("multi_user")).toBe("Multi user");
    expect(classifyDecisionImpact("authentication.required")).toBe("HIGH");
    expect(classifyDecisionImpact("payment.provider")).toBe("HIGH");
    expect(classifyDecisionImpact("ux.theme")).toBe("MEDIUM");
    // Impact never understates to LOW for machine-applied candidates.
    expect(classifyDecisionImpact("anything.else")).not.toBe("LOW");
  });

  it("parses applied codes for the summary without trusting raw input", () => {
    expect(parseAppliedCodes(undefined)).toEqual([]);
    expect(parseAppliedCodes("  ")).toEqual([]);
    expect(parseAppliedCodes("dec-auth-001, DEC-AUTH-001, , DEC-USER-002")).toEqual([
      "DEC-AUTH-001",
      "DEC-USER-002",
    ]);
    expect(parseAppliedCodes("x".repeat(33))).toEqual([]);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("applyInterpretation (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "A", idea: "Personal planner." });
    await ensureDiscoveryMap(db, owner.id, created.project.id);
    return { owner, projectId: created.project.id };
  }

  it("confirms explicit decisions and recommends inferred ones with provenance", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `apply-${Date.now()}@example.com`);
        const before = await getStateVersion(db, owner.id, projectId);

        const result = await applyInterpretation(db, owner.id, projectId, PERSONAL_APP);

        expect(result.applied).toHaveLength(4);
        expect(result.assumptionsDeferred).toBe(1);
        expect(result.unresolvedDeferred).toBe(1);
        expect(result.stateVersionBefore).toBe(before);
        expect(result.stateVersionAfter).toBe(before + 4);

        const auth = await getDecisionByKey(db, owner.id, projectId, "authentication.required");
        expect(auth.status).toBe("CONFIRMED");
        expect(auth.decisionCode).toBe("DEC-AUTH-001");
        expect(auth.impact).toBe("HIGH");
        const collab = result.applied.find((row) => row.decisionKey === "collaboration");
        expect(collab?.status).toBe("RECOMMENDED");
        expect(collab?.provenance).toBe("AI_RECOMMENDED");
        const explicit = result.applied.find((row) => row.decisionKey === "multi_user");
        expect(explicit?.provenance).toBe("USER_EXPLICIT");

        // History recorded every accepted change.
        const history = await getDecisionHistory(db, owner.id, projectId, "multi_user");
        expect(history.length).toBeGreaterThanOrEqual(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("upgrades recommendations on explicit restatement but never downgrades confirmed state", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `apply-up-${Date.now()}@example.com`);
        await createDecision(db, owner.id, projectId, {
          decisionKey: "storage.type",
          category: "data",
          title: "Storage type",
          status: "RECOMMENDED",
          impact: "MEDIUM",
          sourceType: "AI_RECOMMENDATION",
          confidence: "INFERRED",
          value: "cloud",
        });
        await createDecision(db, owner.id, projectId, {
          decisionKey: "ux.theme",
          category: "ux",
          title: "UX theme",
          status: "CONFIRMED",
          impact: "MEDIUM",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: "dark",
        });

        const result = await applyInterpretation(db, owner.id, projectId, {
          decisions: [
            {
              key: "storage.type",
              value: "local_browser",
              confidence: "EXPLICIT",
              rationale: "User said browser.",
            },
            { key: "ux.theme", value: "light", confidence: "INFERRED", rationale: "Weak hint." },
          ],
          assumptions: [],
          unresolved: [],
        });

        const storage = await getDecisionByKey(db, owner.id, projectId, "storage.type");
        expect(storage.status).toBe("CONFIRMED");
        expect(storage.value).toBe("local_browser");
        expect(storage.sourceType).toBe("USER");
        // Weaker inference cannot overwrite confirmed state.
        const theme = await getDecisionByKey(db, owner.id, projectId, "ux.theme");
        expect(theme.status).toBe("CONFIRMED");
        expect(theme.value).toBe("dark");
        const actions = Object.fromEntries(
          result.applied.map((row) => [row.decisionKey, row.action]),
        );
        expect(actions["storage.type"]).toBe("updated");
        expect(actions["ux.theme"]).toBe("unchanged");
      });
    } finally {
      await pool.end();
    }
  });

  it("executes decision dependencies and validates the whole batch first", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `apply-dep-${Date.now()}@example.com`);
        await createDecision(db, owner.id, projectId, {
          decisionKey: "authentication.required",
          category: "auth",
          title: "Authentication required",
          status: "UNRESOLVED",
          impact: "HIGH",
          sourceType: "SYSTEM",
          confidence: "INFERRED",
          value: null,
        });
        await createDecision(db, owner.id, projectId, {
          decisionKey: "authentication.methods",
          category: "auth",
          title: "Authentication methods",
          status: "UNRESOLVED",
          impact: "HIGH",
          sourceType: "SYSTEM",
          confidence: "INFERRED",
          value: ["GOOGLE"],
        });
        await registerDependency(db, owner.id, projectId, {
          sourceKey: "authentication.required",
          targetKey: "authentication.methods",
          condition: { equals: false },
          effect: "MARK_NOT_APPLICABLE",
        });
        const before = await getStateVersion(db, owner.id, projectId);

        await applyInterpretation(db, owner.id, projectId, {
          decisions: [{ key: "authentication.required", value: false, confidence: "EXPLICIT" }],
          assumptions: [],
          unresolved: [],
        });
        const methods = await getDecisionByKey(db, owner.id, projectId, "authentication.methods");
        expect(methods.status).toBe("NOT_APPLICABLE");

        // One bad key rejects the batch: nothing applied, version untouched.
        const versionBeforeBad = await getStateVersion(db, owner.id, projectId);
        await expect(
          applyInterpretation(db, owner.id, projectId, {
            decisions: [
              { key: "ux.theme", value: "dark", confidence: "EXPLICIT" },
              { key: "Has Spaces", value: true, confidence: "EXPLICIT" },
            ],
            assumptions: [],
            unresolved: [],
          }),
        ).rejects.toThrow();
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBeforeBad);
        await expect(getDecisionByKey(db, owner.id, projectId, "ux.theme")).rejects.toThrow();
        expect(before).toBeLessThan(versionBeforeBad);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects cross-user application", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { projectId } = await setup(db, `apply-auth-${Date.now()}@example.com`);
        const [other] = await db
          .insert(schema.users)
          .values({ email: `apply-other-${Date.now()}@example.com` })
          .returning();
        await expect(
          applyInterpretation(db, other.id, projectId, PERSONAL_APP),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});

describe("candidate-application boundaries (static)", () => {
  it("never imports provider SDKs or AI orchestration", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/discovery/candidate-application.ts"),
      "utf-8",
    );
    const runtimeImports = source
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type"));
    const forbidden = [
      "ai/providers/openai",
      "ai/providers/anthropic",
      "ai/orchestration/orchestrator",
      "openai",
      "@anthropic",
    ];
    for (const line of runtimeImports) {
      for (const banned of forbidden) {
        expect(line).not.toContain(banned);
      }
    }
  });
});
