// TASK-091 acceptance: milestones contain ordered tasks, milestone order
// never overrides dependency rules, metadata is project-scoped, moves
// keep stable IDs. Persistence proofs skip without a database.
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
import { addUserTaskDependency, listTaskPrerequisites } from "./dependencies";
import { createUserTask, updateUserTask } from "./user-tasks";
import {
  createMilestone,
  getMilestoneByCode,
  listMilestoneTasks,
  listMilestones,
  updateMilestone,
} from "./milestones";

const TASK_BASE = {
  title: "Set up repo",
  objective: "Initialize the repository.",
  priority: "P0" as const,
  acceptanceCriteria: ["Repo exists"],
  definitionOfDone: ["Reviewed"],
};

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("milestone domain model (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "M", idea: "Milestones." });
    return { owner, projectId: created.project.id };
  }

  it("creates MS-coded milestones with ordered, filtered listing", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ms-${Date.now()}@example.com`);

        const second = await createMilestone(db, owner.id, projectId, {
          title: "Build",
          sortOrder: 2,
        });
        expect(second.milestoneCode).toBe("MS-001");
        expect(second.status).toBe("PLANNED");
        const first = await createMilestone(db, owner.id, projectId, {
          title: "Scope",
          sortOrder: 1,
          status: "ACTIVE",
        });
        expect(first.milestoneCode).toBe("MS-002");

        const ordered = await listMilestones(db, owner.id, projectId);
        expect(ordered.map((row) => row.milestoneCode)).toEqual(["MS-002", "MS-001"]);
        expect(
          (await listMilestones(db, owner.id, projectId, { status: "ACTIVE" })).map(
            (row) => row.milestoneCode,
          ),
        ).toEqual(["MS-002"]);
        expect(await getMilestoneByCode(db, owner.id, projectId, "MS-001")).toMatchObject({
          title: "Build",
        });

        const renamed = await updateMilestone(db, owner.id, projectId, "MS-001", {
          title: "Build MVP",
          status: "COMPLETED",
        });
        expect(renamed.title).toBe("Build MVP");
        expect(renamed.status).toBe("COMPLETED");
      });
    } finally {
      await pool.end();
    }
  });

  it("moves tasks between milestones without losing codes or dependency edges", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ms-move-${Date.now()}@example.com`);
        const m1 = await createMilestone(db, owner.id, projectId, { title: "M1" });
        const m2 = await createMilestone(db, owner.id, projectId, { title: "M2" });

        await createUserTask(db, owner.id, projectId, {
          ...TASK_BASE,
          milestoneId: m1.id,
          sortOrder: 2,
        });
        await createUserTask(db, owner.id, projectId, {
          ...TASK_BASE,
          title: "Second",
          milestoneId: m1.id,
          sortOrder: 1,
        });
        await addUserTaskDependency(db, owner.id, projectId, "UTASK-002", "UTASK-001");

        // Containment is ordered by task sort_order, ties by code.
        const contained = await listMilestoneTasks(db, owner.id, projectId, "MS-001");
        expect(contained.taskCodes).toEqual(["UTASK-002", "UTASK-001"]);

        // Milestone moves keep codes and leave the dependency graph intact:
        // display order never overrides dependency rules.
        await updateUserTask(db, owner.id, projectId, "UTASK-002", { milestoneId: m2.id });
        const moved = await listMilestoneTasks(db, owner.id, projectId, "MS-002");
        expect(moved.taskCodes).toEqual(["UTASK-002"]);
        const prerequisites = await listTaskPrerequisites(db, owner.id, projectId, "UTASK-002");
        expect(prerequisites.map((row) => row.dependsOnCode)).toEqual(["UTASK-001"]);
      });
    } finally {
      await pool.end();
    }
  });

  it("scopes milestones per project and rejects unknown links", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ms-scope-${Date.now()}@example.com`);
        await createMilestone(db, owner.id, projectId, { title: "Only" });

        const [other] = await db
          .insert(schema.users)
          .values({ email: `ms-other-${Date.now()}@example.com` })
          .returning();
        const foreign = await createProject(db, other.id, { name: "F", idea: "Foreign." });
        // Cross-project reads surface as NotFound, never as foreign rows.
        await expect(
          getMilestoneByCode(db, other.id, foreign.project.id, "MS-001"),
        ).rejects.toBeInstanceOf(UserTaskNotFoundError);
        await expect(
          createUserTask(db, owner.id, projectId, {
            ...TASK_BASE,
            milestoneId: "11111111-1111-4111-8111-111111111111",
          }),
        ).rejects.toBeInstanceOf(UserTaskNotFoundError);
        await expect(
          createMilestone(db, owner.id, projectId, { title: "  " }),
        ).rejects.toBeInstanceOf(UserTaskValidationError);
      });
    } finally {
      await pool.end();
    }
  });
});
