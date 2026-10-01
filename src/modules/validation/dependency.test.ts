// TASK-072 acceptance: broken references detected, invalid dependency
// states detected, circular dependencies detected where prohibited,
// cross-project residue rejected (as broken, never probed).
//
// Pure unit tests pin cycle detection without a database. Row-level proofs
// run as rolled-back integration tests with drift rows inserted below the
// scoped write APIs (which correctly refuse such rows) — skipped, not
// failed, without TEST_DATABASE_URL/DATABASE_URL.
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
import { createDecision, type DecisionRow } from "../decisions/decisions";
import { registerDependency } from "../decisions/dependencies";
import { createUserTask } from "../tasks/user-tasks";
import { createIssue, listIssues, resolveIssue } from "./issues";
import { IssueValidationError } from "./errors";
import { collectDependencyFindings, findCycles, runDependencyValidation } from "./dependency";
import { upsertSection, getSection } from "../specifications/documents";

const FAKE_UUID = "00000000-0000-0000-0000-000000000099";

describe("findCycles", () => {
  it("returns empty for empty and acyclic graphs", () => {
    expect(findCycles([])).toEqual([]);
    expect(
      findCycles([
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ]),
    ).toEqual([]);
  });

  it("normalizes each cycle to its sorted member set", () => {
    expect(
      findCycles([
        { from: "b", to: "c" },
        { from: "c", to: "a" },
        { from: "a", to: "b" },
      ]),
    ).toEqual([["a", "b", "c"]]);
  });

  it("reports disjoint cycles separately and deterministically", () => {
    const edges = [
      { from: "z", to: "y" },
      { from: "y", to: "z" },
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    expect(findCycles(edges)).toEqual([
      ["a", "b"],
      ["y", "z"],
    ]);
    expect(findCycles([...edges].reverse())).toEqual([
      ["a", "b"],
      ["y", "z"],
    ]);
  });

  it("ignores self-loops (dedicated rule reports those)", () => {
    expect(findCycles([{ from: "a", to: "a" }])).toEqual([]);
  });
});

describe("dependency validation input", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(collectDependencyFindings(db, "  ", "p-1")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
    await expect(runDependencyValidation(db, "", "p-1")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("deterministic dependency validator (integration)", () => {
  async function setupGraph(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "D", idea: "deps" });
    const pid = project.project.id;
    const base = {
      status: "CONFIRMED",
      impact: "MEDIUM",
      sourceType: "USER",
      confidence: "EXPLICIT",
      value: true,
    } as const;
    const mk = (key: string, title: string): Promise<DecisionRow> =>
      createDecision(db, owner.id, pid, {
        decisionKey: key,
        category: "test",
        title,
        ...base,
      });
    const a = await mk("graph.a", "A");
    const b = await mk("graph.b", "B");
    const c = await mk("graph.c", "C");
    const d = await mk("graph.d", "D");
    const e = await mk("graph.e", "E");
    const f = await mk("graph.f", "F");
    const g = await mk("graph.g", "G");
    const h = await mk("graph.h", "H");
    const i = await mk("graph.i", "I");
    // Valid control edge through the scoped API: never flagged.
    await registerDependency(db, owner.id, pid, {
      sourceKey: h.decisionKey,
      targetKey: i.decisionKey,
      effect: "REQUIRE",
    });
    // Drift rows below the scoped APIs (which correctly refuse them).
    const drift = async (source: string, target: string, condition: unknown = null) =>
      db.insert(schema.decisionDependencies).values({
        projectId: pid,
        sourceDecisionKey: source,
        targetDecisionKey: target,
        condition: condition as null,
        effect: "REQUIRE",
      });
    await drift(a.decisionKey, "ghost.value"); // broken target
    await drift(a.decisionKey, a.decisionKey); // self-loop
    await drift(b.decisionKey, c.decisionKey); // cycle halves
    await drift(c.decisionKey, b.decisionKey);
    await drift(d.decisionKey, e.decisionKey); // duplicate ×2
    await drift(d.decisionKey, e.decisionKey);
    await drift(f.decisionKey, g.decisionKey, { nope: 1 }); // invalid condition
    return { owner, pid, a };
  }

  it("flags every drift class with calibrated severities", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, a } = await setupGraph(db, `dep-${Date.now()}@example.com`);

        // Traceability drift: requirement endpoint that resolves nowhere.
        const t1 = await createDecision(db, owner.id, pid, {
          decisionKey: "graph.t",
          category: "test",
          title: "T",
          status: "CONFIRMED",
          impact: "LOW",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: true,
        });
        await db.insert(schema.traceabilityLinks).values({
          projectId: pid,
          sourceType: "DECISION",
          sourceId: t1.id,
          targetType: "REQUIREMENT",
          targetId: FAKE_UUID,
          relationshipType: "implemented_by",
        });

        // Section-dependency drift: knowledge source that resolves nowhere.
        await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "product.scope",
          title: "Scope",
          renderedContent: "Scope.",
        });
        const section = await getSection(db, owner.id, pid, "PRD", "product.scope");
        await db.insert(schema.sectionDependencies).values({
          sectionId: section.id,
          sourceType: "KNOWLEDGE",
          sourceId: FAKE_UUID,
        });

        // Issue-reference drift: decision ref that resolves nowhere.
        const issue = await createIssue(db, owner.id, pid, {
          type: "CONSISTENCY",
          severity: "HIGH",
          title: "Drift host",
          description: "Carries a dangling reference.",
        });
        await db.insert(schema.issueReferences).values({
          issueId: issue.id,
          referenceType: "DECISION",
          referenceId: FAKE_UUID,
          relationship: "AFFECTED",
        });

        // Task graph: one valid edge, one foreign endpoint, one self-loop,
        // one two-cycle — all below the scoped APIs.
        const t1task = await createUserTask(db, owner.id, pid, {
          title: "One",
          objective: "First.",
          priority: "P0",
          acceptanceCriteria: ["Done"],
          definitionOfDone: ["Merged"],
        });
        const t2task = await createUserTask(db, owner.id, pid, {
          title: "Two",
          objective: "Second.",
          priority: "P0",
          acceptanceCriteria: ["Done"],
          definitionOfDone: ["Merged"],
        });
        const t3task = await createUserTask(db, owner.id, pid, {
          title: "Three",
          objective: "Third.",
          priority: "P1",
          acceptanceCriteria: ["Done"],
          definitionOfDone: ["Merged"],
        });
        const [other] = await db
          .insert(schema.users)
          .values({ email: `dep-other-${Date.now()}@example.com` })
          .returning();
        const otherProject = await createProject(db, other.id, { name: "O", idea: "other" });
        const foreign = await createUserTask(db, other.id, otherProject.project.id, {
          title: "Foreign",
          objective: "Elsewhere.",
          priority: "P2",
          acceptanceCriteria: ["Done"],
          definitionOfDone: ["Merged"],
        });
        await db.insert(schema.userTaskDependencies).values([
          { taskId: t1task.id, dependsOnTaskId: t2task.id }, // valid control
          { taskId: t1task.id, dependsOnTaskId: foreign.id }, // foreign endpoint
          { taskId: t3task.id, dependsOnTaskId: t3task.id }, // self-loop
          { taskId: t2task.id, dependsOnTaskId: t1task.id }, // cycle with control
        ]);
        void a;

        const report = await runDependencyValidation(db, owner.id, pid);
        const byRule = new Map<string, number>();
        for (const finding of report.findings) {
          byRule.set(finding.rule, (byRule.get(finding.rule) ?? 0) + 1);
        }
        expect(byRule.get("decision-dep-broken-endpoint")).toBe(1);
        expect(byRule.get("decision-dep-self")).toBe(1);
        expect(byRule.get("decision-dep-cycle")).toBe(1);
        expect(byRule.get("decision-dep-invalid-condition")).toBe(1);
        expect(byRule.get("decision-dep-duplicate")).toBe(1);
        expect(byRule.get("traceability-broken-endpoint")).toBe(1);
        expect(byRule.get("section-dep-broken-source")).toBe(1);
        expect(byRule.get("issue-ref-broken")).toBe(1);
        expect(byRule.get("task-dep-broken-endpoint")).toBe(1);
        expect(byRule.get("task-dep-self")).toBe(1);
        expect(byRule.get("task-dep-cycle")).toBe(1);
        expect(report.findings).toHaveLength(11);
        expect(report.created).toHaveLength(11);

        const severityOf = (rule: string): string | undefined =>
          report.findings.find((finding) => finding.rule === rule)?.severity;
        expect(severityOf("decision-dep-broken-endpoint")).toBe("HIGH");
        expect(severityOf("decision-dep-cycle")).toBe("HIGH");
        expect(severityOf("task-dep-cycle")).toBe("HIGH");
        expect(severityOf("decision-dep-duplicate")).toBe("MEDIUM");
        expect(severityOf("traceability-broken-endpoint")).toBe("MEDIUM");
        expect(severityOf("issue-ref-broken")).toBe("LOW");

        // Deterministic rerun: same findings, zero new issues.
        const second = await runDependencyValidation(db, owner.id, pid);
        expect(second.findings).toEqual(report.findings);
        expect(second.created).toEqual([]);
        expect(second.unchangedOpen).toHaveLength(11);
      });
    } finally {
      await pool.end();
    }
  });

  it("resolves fixed endpoints and reopens regressed findings", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupGraph(db, `dep-fix-${Date.now()}@example.com`);
        const first = await runDependencyValidation(db, owner.id, pid);
        expect(first.created.length).toBeGreaterThan(0);

        // Fix: create the missing decision the broken edge points at.
        await createDecision(db, owner.id, pid, {
          decisionKey: "ghost.value",
          category: "test",
          title: "Ghost",
          status: "CONFIRMED",
          impact: "LOW",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: true,
        });
        const second = await runDependencyValidation(db, owner.id, pid);
        expect(second.resolved).toHaveLength(1);
        expect(second.created).toEqual([]);

        // Regression: manually resolve a live finding, rerun reopens it.
        const live = (await listIssues(db, owner.id, pid, { type: "DEPENDENCY" })).find(
          (issue) => issue.status === "OPEN",
        );
        if (!live) throw new Error("expected a live finding");
        await resolveIssue(db, owner.id, pid, live.issueCode, "Premature manual resolve.");
        const third = await runDependencyValidation(db, owner.id, pid);
        expect(third.reopened).toEqual([live.issueCode]);
      });
    } finally {
      await pool.end();
    }
  });
});
