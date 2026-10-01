// TASK-081 acceptance: reproducible dimension/overall scores, blocking
// issues prevent ready, critical assumptions gate when configured,
// explanation available, same state → same readiness.
//
// Unit tests pin validation without a DB. Engine proofs run as
// rolled-back integration tests — skipped, not failed, without
// TEST_DATABASE_URL/DATABASE_URL.
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
import { createAssumption } from "../validation/assumptions";
import { runCompletenessValidation } from "../validation/completeness";
import { runCoverageValidation } from "../validation/coverage";
import { ReadinessValidationError } from "./errors";
import { calculateReadiness } from "./engine";

describe("readiness engine validation (unit, no database)", () => {
  it("rejects blank owners without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(calculateReadiness(db, "  ", "p-1")).rejects.toBeInstanceOf(
      ReadinessValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("readiness engine (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "R", idea: "Ready." });
    return { owner, projectId: created.project.id };
  }

  it("scores a clean project ready and reproduces the report", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `rdy-${Date.now()}@example.com`);

        const first = await calculateReadiness(db, owner.id, projectId);
        const second = await calculateReadiness(db, owner.id, projectId);

        expect(second).toEqual(first);
        expect(first.dimensions).toHaveLength(8);
        expect(first.dimensions.every((dimension) => dimension.score === 100)).toBe(true);
        expect(first.overallScore).toBe(100);
        expect(first.ready).toBe(true);
        expect(first.blockers).toEqual([]);
      });
    } finally {
      await pool.end();
    }
  });

  it("blocks on open BLOCKER issues and critical assumptions, with explanation", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `rdy-b-${Date.now()}@example.com`);
        // MUST requirement without acceptance criteria → BLOCKER completeness finding.
        await createRequirement(db, owner.id, projectId, {
          type: "FUNCTIONAL",
          title: "Sign in",
          description: "Users can sign in.",
          priority: "MUST",
          status: "CONFIRMED",
        });
        await runCompletenessValidation(db, owner.id, projectId);
        await runCoverageValidation(db, owner.id, projectId);
        await createAssumption(db, owner.id, projectId, {
          title: "Session store",
          description: "Sessions live in memory until decided.",
          impact: "HIGH",
          confidence: "LOW",
          source: "AI_ASSUMED",
        });

        const report = await calculateReadiness(db, owner.id, projectId);

        expect(report.ready).toBe(false);
        expect(report.overallScore).toBeLessThan(100);
        const features = report.dimensions.find((dimension) => dimension.dimension === "FEATURES");
        expect(features?.blocking).toBe(true);
        expect(features?.deductions.map((deduction) => deduction.criterionKey)).toContain(
          "features.acceptance-defined",
        );
        const kinds = report.blockers.map((blocker) => blocker.kind).sort();
        expect(kinds).toContain("criterion");
        expect(kinds).toContain("assumption");
        const assumption = report.blockers.find((blocker) => blocker.kind === "assumption");
        expect(assumption?.severity).toBe("BLOCKER");

        // Configured down to LOW: MEDIUM/LOW assumptions stop gating.
        await createAssumption(db, owner.id, projectId, {
          title: "Login copy",
          description: "Button says Start.",
          impact: "LOW",
          confidence: "LOW",
          source: "AI_ASSUMED",
        });
        const lenient = await calculateReadiness(db, owner.id, projectId, {
          criticalAssumptionImpacts: ["HIGH"],
        });
        expect(lenient.blockers.filter((blocker) => blocker.kind === "assumption")).toHaveLength(1);
        const empty = await calculateReadiness(db, owner.id, projectId, {
          criticalAssumptionImpacts: [],
        });
        expect(empty.blockers.filter((blocker) => blocker.kind === "assumption")).toHaveLength(0);
        // ...but the BLOCKER finding still gates.
        expect(empty.ready).toBe(false);
      });
    } finally {
      await pool.end();
    }
  });
});
