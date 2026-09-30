// TASK-051 acceptance: review sections shown, assumptions kept separate,
// confirm initializes discovery state idempotently, correction path works,
// cross-user access rejected. Pure projection tests run without a database;
// persistence tests use the rolled-back transaction strategy with fakes only.
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
import { createProject, getProject, updateProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { ProjectNotFoundError } from "../projects/errors";
import { getDiscoveryMap } from "./discovery";
import type { IdeaAnalysis } from "../../ai/schemas/idea-analysis";
import { buildUnderstandingView, confirmUnderstanding, ASSUMPTION_GLYPH } from "./understanding";
import { DiscoveryValidationError } from "./errors";

const ANALYSIS: IdeaAnalysis = {
  summary: "AI-assisted novel writing application",
  productCategory: "Productivity",
  knownFacts: [{ statement: "Writers create projects" }],
  candidateKnowledge: [
    { domain: "USER", statement: "Independent novel writers" },
    { domain: "FEATURE", statement: "Create writing projects" },
    { domain: "FEATURE", statement: "AI-assisted writing" },
    { domain: "CONSTRAINT", statement: "Low-cost hosting" },
    { domain: "DATA", statement: "Stories have chapters" },
  ],
  candidateDecisions: [],
  unknownDomains: [
    { domain: "access", question: "Is authentication needed?" },
    { domain: "integrations", question: "Which AI provider?" },
  ],
  assumptions: [{ statement: "Single-user MVP", impact: "HIGH" }],
};

describe("buildUnderstandingView (unit, no database)", () => {
  it("maps summary, users, capabilities, constraints, and unclear areas", () => {
    const view = buildUnderstandingView(ANALYSIS);
    expect(view.productSummary).toBe("AI-assisted novel writing application");
    expect(view.productCategory).toBe("Productivity");
    expect(view.users).toEqual(["Independent novel writers"]);
    expect(view.capabilities).toEqual(["Create writing projects", "AI-assisted writing"]);
    expect(view.constraints).toEqual(["Low-cost hosting"]);
    expect(view.unclearAreas).toEqual([
      { domain: "access", question: "Is authentication needed?" },
      { domain: "integrations", question: "Which AI provider?" },
    ]);
  });

  it("never hides unmatched knowledge and never merges assumptions into facts", () => {
    const view = buildUnderstandingView(ANALYSIS);
    expect(view.otherNotes).toEqual([{ domain: "DATA", statement: "Stories have chapters" }]);
    expect(view.assumptions).toEqual([
      { statement: "Single-user MVP", impact: "HIGH", glyph: "!" },
    ]);
    expect(ASSUMPTION_GLYPH).toEqual({ HIGH: "!", MEDIUM: "●", LOW: "○" });
    // Assumptions are their own section: no assumption text leaks into notes.
    const allNotes = [...view.users, ...view.capabilities, ...view.constraints];
    expect(allNotes).not.toContain("Single-user MVP");
  });

  it("matches domains case-insensitively and tolerates empty analyses", () => {
    const view = buildUnderstandingView({
      ...ANALYSIS,
      candidateKnowledge: [
        { domain: "user-persona", statement: "Solo founders" },
        { domain: "", statement: "Stray note" },
      ],
      unknownDomains: [],
      assumptions: [],
    });
    expect(view.users).toEqual(["Solo founders"]);
    expect(view.otherNotes).toEqual([{ domain: "general", statement: "Stray note" }]);
    expect(view.unclearAreas).toEqual([]);
    expect(view.assumptions).toEqual([]);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("confirmUnderstanding (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, {
      name: "StoryForge",
      idea: "An app that helps people write novels.",
    });
    return { owner, projectId: created.project.id };
  }

  it("initializes canonical discovery state exactly once", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `und-${Date.now()}@example.com`);
        expect(await getDiscoveryMap(db, owner.id, projectId)).toHaveLength(0);

        const first = await confirmUnderstanding(db, owner.id, projectId);
        expect(first).toHaveLength(9);
        const versionAfterFirst = await getStateVersion(db, owner.id, projectId);

        // Second confirm is a free idempotent read: same map, no version bump.
        const second = await confirmUnderstanding(db, owner.id, projectId);
        expect(second.map((node) => node.nodeKey).sort()).toEqual(
          first.map((node) => node.nodeKey).sort(),
        );
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionAfterFirst);
      });
    } finally {
      await pool.end();
    }
  });

  it("supports correction through project input updates", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `und-corr-${Date.now()}@example.com`);
        const updated = await updateProject(db, owner.id, projectId, {
          idea: "An app that helps people write novels with AI planning.",
          targetUsers: "Independent novel writers",
        });
        expect(updated.input.idea).toContain("AI planning");
        expect(updated.input.targetUsers).toBe("Independent novel writers");
        const detail = await getProject(db, owner.id, projectId);
        expect(detail.input.idea).toContain("AI planning");
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects blank owner and cross-user confirmation", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { projectId } = await setup(db, `und-auth-${Date.now()}@example.com`);
        const [other] = await db
          .insert(schema.users)
          .values({ email: `und-other-${Date.now()}@example.com` })
          .returning();
        await expect(confirmUnderstanding(db, "  ", projectId)).rejects.toBeInstanceOf(
          DiscoveryValidationError,
        );
        await expect(confirmUnderstanding(db, other.id, projectId)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });
});

describe("understanding boundaries (static)", () => {
  it("never imports provider SDKs or canonical-state writers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/discovery/understanding.ts"),
      "utf-8",
    );
    const runtimeImports = source
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type"));
    const forbidden = [
      "modules/decisions/decisions",
      "modules/requirements/requirements",
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
  });
});
