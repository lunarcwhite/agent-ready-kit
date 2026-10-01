// TASK-076 acceptance: mandatory coverage per requirement type creates
// issues, not-applicable relationships stay silent, rules are
// configurable, coverage is inspectable per requirement. Pure rule-shape
// tests run everywhere; graph proofs skip without a database.
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
import { createUserTask, updateUserTask } from "../tasks/user-tasks";
import { createLink } from "../traceability/traceability";
import { createComponent, updateComponent } from "../architecture/components";
import { createScreen } from "../architecture/screens";
import { createEntity } from "../entities/entities";
import { listIssues } from "./issues";
import {
  COVERAGE_RULES,
  COVERAGE_VALIDATOR,
  getRequirementCoverage,
  runCoverageValidation,
} from "./coverage";

describe("coverage rules (unit, no database)", () => {
  it("mandates architecture and tasks for behavior and rules, nothing for NFRs and constraints", () => {
    expect(COVERAGE_RULES["FUNCTIONAL"]?.mandatory).toEqual(["ARCHITECTURE", "TASK"]);
    expect(COVERAGE_RULES["BUSINESS_RULE"]?.mandatory).toEqual(["ARCHITECTURE", "TASK"]);
    expect(COVERAGE_RULES["NON_FUNCTIONAL"]?.mandatory).toEqual([]);
    expect(COVERAGE_RULES["CONSTRAINT"]?.mandatory).toEqual([]);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("requirement coverage (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "C", idea: "Coverage." });
    return { owner, projectId: created.project.id };
  }

  const MUST_FUNCTIONAL = {
    type: "FUNCTIONAL" as const,
    title: "Sign in",
    description: "Users can sign in.",
    priority: "MUST" as const,
    status: "CONFIRMED" as const,
  };

  it("flags MUST requirements without an architecture mapping as BLOCKER", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cov-${Date.now()}@example.com`);
        await createRequirement(db, owner.id, projectId, MUST_FUNCTIONAL);

        const report = await runCoverageValidation(db, owner.id, projectId);
        expect(report.findings).toHaveLength(2);
        expect(report.created).toHaveLength(2);

        const issues = await listIssues(db, owner.id, projectId, {
          type: "IMPLEMENTATION_COVERAGE",
        });
        expect(issues).toHaveLength(2);
        expect(issues[0]).toMatchObject({
          severity: "BLOCKER",
          title: "FR-001 has no architecture mapping",
        });
        expect(issues[1]).toMatchObject({
          severity: "BLOCKER",
          title: "FR-001 has no task mapping",
        });
        expect(issues[0]?.metadata?.["validator"]).toBe(COVERAGE_VALIDATOR);
        expect(issues[0]?.references).toHaveLength(1);

        // Rerun without changes: no duplicates.
        const rerun = await runCoverageValidation(db, owner.id, projectId);
        expect(rerun.created).toHaveLength(0);
        expect(rerun.unchangedOpen).toEqual(report.created);
      });
    } finally {
      await pool.end();
    }
  });

  it("resolves when linked and ignores withdrawn targets", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cov-link-${Date.now()}@example.com`);
        const requirement = await createRequirement(db, owner.id, projectId, MUST_FUNCTIONAL);
        const component = await createComponent(db, owner.id, projectId, {
          name: "AuthService",
          status: "DRAFT",
        });
        await createLink(db, owner.id, projectId, {
          source: { type: "REQUIREMENT", id: requirement.id },
          target: { type: "ARC", id: component.id },
          relationship: "implemented_by",
        });
        await createUserTask(db, owner.id, projectId, {
          title: "Implement sign-in",
          objective: "Build the sign-in flow.",
          priority: "P1",
          acceptanceCriteria: ["User can sign in."],
          definitionOfDone: ["Tests pass."],
          references: { requirements: [requirement.requirementCode] },
        });

        const covered = await runCoverageValidation(db, owner.id, projectId);
        expect(covered.findings).toHaveLength(0);

        const inspection = await getRequirementCoverage(db, owner.id, projectId, "FR-001");
        expect(inspection.missingMandatory).toEqual([]);
        expect(inspection.kinds.ARCHITECTURE).toMatchObject({
          covered: true,
          linkCount: 1,
          mandatory: true,
        });
        expect(inspection.kinds.TASK).toMatchObject({
          covered: true,
          linkCount: 1,
          mandatory: true,
        });
        expect(inspection.implementingTasks).toEqual([
          { taskCode: "UTASK-001", title: "Implement sign-in", status: "PENDING" },
        ]);
        expect(inspection.kinds.DESIGN).toMatchObject({ covered: false, mandatory: false });

        // Withdrawing the component voids the coverage: the gap reopens.
        await updateComponent(db, owner.id, projectId, component.componentCode, {
          status: "REMOVED",
        });
        const reopened = await runCoverageValidation(db, owner.id, projectId);
        expect(reopened.findings).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("stays silent for WONT, DEFERRED, and non-mandatory types", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cov-quiet-${Date.now()}@example.com`);
        await createRequirement(db, owner.id, projectId, {
          ...MUST_FUNCTIONAL,
          title: "Out of scope",
          priority: "WONT",
        });
        await createRequirement(db, owner.id, projectId, {
          ...MUST_FUNCTIONAL,
          title: "Parked",
          status: "DEFERRED",
        });
        await createRequirement(db, owner.id, projectId, {
          type: "NON_FUNCTIONAL",
          title: "Fast",
          description: "Responds quickly.",
          priority: "MUST",
          status: "CONFIRMED",
        });
        await createRequirement(db, owner.id, projectId, {
          type: "CONSTRAINT",
          title: "Postgres",
          description: "Uses Postgres.",
          priority: "MUST",
          status: "CONFIRMED",
        });

        const report = await runCoverageValidation(db, owner.id, projectId);
        expect(report.findings).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("scales severity by priority and accepts rule overrides", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cov-sev-${Date.now()}@example.com`);
        await createRequirement(db, owner.id, projectId, {
          ...MUST_FUNCTIONAL,
          title: "Should have",
          priority: "SHOULD",
        });
        await createRequirement(db, owner.id, projectId, {
          ...MUST_FUNCTIONAL,
          title: "Could have",
          priority: "COULD",
        });

        const report = await runCoverageValidation(db, owner.id, projectId);
        const severities = report.findings.map((finding) => finding.severity).sort();
        expect(severities).toEqual(["HIGH", "HIGH", "MEDIUM", "MEDIUM"]);

        // Configurable rules: an empty mandatory set silences the validator.
        const silenced = await runCoverageValidation(db, owner.id, projectId, {
          FUNCTIONAL: { mandatory: [] },
        });
        expect(silenced.findings).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("covers DESIGN and DATA kinds through screens and entities", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cov-kinds-${Date.now()}@example.com`);
        const requirement = await createRequirement(db, owner.id, projectId, MUST_FUNCTIONAL);
        const screen = await createScreen(db, owner.id, projectId, {
          name: "Login",
          status: "CONFIRMED",
        });
        const entity = await createEntity(db, owner.id, projectId, {
          name: "User",
          status: "CONFIRMED",
        });
        await createLink(db, owner.id, projectId, {
          source: { type: "REQUIREMENT", id: requirement.id },
          target: { type: "SCREEN", id: screen.id },
          relationship: "surfaced_by",
        });
        await createLink(db, owner.id, projectId, {
          source: { type: "REQUIREMENT", id: requirement.id },
          target: { type: "ENT", id: entity.id },
          relationship: "stored_as",
        });

        const inspection = await getRequirementCoverage(db, owner.id, projectId, "FR-001");
        expect(inspection.kinds.DESIGN).toMatchObject({ covered: true, linkCount: 1 });
        expect(inspection.kinds.DATA).toMatchObject({ covered: true, linkCount: 1 });
        expect(inspection.missingMandatory).toEqual(["ARCHITECTURE", "TASK"]);
        expect(inspection.implementingTasks).toEqual([]);
      });
    } finally {
      await pool.end();
    }
  });

  it("requires implementing tasks and reopens when references are removed", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cov-task-${Date.now()}@example.com`);
        const requirement = await createRequirement(db, owner.id, projectId, MUST_FUNCTIONAL);
        const component = await createComponent(db, owner.id, projectId, {
          name: "AuthService",
          status: "DRAFT",
        });
        await createLink(db, owner.id, projectId, {
          source: { type: "REQUIREMENT", id: requirement.id },
          target: { type: "ARC", id: component.id },
          relationship: "implemented_by",
        });

        // Architecture covered, tasks missing: exactly the task gap.
        const gap = await runCoverageValidation(db, owner.id, projectId);
        expect(gap.findings).toHaveLength(1);
        expect(gap.findings[0]).toMatchObject({
          rule: "coverage:fr:task",
          targetKey: requirement.requirementCode,
          severity: "BLOCKER",
        });

        const task = await createUserTask(db, owner.id, projectId, {
          title: "Implement sign-in",
          objective: "Build the sign-in flow.",
          priority: "P1",
          acceptanceCriteria: ["User can sign in."],
          definitionOfDone: ["Tests pass."],
          references: { requirements: [requirement.requirementCode] },
        });
        const covered = await runCoverageValidation(db, owner.id, projectId);
        expect(covered.findings).toHaveLength(0);

        // Removing the reference is the operative "deletion" (task rows are
        // never hard-deleted): the gap reopens instead of duplicating.
        await updateUserTask(db, owner.id, projectId, task.taskCode, { references: null });
        const reopened = await runCoverageValidation(db, owner.id, projectId);
        expect(reopened.findings).toHaveLength(1);
        expect(reopened.findings[0]?.rule).toBe("coverage:fr:task");
        expect(reopened.reopened).toHaveLength(1);
        expect(reopened.created).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });
});
