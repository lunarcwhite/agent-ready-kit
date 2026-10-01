// TASK-031 acceptance: deterministic calculation, explicit criteria,
// next-level explanation, no AI involvement.
//
// The calculator is pure — most cases run without a database. Refresh tests
// persist through the rolled-back integration path like discovery.test.ts.
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
import { createProject, getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { DiscoveryValidationError } from "./errors";
import { ensureDiscoveryMap, updateDiscoveryNode } from "./discovery";
import { calculateDiscoveryLevel, refreshDiscoveryLevel } from "./level";

const ALL = [
  "product",
  "features",
  "access",
  "data",
  "ux",
  "technical",
  "integrations",
  "ai",
  "non_functional",
];

function mapWith(handled: string[], partial: string[] = []) {
  return ALL.map((nodeKey) => ({
    nodeKey,
    status: handled.includes(nodeKey)
      ? "RESOLVED"
      : partial.includes(nodeKey)
        ? "PARTIAL"
        : "UNKNOWN",
  }));
}

describe("calculateDiscoveryLevel (pure)", () => {
  it("starts at INITIAL for an empty or untouched map and explains the gap", () => {
    const empty = calculateDiscoveryLevel([]);
    expect(empty.level).toBe("INITIAL");
    expect(empty.nextLevel).toBe("QUICK_DRAFT");
    expect(empty.missingForNext).toContain("resolve the product domain");

    const untouched = calculateDiscoveryLevel(mapWith([]));
    expect(untouched.level).toBe("INITIAL");
    expect(untouched.handled).toBe(0);
    expect(untouched.openNodeKeys).toHaveLength(9);
  });

  it("reaches QUICK_DRAFT with product plus two more handled", () => {
    const result = calculateDiscoveryLevel(mapWith(["product", "features", "access"]));
    expect(result.level).toBe("QUICK_DRAFT");
    expect(result.nextLevel).toBe("DETAILED");
  });

  it("holds QUICK_DRAFT when the core four are incomplete even with six handled", () => {
    const result = calculateDiscoveryLevel(
      mapWith(["product", "features", "ux", "technical", "integrations", "ai"]),
    );
    expect(result.level).toBe("QUICK_DRAFT");
    expect(result.missingForNext).toContain("resolve the access domain");
    expect(result.missingForNext).toContain("resolve the data domain");
  });

  it("reaches DETAILED with the core four plus six handled", () => {
    const result = calculateDiscoveryLevel(
      mapWith(["product", "features", "access", "data", "ux", "technical"]),
    );
    expect(result.level).toBe("DETAILED");
    expect(result.nextLevel).toBe("AGENT_READY");
  });

  it("treats NOT_APPLICABLE as handled and PARTIAL as open", () => {
    const nodes = ALL.map((nodeKey) => ({
      nodeKey,
      status: nodeKey === "ai" ? "NOT_APPLICABLE" : "RESOLVED",
    }));
    expect(calculateDiscoveryLevel(nodes).level).toBe("AGENT_READY");

    const partial = calculateDiscoveryLevel(mapWith(ALL.slice(0, 8), ["non_functional"]));
    expect(partial.level).toBe("DETAILED");
    expect(partial.openNodeKeys).toEqual(["non_functional"]);
    expect(partial.missingForNext).toEqual(["resolve the non_functional domain"]);
  });

  it("is deterministic and rejects unknown statuses without a database", () => {
    const nodes = mapWith(["product", "features", "access"]);
    expect(calculateDiscoveryLevel(nodes)).toEqual(calculateDiscoveryLevel(nodes));
    expect(() => calculateDiscoveryLevel([{ nodeKey: "product", status: "DONE" }])).toThrow(
      DiscoveryValidationError,
    );
  });

  it("reports no next level once AGENT_READY", () => {
    const result = calculateDiscoveryLevel(mapWith(ALL));
    expect(result.level).toBe("AGENT_READY");
    expect(result.nextLevel).toBeNull();
    expect(result.missingForNext).toEqual([]);
  });
});

describe("refreshDiscoveryLevel validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(refreshDiscoveryLevel(db, "  ", "p-1")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("refreshDiscoveryLevel (integration)", () => {
  it("syncs the project column only on drift, without a version bump", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `lvl-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "L", idea: "levels" });
        const pid = project.project.id;
        await ensureDiscoveryMap(db, owner.id, pid);

        const first = await refreshDiscoveryLevel(db, owner.id, pid);
        expect(first.level).toBe("INITIAL");
        expect(first.updated).toBe(false);
        const versionAfterEnsure = await getStateVersion(db, owner.id, pid);

        for (const key of ["product", "features", "access"]) {
          await updateDiscoveryNode(db, owner.id, pid, key, { status: "RESOLVED" });
        }
        const second = await refreshDiscoveryLevel(db, owner.id, pid);
        expect(second.level).toBe("QUICK_DRAFT");
        expect(second.updated).toBe(true);
        expect((await getProject(db, owner.id, pid)).project.discoveryLevel).toBe("QUICK_DRAFT");
        // Derived sync rides free: only the three node updates bumped.
        expect(await getStateVersion(db, owner.id, pid)).toBe(versionAfterEnsure + 3);

        const repeat = await refreshDiscoveryLevel(db, owner.id, pid);
        expect(repeat.updated).toBe(false);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects cross-user refresh at the scope gate", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `lvl-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `lvl-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        await ensureDiscoveryMap(db, a.id, project.project.id);
        await expect(refreshDiscoveryLevel(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
