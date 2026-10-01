// TASK-113 acceptance: decision change lists known affected requirements,
// affected specification sections, and affected tasks; the user sees impact
// before high-impact propagation. Pure input validation runs everywhere;
// graph proofs skip without a database.
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
import { DecisionNotFoundError, DecisionValidationError } from "../decisions/errors";
import { createDecision } from "../decisions/decisions";
import { createRequirement } from "../requirements/requirements";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { createLink } from "../traceability/traceability";
import { upsertSection } from "../specifications/documents";
import { setSectionDependencies } from "../specifications/dependencies";
import { createUserTask } from "../tasks/user-tasks";
import { ChangeImpactValidationError } from "./errors";
import { previewDecisionChangeImpact, propagateDecisionChangeImpact } from "./change-impact";

describe("change impact validation (unit, no database)", () => {
  const db = {} as AppDatabase;

  it("rejects a missing owner before touching the database", async () => {
    await expect(
      previewDecisionChangeImpact(db, "  ", "p-1", "auth.required"),
    ).rejects.toBeInstanceOf(ChangeImpactValidationError);
    await expect(
      propagateDecisionChangeImpact(db, "", "p-1", "auth.required", {
        acknowledgeHighImpact: true,
      }),
    ).rejects.toBeInstanceOf(ChangeImpactValidationError);
  });

  it("rejects a malformed decision key without a database round-trip", async () => {
    await expect(previewDecisionChangeImpact(db, "u-1", "p-1", "Not A Key")).rejects.toBeInstanceOf(
      DecisionValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("decision change impact (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "I", idea: "Impact." });
    const projectId = created.project.id;

    const low = await createDecision(db, owner.id, projectId, {
      decisionKey: "storage.type",
      category: "DATA",
      title: "Browser storage",
      status: "CONFIRMED",
      impact: "LOW",
      sourceType: "USER",
      confidence: "EXPLICIT",
      value: "local",
    });
    const high = await createDecision(db, owner.id, projectId, {
      decisionKey: "authentication.methods",
      category: "AUTH",
      title: "Auth methods",
      status: "CONFIRMED",
      impact: "HIGH",
      sourceType: "USER",
      confidence: "EXPLICIT",
      value: ["GOOGLE"],
    });
    const requirement = await createRequirement(db, owner.id, projectId, {
      type: "FUNCTIONAL",
      title: "Sign in",
      description: "Users can sign in.",
      priority: "MUST",
      status: "CONFIRMED",
    });
    await createLink(db, owner.id, projectId, {
      source: { type: "DECISION", id: low.id },
      target: { type: "REQUIREMENT", id: requirement.id },
      relationship: "implemented_by",
    });
    await createKnowledgeItem(db, owner.id, projectId, {
      knowledgeKey: "auth.model",
      domain: "TECHNICAL",
      title: "Auth model",
      content: { summary: "Google-only sign in." },
      confidence: "EXPLICIT",
      sources: [{ type: "DECISION", sourceId: low.id }],
    });
    await upsertSection(db, owner.id, projectId, "ARCHITECTURE", {
      sectionKey: "architecture.authentication",
      title: "Authentication",
      renderedContent: "Google only.",
    });
    await setSectionDependencies(
      db,
      owner.id,
      projectId,
      "ARCHITECTURE",
      "architecture.authentication",
      [{ sourceType: "DECISION", sourceId: low.id }],
    );
    await upsertSection(db, owner.id, projectId, "ARCHITECTURE", {
      sectionKey: "architecture.session",
      title: "Session",
      renderedContent: "Session handling.",
    });
    await setSectionDependencies(db, owner.id, projectId, "ARCHITECTURE", "architecture.session", [
      { sourceType: "REQUIREMENT", sourceId: requirement.id },
    ]);
    await createUserTask(db, owner.id, projectId, {
      title: "Implement sign-in",
      objective: "Build the sign-in flow.",
      priority: "P1",
      acceptanceCriteria: ["User can sign in."],
      definitionOfDone: ["Tests pass."],
      references: { requirements: [requirement.requirementCode] },
    });
    return { owner, projectId, low, high, requirement };
  }

  it("previews known downstream effects without mutating anything", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId, low, requirement } = await setup(
          db,
          `imp-${Date.now()}@example.com`,
        );
        const before = await getStateVersion(db, owner.id, projectId);

        const report = await previewDecisionChangeImpact(db, owner.id, projectId, low.decisionKey);

        expect(report.decision).toMatchObject({
          id: low.id,
          decisionCode: low.decisionCode,
          decisionKey: low.decisionKey,
          impact: "LOW",
        });
        expect(report.requiresAcknowledgment).toBe(false);
        expect(report.affectedRequirements.map((r) => r.requirementCode)).toEqual([
          requirement.requirementCode,
        ]);
        // Direct dependent plus the second-hop section via the requirement.
        expect(report.affectedSections.map((s) => `${s.documentType}::${s.sectionKey}`)).toEqual([
          "ARCHITECTURE::architecture.authentication",
          "ARCHITECTURE::architecture.session",
        ]);
        expect(report.affectedSections.every((s) => s.status === "CURRENT")).toBe(true);
        expect(report.affectedTasks.map((t) => t.taskCode)).toEqual(["UTASK-001"]);
        expect(report.affectedKnowledge.map((k) => k.knowledgeKey)).toEqual(["auth.model"]);

        // Read-only proof: version untouched, sections still current.
        expect(await getStateVersion(db, owner.id, projectId)).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });

  it("flags HIGH decisions as requiring acknowledgment", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId, high } = await setup(db, `imp-hi-${Date.now()}@example.com`);
        const report = await previewDecisionChangeImpact(db, owner.id, projectId, high.decisionKey);
        expect(report.requiresAcknowledgment).toBe(true);
        expect(report.affectedRequirements).toEqual([]);
        expect(report.affectedTasks).toEqual([]);
      });
    } finally {
      await pool.end();
    }
  });

  it("reports a missing decision as not found", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `imp-nf-${Date.now()}@example.com`);
        await expect(
          previewDecisionChangeImpact(db, owner.id, projectId, "billing.model"),
        ).rejects.toBeInstanceOf(DecisionNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });

  it("refuses HIGH propagation until the preview is acknowledged", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId, high } = await setup(db, `imp-gate-${Date.now()}@example.com`);
        await expect(
          propagateDecisionChangeImpact(db, owner.id, projectId, high.decisionKey),
        ).rejects.toBeInstanceOf(ChangeImpactValidationError);
        await expect(
          propagateDecisionChangeImpact(db, owner.id, projectId, high.decisionKey, {
            acknowledgeHighImpact: false,
          }),
        ).rejects.toBeInstanceOf(ChangeImpactValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("propagates HIGH decisions once acknowledged and LOW decisions freely", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId, low, high } = await setup(
          db,
          `imp-prop-${Date.now()}@example.com`,
        );

        const propagated = await propagateDecisionChangeImpact(
          db,
          owner.id,
          projectId,
          low.decisionKey,
        );
        expect(propagated.staleSections.map((s) => `${s.documentType}::${s.sectionKey}`)).toEqual([
          "ARCHITECTURE::architecture.authentication",
          "ARCHITECTURE::architecture.session",
        ]);

        // HIGH with an unrelated-to-sections graph still propagates on ack.
        const highResult = await propagateDecisionChangeImpact(
          db,
          owner.id,
          projectId,
          high.decisionKey,
          { acknowledgeHighImpact: true },
        );
        expect(highResult.staleSections).toEqual([]);
      });
    } finally {
      await pool.end();
    }
  });
});
