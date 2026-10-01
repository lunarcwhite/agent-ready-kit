// TASK-090 acceptance: stable UTASK codes, queryable dependencies,
// project-scoped task references, structured acceptance criteria, and
// planning status distinct from repository implementation status.
//
// Unit tests pin validation and cycle logic without a database. Row-level
// proofs run as rolled-back integration tests — skipped, not failed, without
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
import { formatStableId, parseStableId } from "../../shared/identifiers";
import { createProject } from "../projects/repository";
import { ProjectNotFoundError } from "../projects/errors";
import { getStateVersion } from "../projects/state-version";
import { createRequirement } from "../requirements/requirements";
import { UserTaskNotFoundError, UserTaskValidationError } from "./errors";
import {
  addUserTaskDependency,
  listTaskDependents,
  listTaskPrerequisites,
  listUserTaskDependencies,
  removeUserTaskDependency,
  wouldCreateTaskCycle,
} from "./dependencies";
import {
  createUserTask,
  getUserTaskByCode,
  listUserTasks,
  normalizeTaskReferences,
  updateUserTask,
  type CreateUserTaskInput,
} from "./user-tasks";
import { createMilestone } from "./milestones";

const BASE: CreateUserTaskInput = {
  title: "Set up project",
  objective: "Initialize the repository and tooling.",
  priority: "P0",
  acceptanceCriteria: ["Repo exists", "CI runs"],
  definitionOfDone: ["Reviewed", "Merged"],
};

describe("UTASK identifier family", () => {
  it("formats and parses through the generic FAMILY-NNN path", () => {
    expect(formatStableId("UTASK", 1)).toBe("UTASK-001");
    expect(parseStableId("UTASK-001")).toMatchObject({ family: "UTASK", sequence: 1 });
  });
});

describe("user-task input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(createUserTask(db, "  ", "p-1", BASE)).rejects.toBeInstanceOf(
      UserTaskValidationError,
    );
    await expect(getUserTaskByCode(db, "", "p-1", "UTASK-001")).rejects.toBeInstanceOf(
      UserTaskValidationError,
    );
    await expect(listUserTasks(db, "", "p-1")).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(updateUserTask(db, "", "p-1", "UTASK-001", {})).rejects.toBeInstanceOf(
      UserTaskValidationError,
    );
    await expect(
      addUserTaskDependency(db, "", "p-1", "UTASK-001", "UTASK-002"),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      removeUserTaskDependency(db, "", "p-1", "UTASK-001", "UTASK-002"),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(listUserTaskDependencies(db, "", "p-1")).rejects.toBeInstanceOf(
      UserTaskValidationError,
    );
    await expect(listTaskPrerequisites(db, "", "p-1", "UTASK-001")).rejects.toBeInstanceOf(
      UserTaskValidationError,
    );
    await expect(listTaskDependents(db, "", "p-1", "UTASK-001")).rejects.toBeInstanceOf(
      UserTaskValidationError,
    );
  });

  it("rejects malformed fields without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, title: "   " }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, objective: "" }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, priority: "URGENT" as never }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, status: "IN_PROGRESS" as never }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, acceptanceCriteria: [] }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, acceptanceCriteria: ["ok", "  "] }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, definitionOfDone: [] }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, milestoneId: "not-a-uuid" }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, sortOrder: 1.5 }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(getUserTaskByCode(db, "u-1", "p-1", "  ")).rejects.toBeInstanceOf(
      UserTaskValidationError,
    );
    await expect(
      updateUserTask(db, "u-1", "p-1", "UTASK-001", { acceptanceCriteria: [] }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      updateUserTask(db, "u-1", "p-1", "UTASK-001", { status: "SHIPPED" as never }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      listUserTasks(db, "u-1", "p-1", { status: "SHIPPED" as never }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
  });

  it("rejects malformed references without touching the database", async () => {
    const db = {} as AppDatabase;
    // REQUIREMENT refs must be FR-shaped codes.
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, references: { requirements: ["nope"] } }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, references: { requirements: ["ARC-001"] } }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    // ARC/ENTITY/SCREEN refs must be UUID- or code-shaped.
    await expect(
      createUserTask(db, "u-1", "p-1", { ...BASE, references: { architecture: ["nope"] } }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(
      updateUserTask(db, "u-1", "p-1", "UTASK-001", { references: { screens: ["  "] } }),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    // Self-dependency is rejected before any write.
    await expect(
      addUserTaskDependency(db, "u-1", "p-1", "UTASK-001", "UTASK-001"),
    ).rejects.toBeInstanceOf(UserTaskValidationError);
    await expect(addUserTaskDependency(db, "u-1", "p-1", "  ", "UTASK-002")).rejects.toBeInstanceOf(
      UserTaskValidationError,
    );
    expect(normalizeTaskReferences(null)).toBeNull();
    expect(normalizeTaskReferences({})).toBeNull();
  });
});

describe("task cycle detection (pure)", () => {
  it("rejects self-dependency", () => {
    expect(wouldCreateTaskCycle([], "UTASK-001", "UTASK-001")).toBe(true);
  });

  it("rejects a direct two-node cycle", () => {
    const edges = [{ sourceCode: "UTASK-002", targetCode: "UTASK-001" }];
    expect(wouldCreateTaskCycle(edges, "UTASK-001", "UTASK-002")).toBe(true);
  });

  it("rejects a transitive cycle", () => {
    const edges = [
      { sourceCode: "UTASK-002", targetCode: "UTASK-001" },
      { sourceCode: "UTASK-003", targetCode: "UTASK-002" },
    ];
    expect(wouldCreateTaskCycle(edges, "UTASK-001", "UTASK-003")).toBe(true);
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

describeDb("user-task domain model (integration)", () => {
  it("creates tasks with stable codes and bumps the version", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `ut-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "T", idea: "tasks" });
        const pid = project.project.id;

        const created = await createUserTask(db, owner.id, pid, BASE);
        expect(created.taskCode).toBe("UTASK-001");
        expect(created.status).toBe("PENDING");
        expect(created.acceptanceCriteria).toEqual(["Repo exists", "CI runs"]);
        expect(created.references).toBeNull();
        expect(await getStateVersion(db, owner.id, pid)).toBe(2);

        const reread = await getUserTaskByCode(db, owner.id, pid, "UTASK-001");
        expect(reread.id).toBe(created.id);
        const milestone = await createMilestone(db, owner.id, pid, { title: "M1" });
        const second = await createUserTask(db, owner.id, pid, {
          ...BASE,
          title: "Second",
          priority: "P1",
          milestoneId: milestone.id,
          sortOrder: 1,
        });
        expect(second.taskCode).toBe("UTASK-002");
        expect(await listUserTasks(db, owner.id, pid)).toHaveLength(2);
        expect(await listUserTasks(db, owner.id, pid, { priority: "P1" })).toHaveLength(1);
        expect(await listUserTasks(db, owner.id, pid, { milestoneId: milestone.id })).toHaveLength(
          1,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("updates in place, keeps codes across milestone moves, and allows DONE", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `utu-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "U", idea: "upd" });
        const pid = project.project.id;
        await createUserTask(db, owner.id, pid, BASE);

        const first = await createMilestone(db, owner.id, pid, { title: "M1" });
        const second = await createMilestone(db, owner.id, pid, { title: "M2" });
        const updated = await updateUserTask(db, owner.id, pid, "UTASK-001", {
          priority: "P2",
          milestoneId: second.id,
        });
        expect(updated.priority).toBe("P2");
        expect(updated.milestoneId).toBe(second.id);
        expect(updated.taskCode).toBe("UTASK-001");

        // Moves keep the stable code; unassigning clears the link.
        const moved = await updateUserTask(db, owner.id, pid, "UTASK-001", {
          milestoneId: first.id,
        });
        expect(moved.milestoneId).toBe(first.id);
        expect(moved.taskCode).toBe("UTASK-001");
        const unassigned = await updateUserTask(db, owner.id, pid, "UTASK-001", {
          milestoneId: null,
        });
        expect(unassigned.milestoneId).toBeNull();

        const noop = await updateUserTask(db, owner.id, pid, "UTASK-001", {});
        expect(noop.priority).toBe("P2");

        // DONE is an ordinary status value here — TASK-092 owns transitions.
        const done = await updateUserTask(db, owner.id, pid, "UTASK-001", { status: "DONE" });
        expect(done.status).toBe("DONE");
        expect(done.acceptanceCriteria).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("validates requirement refs same-project", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `utr-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "R", idea: "refs" });
        const pid = project.project.id;
        await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Login",
          description: "Users can log in.",
          priority: "MUST",
          status: "CONFIRMED",
        });

        const linked = await createUserTask(db, owner.id, pid, {
          ...BASE,
          references: { requirements: ["FR-001"] },
        });
        expect(linked.references?.requirements).toEqual(["FR-001"]);

        await expect(
          createUserTask(db, owner.id, pid, { ...BASE, references: { requirements: ["FR-999"] } }),
        ).rejects.toBeInstanceOf(UserTaskValidationError);
        await expect(
          updateUserTask(db, owner.id, pid, "UTASK-001", {
            references: { requirements: ["FR-999"] },
          }),
        ).rejects.toBeInstanceOf(UserTaskValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("manages queryable dependencies with cycle rejection", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `utd-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "D", idea: "deps" });
        const pid = project.project.id;
        await createUserTask(db, owner.id, pid, { ...BASE, title: "One" });
        await createUserTask(db, owner.id, pid, { ...BASE, title: "Two" });
        await createUserTask(db, owner.id, pid, { ...BASE, title: "Three" });

        const before = await getStateVersion(db, owner.id, pid);
        const edge = await addUserTaskDependency(db, owner.id, pid, "UTASK-002", "UTASK-001");
        expect(edge.taskCode).toBe("UTASK-002");
        expect(edge.dependsOnCode).toBe("UTASK-001");
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 1);

        await expect(
          addUserTaskDependency(db, owner.id, pid, "UTASK-002", "UTASK-001"),
        ).rejects.toBeInstanceOf(UserTaskValidationError);
        await expect(
          addUserTaskDependency(db, owner.id, pid, "UTASK-001", "UTASK-002"),
        ).rejects.toBeInstanceOf(UserTaskValidationError);
        await expect(
          addUserTaskDependency(db, owner.id, pid, "UTASK-001", "UTASK-999"),
        ).rejects.toBeInstanceOf(UserTaskNotFoundError);

        expect(await listUserTaskDependencies(db, owner.id, pid)).toHaveLength(1);
        const prereqs = await listTaskPrerequisites(db, owner.id, pid, "UTASK-002");
        expect(prereqs.map((row) => row.dependsOnCode)).toEqual(["UTASK-001"]);
        const dependents = await listTaskDependents(db, owner.id, pid, "UTASK-001");
        expect(dependents.map((row) => row.taskCode)).toEqual(["UTASK-002"]);

        await removeUserTaskDependency(db, owner.id, pid, "UTASK-002", "UTASK-001");
        expect(await listUserTaskDependencies(db, owner.id, pid)).toHaveLength(0);
        await expect(
          removeUserTaskDependency(db, owner.id, pid, "UTASK-002", "UTASK-001"),
        ).rejects.toBeInstanceOf(UserTaskNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates tasks between users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `ut-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `ut-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        await createUserTask(db, a.id, project.project.id, BASE);

        await expect(
          getUserTaskByCode(db, b.id, project.project.id, "UTASK-001"),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(listUserTasks(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(createUserTask(db, b.id, project.project.id, BASE)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          getUserTaskByCode(db, a.id, project.project.id, "UTASK-999"),
        ).rejects.toBeInstanceOf(UserTaskNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
