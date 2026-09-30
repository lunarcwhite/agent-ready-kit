// TASK-023 acceptance: stable FR codes, priority/type/status support,
// structured acceptance criteria, source refs, supersede without reuse.
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
import { RequirementNotFoundError, RequirementValidationError } from "./errors";
import {
  createRequirement,
  getRequirementByCode,
  listRequirements,
  supersedeRequirement,
  updateRequirement,
  type CreateRequirementInput,
} from "./requirements";

const BASE: CreateRequirementInput = {
  type: "FUNCTIONAL",
  title: "Create project",
  description: "The user can create a new project.",
  priority: "MUST",
  status: "CONFIRMED",
  acceptanceCriteria: ["Name is required", "Idea is required"],
  sources: [{ type: "decision", ref: "project.create" }],
};

describe("requirement input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(createRequirement(db, "  ", "p-1", BASE)).rejects.toBeInstanceOf(
      RequirementValidationError,
    );
    await expect(getRequirementByCode(db, "", "p-1", "FR-001")).rejects.toBeInstanceOf(
      RequirementValidationError,
    );
    await expect(listRequirements(db, "", "p-1")).rejects.toBeInstanceOf(
      RequirementValidationError,
    );
    await expect(updateRequirement(db, "", "p-1", "FR-001", {})).rejects.toBeInstanceOf(
      RequirementValidationError,
    );
    await expect(supersedeRequirement(db, "", "p-1", "FR-001", BASE)).rejects.toBeInstanceOf(
      RequirementValidationError,
    );
  });

  it("rejects malformed fields without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(
      createRequirement(db, "u-1", "p-1", { ...BASE, title: "   " }),
    ).rejects.toBeInstanceOf(RequirementValidationError);
    await expect(
      createRequirement(db, "u-1", "p-1", { ...BASE, priority: "URGENT" as never }),
    ).rejects.toBeInstanceOf(RequirementValidationError);
    await expect(
      createRequirement(db, "u-1", "p-1", { ...BASE, type: "EPIC" as never }),
    ).rejects.toBeInstanceOf(RequirementValidationError);
    await expect(
      createRequirement(db, "u-1", "p-1", { ...BASE, status: "SUPERSEDED" }),
    ).rejects.toBeInstanceOf(RequirementValidationError);
    await expect(
      createRequirement(db, "u-1", "p-1", { ...BASE, acceptanceCriteria: [] }),
    ).rejects.toBeInstanceOf(RequirementValidationError);
    await expect(
      createRequirement(db, "u-1", "p-1", { ...BASE, acceptanceCriteria: ["ok", "  "] }),
    ).rejects.toBeInstanceOf(RequirementValidationError);
    await expect(
      createRequirement(db, "u-1", "p-1", {
        ...BASE,
        sources: [{ type: "rumor", ref: "x" } as never],
      }),
    ).rejects.toBeInstanceOf(RequirementValidationError);
    await expect(
      updateRequirement(db, "u-1", "p-1", "FR-001", { status: "SUPERSEDED" }),
    ).rejects.toBeInstanceOf(RequirementValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("requirement domain model (integration)", () => {
  it("creates a requirement with a stable code and bumps the version", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `req-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "R", idea: "reqs" });
        const pid = project.project.id;

        const created = await createRequirement(db, owner.id, pid, BASE);
        expect(created.requirementCode).toBe("FR-001");
        expect(created.acceptanceCriteria).toEqual(["Name is required", "Idea is required"]);
        expect(created.metadata?.sources).toEqual([{ type: "decision", ref: "project.create" }]);
        expect(await getStateVersion(db, owner.id, pid)).toBe(2);

        const reread = await getRequirementByCode(db, owner.id, pid, "FR-001");
        expect(reread.id).toBe(created.id);
        const second = await createRequirement(db, owner.id, pid, {
          ...BASE,
          title: "Second",
          status: "DRAFT",
        });
        expect(second.requirementCode).toBe("FR-002");
        expect(await listRequirements(db, owner.id, pid)).toHaveLength(2);
        expect(await listRequirements(db, owner.id, pid, { status: "DRAFT" })).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("updates in place, freezes superseded rows, and never reuses codes", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `sup-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "S", idea: "sup" });
        const pid = project.project.id;
        await createRequirement(db, owner.id, pid, BASE);

        const updated = await updateRequirement(db, owner.id, pid, "FR-001", {
          priority: "SHOULD",
        });
        expect(updated.priority).toBe("SHOULD");
        expect(updated.requirementCode).toBe("FR-001");

        const noop = await updateRequirement(db, owner.id, pid, "FR-001", {});
        expect(noop.priority).toBe("SHOULD");

        const before = await getStateVersion(db, owner.id, pid);
        const { old, next } = await supersedeRequirement(
          db,
          owner.id,
          pid,
          "FR-001",
          {
            ...BASE,
            title: "Create project v2",
            status: "DRAFT",
          },
          "Split creation into steps.",
        );
        expect(next.requirementCode).toBe("FR-002");
        expect(next.metadata?.supersedes).toBe("FR-001");
        expect(old.status).toBe("SUPERSEDED");
        expect(old.metadata?.supersededBy).toBe("FR-002");
        // One user action, one version.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 1);

        // Frozen rows reject edits and second supersedes; codes advance.
        await expect(
          updateRequirement(db, owner.id, pid, "FR-001", { priority: "MUST" }),
        ).rejects.toBeInstanceOf(RequirementValidationError);
        await expect(
          supersedeRequirement(db, owner.id, pid, "FR-001", { ...BASE, title: "v3" }),
        ).rejects.toBeInstanceOf(RequirementValidationError);
        const third = await createRequirement(db, owner.id, pid, { ...BASE, title: "Third" });
        expect(third.requirementCode).toBe("FR-003");
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates requirements between users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `rq-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `rq-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        await createRequirement(db, a.id, project.project.id, BASE);

        await expect(
          getRequirementByCode(db, b.id, project.project.id, "FR-001"),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(listRequirements(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(createRequirement(db, b.id, project.project.id, BASE)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          getRequirementByCode(db, a.id, project.project.id, "FR-999"),
        ).rejects.toBeInstanceOf(RequirementNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
