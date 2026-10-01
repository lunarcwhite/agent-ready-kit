// TASK-071 acceptance: deterministic rules, same state same findings,
// no duplicate issues across reruns, fixed findings resolve and regressed
// findings reopen.
//
// Unit tests pin validation without a database. Row-level proofs run as
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
import { createDecision, updateDecision } from "../decisions/decisions";
import { createEntity } from "../entities/entities";
import { createRequirement, updateRequirement } from "../requirements/requirements";
import { IssueValidationError } from "./errors";
import { listIssues, resolveIssue, updateIssue } from "./issues";
import { collectCompletenessFindings, runCompletenessValidation } from "./completeness";

describe("completeness validation input", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(collectCompletenessFindings(db, "  ", "p-1")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
    await expect(runCompletenessValidation(db, "", "p-1")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("deterministic completeness validator (integration)", () => {
  async function setupMixedProject(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "V", idea: "completeness" });
    const pid = project.project.id;
    const undecided = await createDecision(db, owner.id, pid, {
      decisionKey: "authentication.required",
      category: "auth",
      title: "Authentication required",
      status: "UNRESOLVED",
      impact: "HIGH",
      sourceType: "USER",
      confidence: "EXPLICIT",
    });
    const minorUndecided = await createDecision(db, owner.id, pid, {
      decisionKey: "ui.theme",
      category: "ux",
      title: "Theme",
      status: "UNRESOLVED",
      impact: "LOW",
      sourceType: "USER",
      confidence: "EXPLICIT",
    });
    await createDecision(db, owner.id, pid, {
      decisionKey: "legacy.export",
      category: "scope",
      title: "Legacy export",
      status: "DEFERRED",
      impact: "HIGH",
      sourceType: "USER",
      confidence: "EXPLICIT",
    });
    const emptyConfirm = await createDecision(db, owner.id, pid, {
      decisionKey: "storage.type",
      category: "data",
      title: "Storage type",
      status: "CONFIRMED",
      impact: "MEDIUM",
      sourceType: "USER",
      confidence: "EXPLICIT",
    });
    await createDecision(db, owner.id, pid, {
      decisionKey: "billing.required",
      category: "billing",
      title: "Billing required",
      status: "CONFIRMED",
      impact: "HIGH",
      sourceType: "USER",
      confidence: "EXPLICIT",
      value: false,
    });
    const must = await createRequirement(db, owner.id, pid, {
      type: "FUNCTIONAL",
      title: "Login",
      description: "Users can log in.",
      priority: "MUST",
      status: "CONFIRMED",
    });
    await createRequirement(db, owner.id, pid, {
      type: "FUNCTIONAL",
      title: "Search",
      description: "Users can search.",
      priority: "SHOULD",
      status: "DRAFT",
      acceptanceCriteria: ["Results rank by recency"],
    });
    await createRequirement(db, owner.id, pid, {
      type: "FUNCTIONAL",
      title: "Themes",
      description: "Extra themes.",
      priority: "COULD",
      status: "DRAFT",
    });
    await createEntity(db, owner.id, pid, { name: "Session", status: "DRAFT" });
    await createEntity(db, owner.id, pid, {
      name: "User",
      status: "CONFIRMED",
      attributes: [{ name: "email", dataType: "text", required: true }],
    });
    return { owner, pid, undecided, minorUndecided, emptyConfirm, must };
  }

  it("finds exactly the gaps with calibrated severities", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupMixedProject(db, `comp-${Date.now()}@example.com`);

        const first = await runCompletenessValidation(db, owner.id, pid);
        expect(first.findings).toHaveLength(5);
        const byRule = new Map(first.findings.map((finding) => [finding.rule, finding]));
        const unresolved = first.findings
          .filter((finding) => finding.rule === "decision-unresolved")
          .map((finding) => finding.severity)
          .sort();
        expect(unresolved).toEqual(["HIGH", "LOW"]);
        expect(byRule.get("requirement-missing-acceptance")?.severity).toBe("BLOCKER");
        expect(byRule.get("decision-confirmed-without-value")?.severity).toBe("MEDIUM");
        expect(byRule.get("entity-without-attributes")?.severity).toBe("MEDIUM");
        expect(first.created).toHaveLength(5);

        // Deterministic rerun: same findings, zero new issues.
        const second = await runCompletenessValidation(db, owner.id, pid);
        expect(second.findings).toEqual(first.findings);
        expect(second.created).toEqual([]);
        expect(second.unchangedOpen).toHaveLength(5);

        const stored = await listIssues(db, owner.id, pid, { type: "COMPLETENESS" });
        expect(stored).toHaveLength(5);
        for (const issue of stored) {
          expect(issue.status).toBe("OPEN");
        }
      });
    } finally {
      await pool.end();
    }
  });

  it("resolves fixed findings and reopens regressed ones", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, undecided, must } = await setupMixedProject(
          db,
          `comp-fix-${Date.now()}@example.com`,
        );
        const first = await runCompletenessValidation(db, owner.id, pid);
        expect(first.created).toHaveLength(5);

        // Fix two gaps: confirm the decision, add acceptance criteria.
        await updateDecision(db, owner.id, pid, undecided.decisionKey, {
          status: "CONFIRMED",
          value: true,
          changeReason: "Decided in review.",
        });
        await updateRequirement(db, owner.id, pid, must.requirementCode, {
          acceptanceCriteria: ["Valid credentials grant access"],
        });
        const second = await runCompletenessValidation(db, owner.id, pid);
        expect(second.findings).toHaveLength(3);
        expect(second.resolved).toHaveLength(2);
        expect(second.created).toEqual([]);

        // Regression: manually resolve a live finding, rerun reopens it.
        const live = (await listIssues(db, owner.id, pid, { type: "COMPLETENESS" })).find(
          (issue) => issue.status === "OPEN",
        );
        if (!live) throw new Error("expected a live finding");
        await resolveIssue(db, owner.id, pid, live.issueCode, "Premature manual resolve.");
        const third = await runCompletenessValidation(db, owner.id, pid);
        expect(third.reopened).toEqual([live.issueCode]);
        expect(third.created).toEqual([]);
      });
    } finally {
      await pool.end();
    }
  });

  it("never auto-touches human-ignored issues", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, minorUndecided } = await setupMixedProject(
          db,
          `comp-ignore-${Date.now()}@example.com`,
        );
        await runCompletenessValidation(db, owner.id, pid);
        const target = (await listIssues(db, owner.id, pid, { type: "COMPLETENESS" })).find(
          (issue) => issue.title.includes("DEC-UX") || issue.title.includes("Theme"),
        );
        if (!target) throw new Error("expected the theme finding");
        await updateIssue(db, owner.id, pid, target.issueCode, { status: "IGNORED" });

        // Fix the underlying gap anyway: the human decision stands.
        await updateDecision(db, owner.id, pid, minorUndecided.decisionKey, {
          status: "CONFIRMED",
          value: "dark",
          changeReason: "Decided in review.",
        });
        const second = await runCompletenessValidation(db, owner.id, pid);
        expect(second.resolved).not.toContain(target.issueCode);
        expect(
          (await listIssues(db, owner.id, pid, { type: "COMPLETENESS" })).find(
            (issue) => issue.issueCode === target.issueCode,
          )?.status,
        ).toBe("IGNORED");
      });
    } finally {
      await pool.end();
    }
  });
});
