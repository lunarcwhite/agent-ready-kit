// TASK-030 acceptance: persisted domain state, canonical statuses,
// progress survival, decision association, project scoping.
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
import { ProjectNotFoundError } from "../projects/errors";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createDecision } from "../decisions/decisions";
import { DiscoveryNotFoundError, DiscoveryValidationError } from "./errors";
import {
  DISCOVERY_DOMAINS,
  ensureDiscoveryMap,
  getDiscoveryMap,
  getDiscoveryNode,
  linkDecisionToNode,
  listDecisionNodes,
  listNodeDecisions,
  unlinkDecisionFromNode,
  updateDiscoveryNode,
} from "./discovery";

describe("discovery input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(ensureDiscoveryMap(db, "  ", "p-1")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(getDiscoveryMap(db, "", "p-1")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(getDiscoveryNode(db, "", "p-1", "access")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(updateDiscoveryNode(db, "", "p-1", "access", {})).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(linkDecisionToNode(db, "", "p-1", "access", "a.b")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
  });

  it("rejects malformed keys and enums without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(getDiscoveryNode(db, "u-1", "p-1", "Has Spaces")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(getDiscoveryNode(db, "u-1", "p-1", "   ")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(
      updateDiscoveryNode(db, "u-1", "p-1", "access", { status: "DONE" as never }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(
      updateDiscoveryNode(db, "u-1", "p-1", "access", { impact: "BLOCKER" as never }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(
      updateDiscoveryNode(db, "u-1", "p-1", "access", { priority: -1 }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(
      updateDiscoveryNode(db, "u-1", "p-1", "access", { priority: 1.5 }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(
      updateDiscoveryNode(db, "u-1", "p-1", "access", { title: "   " }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(linkDecisionToNode(db, "u-1", "p-1", "access", "  ")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
  });

  it("seeds the nine canonical domains", () => {
    expect(DISCOVERY_DOMAINS.map((domain) => domain.nodeKey)).toEqual([
      "product",
      "features",
      "access",
      "data",
      "ux",
      "technical",
      "integrations",
      "ai",
      "non_functional",
    ]);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("discovery domain model (integration)", () => {
  async function setup() {
    const pool = new Pool({ connectionString: url });
    return { pool };
  }

  async function setupProject(db: AppDatabase, email: string) {
    const [owner] = await db
      .insert(schema.users)
      .values({ email })
      .returning();
    const project = await createProject(db, owner.id, { name: "D", idea: "discovery" });
    return { owner, projectId: project.project.id };
  }

  it("initializes nine UNKNOWN nodes with one version bump, idempotently", async () => {
    const { pool } = await setup();
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setupProject(db, `disc-${Date.now()}@example.com`);

        const first = await ensureDiscoveryMap(db, owner.id, projectId);
        expect(first).toHaveLength(9);
        expect(first.every((node) => node.status === "UNKNOWN")).toBe(true);
        // Canonical init numbers the project state (TASK-020): 1 → 2.
        expect(await getStateVersion(db, owner.id, projectId)).toBe(2);

        // Progress survives sessions: a fresh read returns the same map.
        const reread = await getDiscoveryMap(db, owner.id, projectId);
        expect(reread.map((node) => node.nodeKey)).toEqual(first.map((node) => node.nodeKey));

        // Repeat init is free: no duplicates, no extra version bump.
        const second = await ensureDiscoveryMap(db, owner.id, projectId);
        expect(second).toHaveLength(9);
        expect(await getStateVersion(db, owner.id, projectId)).toBe(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("updates node status with history-safe versioning and rejects bad states", async () => {
    const { pool } = await setup();
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setupProject(db, `upd-${Date.now()}@example.com`);
        await ensureDiscoveryMap(db, owner.id, projectId);

        const updated = await updateDiscoveryNode(db, owner.id, projectId, "access", {
          status: "PARTIAL",
          priority: 10,
          impact: "HIGH",
        });
        expect(updated.status).toBe("PARTIAL");
        expect(updated.priority).toBe(10);
        expect(updated.impact).toBe("HIGH");
        expect(await getStateVersion(db, owner.id, projectId)).toBe(3);

        const resolved = await updateDiscoveryNode(db, owner.id, projectId, "access", {
          status: "RESOLVED",
        });
        expect(resolved.status).toBe("RESOLVED");

        // No-op update returns current state without a version bump.
        const before = await getStateVersion(db, owner.id, projectId);
        const noop = await updateDiscoveryNode(db, owner.id, projectId, "access", {});
        expect(noop.status).toBe("RESOLVED");
        expect(await getStateVersion(db, owner.id, projectId)).toBe(before);

        await expect(
          getDiscoveryNode(db, owner.id, projectId, "ghost"),
        ).rejects.toBeInstanceOf(DiscoveryNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });

  it("links decisions to nodes, queries both directions, rejects duplicates", async () => {
    const { pool } = await setup();
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setupProject(db, `link-${Date.now()}@example.com`);
        await ensureDiscoveryMap(db, owner.id, projectId);
        await createDecision(db, owner.id, projectId, {
          decisionKey: "authentication.required",
          category: "auth",
          title: "Authentication required",
          status: "CONFIRMED",
          impact: "HIGH",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: true,
        });
        const versionBeforeLink = await getStateVersion(db, owner.id, projectId);

        await linkDecisionToNode(db, owner.id, projectId, "access", "authentication.required");
        // Bookkeeping links do not bump the project version (TASK-024 rule).
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBeforeLink);

        const linked = await listNodeDecisions(db, owner.id, projectId, "access");
        expect(linked.map((row) => row.decisionKey)).toEqual(["authentication.required"]);

        const nodes = await listDecisionNodes(db, owner.id, projectId, "authentication.required");
        expect(nodes.map((row) => row.nodeKey)).toEqual(["access"]);

        await expect(
          linkDecisionToNode(db, owner.id, projectId, "access", "authentication.required"),
        ).rejects.toBeInstanceOf(DiscoveryValidationError);
        await expect(
          linkDecisionToNode(db, owner.id, projectId, "access", "ghost.key"),
        ).rejects.toBeInstanceOf(DiscoveryNotFoundError);

        await unlinkDecisionFromNode(db, owner.id, projectId, "access", "authentication.required");
        expect(await listNodeDecisions(db, owner.id, projectId, "access")).toHaveLength(0);
        await expect(
          unlinkDecisionFromNode(db, owner.id, projectId, "access", "authentication.required"),
        ).rejects.toBeInstanceOf(DiscoveryNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates Discovery Maps between users", async () => {
    const { pool } = await setup();
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `iso-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `iso-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        await ensureDiscoveryMap(db, a.id, project.project.id);

        // Cross-user access fails at the project scope gate.
        await expect(getDiscoveryMap(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(ensureDiscoveryMap(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          updateDiscoveryNode(db, b.id, project.project.id, "access", { status: "RESOLVED" }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
