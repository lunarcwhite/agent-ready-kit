// TASK-032 acceptance: resolved/NA excluded, blocking/high-impact first,
// deterministic output, no AI involvement (pure + scoped read-only select).
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { ProjectNotFoundError } from "../projects/errors";
import { createProject } from "../projects/repository";
import { createDecision } from "../decisions/decisions";
import { registerDependency } from "../decisions/dependencies";
import { DiscoveryValidationError } from "./errors";
import { ensureDiscoveryMap, linkDecisionToNode, updateDiscoveryNode } from "./discovery";
import { rankDiscoveryTopics, selectNextDiscoveryTopic } from "./prioritization";

function candidate(overrides: Partial<Parameters<typeof rankDiscoveryTopics>[0][number]> = {}) {
  return {
    nodeKey: "access",
    status: "UNKNOWN" as const,
    priority: 0,
    impact: null,
    blocksDownstream: false,
    ...overrides,
  };
}

describe("rankDiscoveryTopics (pure)", () => {
  it("excludes RESOLVED and NOT_APPLICABLE topics", () => {
    const ranked = rankDiscoveryTopics([
      candidate({ nodeKey: "access", status: "RESOLVED" }),
      candidate({ nodeKey: "data", status: "NOT_APPLICABLE" }),
      candidate({ nodeKey: "ux", status: "PARTIAL" }),
    ]);
    expect(ranked.map((topic) => topic.nodeKey)).toEqual(["ux"]);
  });

  it("prefers UNKNOWN over PARTIAL and HIGH over LOW impact", () => {
    const ranked = rankDiscoveryTopics([
      candidate({ nodeKey: "data", status: "PARTIAL", impact: "HIGH" }),
      candidate({ nodeKey: "access", status: "UNKNOWN", impact: "LOW" }),
      candidate({ nodeKey: "ux", status: "UNKNOWN", impact: "HIGH" }),
    ]);
    // ux 50 > data 40 > access 30.
    expect(ranked.map((topic) => topic.nodeKey)).toEqual(["ux", "data", "access"]);

    // Same impact: UNKNOWN outranks PARTIAL.
    const same = rankDiscoveryTopics([
      candidate({ nodeKey: "data", status: "PARTIAL", impact: "MEDIUM" }),
      candidate({ nodeKey: "access", status: "UNKNOWN", impact: "MEDIUM" }),
    ]);
    expect(same.map((topic) => topic.nodeKey)).toEqual(["access", "data"]);
  });

  it("ranks blocking topics above equal non-blocking ones", () => {
    const ranked = rankDiscoveryTopics([
      candidate({ nodeKey: "access", impact: "MEDIUM", blocksDownstream: false }),
      candidate({ nodeKey: "data", impact: "MEDIUM", blocksDownstream: true }),
    ]);
    expect(ranked[0].nodeKey).toBe("data");
    expect(ranked[0].reasons).toContain("unblocks downstream decisions");
  });

  it("is deterministic: ties break on nodeKey", () => {
    const twice = [
      rankDiscoveryTopics([candidate({ nodeKey: "b" }), candidate({ nodeKey: "a" })]),
      rankDiscoveryTopics([candidate({ nodeKey: "a" }), candidate({ nodeKey: "b" })]),
    ];
    expect(twice[0].map((topic) => topic.nodeKey)).toEqual(["a", "b"]);
    expect(twice[1].map((topic) => topic.nodeKey)).toEqual(["a", "b"]);
  });

  it("returns an empty ranking when nothing is open", () => {
    expect(rankDiscoveryTopics([candidate({ status: "RESOLVED" })])).toEqual([]);
    expect(rankDiscoveryTopics([])).toEqual([]);
  });
});

describe("selectNextDiscoveryTopic validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(selectNextDiscoveryTopic(db, "  ", "p-1")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("selectNextDiscoveryTopic (integration)", () => {
  it("selects the highest-value open topic and excludes resolved ones", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `prio-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "P", idea: "prio" });
        const pid = project.project.id;
        await ensureDiscoveryMap(db, owner.id, pid);

        await updateDiscoveryNode(db, owner.id, pid, "product", {
          status: "RESOLVED",
          impact: "HIGH",
        });
        await updateDiscoveryNode(db, owner.id, pid, "access", {
          status: "PARTIAL",
          impact: "HIGH",
        });
        const ranked = await selectNextDiscoveryTopic(db, owner.id, pid);
        expect(ranked.find((topic) => topic.nodeKey === "product")).toBeUndefined();
        // PARTIAL + HIGH outranks every UNKNOWN with no impact set.
        expect(ranked[0].nodeKey).toBe("access");

        // Resolving everything empties the ranking.
        for (const topic of ranked) {
          await updateDiscoveryNode(db, owner.id, pid, topic.nodeKey, { status: "RESOLVED" });
        }
        expect(await selectNextDiscoveryTopic(db, owner.id, pid)).toEqual([]);
      });
    } finally {
      await pool.end();
    }
  });

  it("boosts topics whose linked decisions gate other decisions", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `block-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "B", idea: "blocking" });
        const pid = project.project.id;
        await ensureDiscoveryMap(db, owner.id, pid);
        for (const [key, category] of [
          ["payment.required", "pay"],
          ["payment.provider", "pay"],
        ] as const) {
          await createDecision(db, owner.id, pid, {
            decisionKey: key,
            category,
            title: key,
            status: "CONFIRMED",
            impact: "HIGH",
            sourceType: "USER",
            confidence: "EXPLICIT",
            value: true,
          });
        }
        await registerDependency(db, owner.id, pid, {
          sourceKey: "payment.required",
          targetKey: "payment.provider",
          condition: { equals: false },
          effect: "MARK_NOT_APPLICABLE",
        });
        await linkDecisionToNode(db, owner.id, pid, "features", "payment.required");

        const ranked = await selectNextDiscoveryTopic(db, owner.id, pid);
        expect(ranked[0].nodeKey).toBe("features");
        expect(ranked[0].reasons).toContain("unblocks downstream decisions");
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects cross-user selection at the scope gate", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `pri-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `pri-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        await ensureDiscoveryMap(db, a.id, project.project.id);
        await expect(selectNextDiscoveryTopic(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
