// TASK-021 acceptance: stable IDs, project scoping, structural values,
// rationale/provenance/impact storage, status validation, history.
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
import { ProjectNotFoundError } from "../projects/errors";
import { getStateVersion } from "../projects/state-version";
import { DecisionNotFoundError, DecisionValidationError } from "./errors";
import {
  createDecision,
  getDecisionByCode,
  getDecisionByKey,
  getDecisionHistory,
  listDecisions,
  updateDecision,
  type CreateDecisionInput,
} from "./decisions";
import { listDependencies, registerDependency } from "./dependencies";

const BASE: CreateDecisionInput = {
  decisionKey: "authentication.required",
  category: "auth",
  title: "Authentication required",
  status: "CONFIRMED",
  impact: "HIGH",
  sourceType: "USER",
  confidence: "EXPLICIT",
  value: true,
  rationale: "Private workspaces need accounts.",
};

describe("decision input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(createDecision(db, "  ", "p-1", BASE)).rejects.toBeInstanceOf(
      DecisionValidationError,
    );
    await expect(getDecisionByKey(db, "", "p-1", "a.b")).rejects.toBeInstanceOf(
      DecisionValidationError,
    );
    await expect(listDecisions(db, "", "p-1")).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(updateDecision(db, "", "p-1", "a.b", {})).rejects.toBeInstanceOf(
      DecisionValidationError,
    );
    await expect(getDecisionHistory(db, "", "p-1", "a.b")).rejects.toBeInstanceOf(
      DecisionValidationError,
    );
  });

  it("rejects malformed keys, titles, and enums without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(
      createDecision(db, "u-1", "p-1", { ...BASE, decisionKey: "Has Spaces" }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(
      createDecision(db, "u-1", "p-1", { ...BASE, decisionKey: "UPPER.CASE" }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(
      createDecision(db, "u-1", "p-1", { ...BASE, title: "   " }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(
      createDecision(db, "u-1", "p-1", { ...BASE, status: "MAYBE" as never }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(
      createDecision(db, "u-1", "p-1", { ...BASE, impact: "BLOCKER" as never }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(
      createDecision(db, "u-1", "p-1", { ...BASE, category: "toolongcategory" }),
    ).rejects.toThrow();
  });

  it("rejects non-JSON values without touching the database", async () => {
    const db = {} as AppDatabase;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(
      createDecision(db, "u-1", "p-1", { ...BASE, value: circular }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("decision domain model (integration)", () => {
  async function setup() {
    const pool = new Pool({ connectionString: url });
    return { pool };
  }

  it("creates a decision with a stable code, history row, and version bump", async () => {
    const { pool } = await setup();
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `dec-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "D", idea: "decisions" });

        const created = await createDecision(db, owner.id, project.project.id, BASE);
        expect(created.decisionCode).toBe("DEC-AUTH-001");
        expect(created.version).toBe(1);
        expect(created.value).toBe(true);
        expect(created.rationale).toContain("workspaces");
        expect(created.confirmedAt).toBeInstanceOf(Date);
        // Canonical change numbers the project state (TASK-020): 1 → 2.
        expect(await getStateVersion(db, owner.id, project.project.id)).toBe(2);

        const byKey = await getDecisionByKey(db, owner.id, project.project.id, BASE.decisionKey);
        expect(byKey.id).toBe(created.id);
        const byCode = await getDecisionByCode(db, owner.id, project.project.id, "DEC-AUTH-001");
        expect(byCode.id).toBe(created.id);

        const history = await getDecisionHistory(
          db,
          owner.id,
          project.project.id,
          BASE.decisionKey,
        );
        expect(history.map((row) => row.version)).toEqual([1]);
        expect(history[0].changeReason).toBe("created");
      });
    } finally {
      await pool.end();
    }
  });

  it("sequences codes per category without reuse", async () => {
    const { pool } = await setup();
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `seq-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "S", idea: "seq" });
        const pid = project.project.id;
        const first = await createDecision(db, owner.id, pid, BASE);
        const second = await createDecision(db, owner.id, pid, {
          ...BASE,
          decisionKey: "authentication.methods",
          title: "Auth methods",
          value: ["GOOGLE"],
        });
        const other = await createDecision(db, owner.id, pid, {
          ...BASE,
          decisionKey: "billing.required",
          category: "bill",
          title: "Billing",
          value: false,
        });
        expect(first.decisionCode).toBe("DEC-AUTH-001");
        expect(second.decisionCode).toBe("DEC-AUTH-002");
        expect(other.decisionCode).toBe("DEC-BILL-001");

        const listed = await listDecisions(db, owner.id, pid);
        expect(listed.map((row) => row.decisionCode)).toEqual([
          "DEC-AUTH-001",
          "DEC-AUTH-002",
          "DEC-BILL-001",
        ]);
        const confirmed = await listDecisions(db, owner.id, pid, { status: "CONFIRMED" });
        expect(confirmed).toHaveLength(3);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects duplicate keys as domain errors", async () => {
    const { pool } = await setup();
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `dup-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "U", idea: "dup" });
        await createDecision(db, owner.id, project.project.id, BASE);
        await expect(
          createDecision(db, owner.id, project.project.id, { ...BASE, title: "Other title" }),
        ).rejects.toBeInstanceOf(DecisionValidationError);
        // Failed create burns nothing observable: still one decision.
        expect(await listDecisions(db, owner.id, project.project.id)).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("versions updates with history snapshots and confirmed_at rules", async () => {
    const { pool } = await setup();
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `upd-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "H", idea: "hist" });
        const pid = project.project.id;
        await createDecision(db, owner.id, pid, BASE);

        const updated = await updateDecision(db, owner.id, pid, BASE.decisionKey, {
          value: false,
          status: "DEFERRED",
          changeReason: "reconsidered",
        });
        expect(updated.version).toBe(2);
        expect(updated.value).toBe(false);
        expect(updated.confirmedAt).toBeNull();
        expect(await getStateVersion(db, owner.id, pid)).toBe(3);

        const history = await getDecisionHistory(db, owner.id, pid, BASE.decisionKey);
        expect(history.map((row) => row.version)).toEqual([1, 2]);
        expect(history[1].changeReason).toBe("reconsidered");

        // No-op update returns current state without new history.
        const noop = await updateDecision(db, owner.id, pid, BASE.decisionKey, {});
        expect(noop.version).toBe(2);
        expect(await getDecisionHistory(db, owner.id, pid, BASE.decisionKey)).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates decisions between users", async () => {
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
        await createDecision(db, a.id, project.project.id, BASE);

        // Cross-user access fails at the project scope gate: B learns
        // nothing, not even whether the project exists.
        await expect(
          getDecisionByKey(db, b.id, project.project.id, BASE.decisionKey),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(listDecisions(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(createDecision(db, b.id, project.project.id, BASE)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          updateDecision(db, b.id, project.project.id, BASE.decisionKey, { value: 1 }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        // In-scope but missing key: decision-level NotFound.
        await expect(
          getDecisionByKey(db, a.id, project.project.id, "nope.missing"),
        ).rejects.toBeInstanceOf(DecisionNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });

  it("cascades NOT_APPLICABLE and reopens on re-enable with one version bump", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `dep-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "G", idea: "graph" });
        const pid = project.project.id;
        const parent = await createDecision(db, owner.id, pid, {
          ...BASE,
          decisionKey: "payment.required",
          category: "pay",
          title: "Payment required",
          value: true,
        });
        const child = await createDecision(db, owner.id, pid, {
          ...BASE,
          decisionKey: "payment.provider",
          category: "pay",
          title: "Payment provider",
          value: "STRIPE",
        });
        await registerDependency(db, owner.id, pid, {
          sourceKey: parent.decisionKey,
          targetKey: child.decisionKey,
          condition: { equals: false },
          effect: "MARK_NOT_APPLICABLE",
        });

        const before = await getStateVersion(db, owner.id, pid);
        await updateDecision(db, owner.id, pid, parent.decisionKey, { value: false });
        const na = await getDecisionByKey(db, owner.id, pid, child.decisionKey);
        expect(na.status).toBe("NOT_APPLICABLE");
        expect(na.value).toBe("STRIPE");
        // One user action, one version — derived writes share the bump.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 1);

        await updateDecision(db, owner.id, pid, parent.decisionKey, { value: true });
        const reopened = await getDecisionByKey(db, owner.id, pid, child.decisionKey);
        expect(reopened.status).toBe("UNRESOLVED");
        expect(reopened.value).toBe("STRIPE");
      });
    } finally {
      await pool.end();
    }
  });

  it("never auto-reopens human-authored NOT_APPLICABLE", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `depman-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "M", idea: "manual" });
        const pid = project.project.id;
        const parent = await createDecision(db, owner.id, pid, {
          ...BASE,
          decisionKey: "payment.required",
          category: "pay",
          title: "Payment required",
          value: true,
        });
        const child = await createDecision(db, owner.id, pid, {
          ...BASE,
          decisionKey: "payment.provider",
          category: "pay",
          title: "Payment provider",
          value: "STRIPE",
        });
        await registerDependency(db, owner.id, pid, {
          sourceKey: parent.decisionKey,
          targetKey: child.decisionKey,
          condition: { equals: false },
          effect: "MARK_NOT_APPLICABLE",
        });

        // Human shelves the child deliberately (no system reason recorded).
        await updateDecision(db, owner.id, pid, child.decisionKey, { status: "NOT_APPLICABLE" });
        await updateDecision(db, owner.id, pid, parent.decisionKey, { value: false });
        await updateDecision(db, owner.id, pid, parent.decisionKey, { value: true });
        const still = await getDecisionByKey(db, owner.id, pid, child.decisionKey);
        expect(still.status).toBe("NOT_APPLICABLE");
      });
    } finally {
      await pool.end();
    }
  });

  it("propagates chains, rejects cycles/duplicates, isolates by owner", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `chain-${stamp}@example.com` })
          .returning();
        const [other] = await db
          .insert(schema.users)
          .values({ email: `chain-o-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "C", idea: "chain" });
        const pid = project.project.id;
        for (const [key, cat] of [
          ["a.x", "aa"],
          ["b.y", "bb"],
          ["c.z", "cc"],
        ] as const) {
          await createDecision(db, owner.id, pid, {
            ...BASE,
            decisionKey: key,
            category: cat,
            title: key,
            status: "CONFIRMED",
            value: true,
          });
        }
        await registerDependency(db, owner.id, pid, {
          sourceKey: "a.x",
          targetKey: "b.y",
          effect: "MARK_NOT_APPLICABLE",
        });
        await registerDependency(db, owner.id, pid, {
          sourceKey: "b.y",
          targetKey: "c.z",
          effect: "MARK_NOT_APPLICABLE",
        });

        await updateDecision(db, owner.id, pid, "a.x", { value: false });
        expect((await getDecisionByKey(db, owner.id, pid, "b.y")).status).toBe("NOT_APPLICABLE");
        expect((await getDecisionByKey(db, owner.id, pid, "c.z")).status).toBe("NOT_APPLICABLE");

        // Cycle, exact duplicate, and dangling ends are rejected.
        await expect(
          registerDependency(db, owner.id, pid, {
            sourceKey: "c.z",
            targetKey: "a.x",
            effect: "REQUIRE",
          }),
        ).rejects.toBeInstanceOf(DecisionValidationError);
        await expect(
          registerDependency(db, owner.id, pid, {
            sourceKey: "a.x",
            targetKey: "b.y",
            effect: "MARK_NOT_APPLICABLE",
          }),
        ).rejects.toBeInstanceOf(DecisionValidationError);
        await expect(
          registerDependency(db, owner.id, pid, {
            sourceKey: "a.x",
            targetKey: "ghost.key",
            effect: "REQUIRE",
          }),
        ).rejects.toBeInstanceOf(DecisionNotFoundError);

        // Foreign project scope fails closed.
        await expect(
          registerDependency(db, other.id, pid, {
            sourceKey: "a.x",
            targetKey: "b.y",
            effect: "REQUIRE",
          }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(listDependencies(db, other.id, pid)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        expect(await listDependencies(db, owner.id, pid)).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });
});
