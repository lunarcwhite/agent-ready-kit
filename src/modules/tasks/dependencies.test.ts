// TASK-093 acceptance: circular dependencies detected, missing dependency
// IDs rejected, cross-project dependencies rejected, READY/BLOCKED
// planning status derived, multi-level chains covered. Pure derivation
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
import { UserTaskNotFoundError, UserTaskValidationError } from "./errors";
import {
  addUserTaskDependency,
  deriveReadiness,
  listTaskPrerequisites,
  refreshDerivedReadiness,
  removeUserTaskDependency,
  wouldCreateTaskCycle,
} from "./dependencies";
import { createUserTask, getUserTaskByCode, updateUserTask } from "./user-tasks";

const TASK_BASE = {
  title: "Task",
  objective: "Do something.",
  priority: "P0" as const,
  acceptanceCriteria: ["Done"],
  definitionOfDone: ["Verified"],
};

describe("deriveReadiness (pure, no database)", () => {
  it("is READY with no prerequisites (vacuously true)", () => {
    expect(deriveReadiness([])).toBe("READY");
  });

  it("is READY when every prerequisite is DONE", () => {
    expect(deriveReadiness(["DONE", "DONE"])).toBe("READY");
  });

  it("is BLOCKED when any prerequisite is not DONE", () => {
    expect(deriveReadiness(["DONE", "PENDING"])).toBe("BLOCKED");
    expect(deriveReadiness(["READY"])).toBe("BLOCKED");
    expect(deriveReadiness(["BLOCKED"])).toBe("BLOCKED");
    expect(deriveReadiness(["REVIEW_REQUIRED"])).toBe("BLOCKED");
  });
});

describe("wouldCreateTaskCycle (pure, no database)", () => {
  it("detects self-dependency", () => {
    expect(wouldCreateTaskCycle([], "UTASK-001", "UTASK-001")).toBe(true);
  });

  it("detects direct and transitive cycles", () => {
    expect(
      wouldCreateTaskCycle(
        [{ sourceCode: "UTASK-002", targetCode: "UTASK-001" }],
        "UTASK-001",
        "UTASK-002",
      ),
    ).toBe(true);
    expect(
      wouldCreateTaskCycle(
        [
          { sourceCode: "UTASK-002", targetCode: "UTASK-001" },
          { sourceCode: "UTASK-003", targetCode: "UTASK-002" },
        ],
        "UTASK-001",
        "UTASK-003",
      ),
    ).toBe(true);
  });

  it("allows diamonds and chains", () => {
    const edges = [
      { sourceCode: "UTASK-002", targetCode: "UTASK-001" },
      { sourceCode: "UTASK-003", targetCode: "UTASK-001" },
    ];
    expect(wouldCreateTaskCycle(edges, "UTASK-004", "UTASK-002")).toBe(false);
    expect(wouldCreateTaskCycle(edges, "UTASK-004", "UTASK-003")).toBe(false);
    expect(wouldCreateTaskCycle([], "UTASK-001", "UTASK-002")).toBe(false);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("task dependency derivation (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "D", idea: "deps" });
    return { owner, projectId: created.project.id };
  }

  it("rejects missing dependency IDs and self-dependency", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `dep-${Date.now()}@example.com`);
        await createUserTask(db, owner.id, projectId, TASK_BASE);

        await expect(
          addUserTaskDependency(db, owner.id, projectId, "UTASK-001", "UTASK-999"),
        ).rejects.toBeInstanceOf(UserTaskNotFoundError);
        await expect(
          addUserTaskDependency(db, owner.id, projectId, "UTASK-001", "UTASK-001"),
        ).rejects.toBeInstanceOf(UserTaskValidationError);
        await expect(
          addUserTaskDependency(db, owner.id, projectId, "UTASK-001", "  "),
        ).rejects.toBeInstanceOf(UserTaskValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects cross-project dependencies", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `dep-x-${Date.now()}@example.com`);
        const [other] = await db
          .insert(schema.users)
          .values({ email: `dep-x-other-${Date.now()}@example.com` })
          .returning();
        const foreign = await createProject(db, other.id, { name: "F", idea: "Foreign." });
        await createUserTask(db, owner.id, projectId, TASK_BASE);
        await createUserTask(db, other.id, foreign.project.id, TASK_BASE);

        // Cross-project codes surface as NotFound, never as foreign rows.
        await expect(
          addUserTaskDependency(db, owner.id, projectId, "UTASK-001", "UTASK-001"),
        ).rejects.toBeInstanceOf(UserTaskNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });

  it("derives READY/BLOCKED through multi-level chains", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `dep-chain-${Date.now()}@example.com`);
        await createUserTask(db, owner.id, projectId, { ...TASK_BASE, title: "A" });
        await createUserTask(db, owner.id, projectId, { ...TASK_BASE, title: "B" });
        await createUserTask(db, owner.id, projectId, { ...TASK_BASE, title: "C" });
        // C depends on B, B depends on A.
        await addUserTaskDependency(db, owner.id, projectId, "UTASK-002", "UTASK-001");
        await addUserTaskDependency(db, owner.id, projectId, "UTASK-003", "UTASK-002");

        // All start PENDING; A has no prerequisites so it derives READY.
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-001")).status).toBe(
          "READY",
        );
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-002")).status).toBe(
          "BLOCKED",
        );
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-003")).status).toBe(
          "BLOCKED",
        );

        // Completing A unblocks B (transitively), but C stays blocked.
        await updateUserTask(db, owner.id, projectId, "UTASK-001", { status: "DONE" });
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-002")).status).toBe(
          "READY",
        );
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-003")).status).toBe(
          "BLOCKED",
        );

        // Completing B unblocks C.
        await updateUserTask(db, owner.id, projectId, "UTASK-002", { status: "DONE" });
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-003")).status).toBe(
          "READY",
        );

        // Re-opening B re-blocks C.
        await updateUserTask(db, owner.id, projectId, "UTASK-002", { status: "PENDING" });
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-003")).status).toBe(
          "BLOCKED",
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("unblocks when the last incomplete prerequisite is removed", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `dep-rem-${Date.now()}@example.com`);
        await createUserTask(db, owner.id, projectId, { ...TASK_BASE, title: "A" });
        await createUserTask(db, owner.id, projectId, { ...TASK_BASE, title: "B" });
        await addUserTaskDependency(db, owner.id, projectId, "UTASK-002", "UTASK-001");
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-002")).status).toBe(
          "BLOCKED",
        );

        await removeUserTaskDependency(db, owner.id, projectId, "UTASK-002", "UTASK-001");
        expect((await getUserTaskByCode(db, owner.id, projectId, "UTASK-002")).status).toBe(
          "READY",
        );
        expect(await listTaskPrerequisites(db, owner.id, projectId, "UTASK-002")).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("refreshDerivedReadiness is idempotent and scoped", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `dep-ref-${Date.now()}@example.com`);
        await createUserTask(db, owner.id, projectId, { ...TASK_BASE, title: "A" });
        await createUserTask(db, owner.id, projectId, { ...TASK_BASE, title: "B" });
        await addUserTaskDependency(db, owner.id, projectId, "UTASK-002", "UTASK-001");

        const first = await refreshDerivedReadiness(db, owner.id, projectId);
        expect(first.updated).toContain("UTASK-001");
        // Second run: nothing changes.
        const second = await refreshDerivedReadiness(db, owner.id, projectId);
        expect(second.updated).toEqual([]);
      });
    } finally {
      await pool.end();
    }
  });
});
