// TASK-064 acceptance: stable ENT codes via atomic counter, attribute
// identity per entity, explicit relationships with cardinality, codes
// survive supersede/remove without reuse.
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
import {
  addRelationship,
  createEntity,
  listEntities,
  listEntityDetails,
  removeEntity,
  supersedeEntity,
} from "./entities";
import { EntityValidationError } from "./errors";

describe("entity input validation", () => {
  it("rejects blank owner, blank name, and terminal create statuses", async () => {
    const db = {} as AppDatabase;
    await expect(
      createEntity(db, "  ", "p-1", { name: "Task", status: "DRAFT" }),
    ).rejects.toBeInstanceOf(EntityValidationError);
    await expect(
      createEntity(db, "u-1", "p-1", { name: "  ", status: "DRAFT" }),
    ).rejects.toBeInstanceOf(EntityValidationError);
    await expect(
      createEntity(db, "u-1", "p-1", { name: "Task", status: "SUPERSEDED" }),
    ).rejects.toBeInstanceOf(EntityValidationError);
    await expect(
      addRelationship(db, "u-1", "p-1", {
        sourceCode: " ",
        targetCode: "ENT-001",
        relationshipType: "ONE_TO_MANY",
      }),
    ).rejects.toBeInstanceOf(EntityValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("entities (integration)", () => {
  it("allocates stable ENT codes with attributes and explicit relationships", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `ent-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "E", idea: "ent" });
        const pid = project.project.id;

        const task = await createEntity(db, owner.id, pid, {
          name: "Task",
          status: "CONFIRMED",
          ownershipModel: { owner: "user" },
          lifecycle: { states: ["open", "done"] },
          attributes: [
            { name: "title", dataType: "text", required: true },
            { name: "slug", dataType: "text", uniqueValue: true },
          ],
        });
        expect(task.entityCode).toBe("ENT-001");
        expect(task.attributes.map((a) => a.name).sort()).toEqual(["slug", "title"]);

        const projectEntity = await createEntity(db, owner.id, pid, {
          name: "Project",
          status: "CONFIRMED",
        });
        expect(projectEntity.entityCode).toBe("ENT-002");

        const rel = await addRelationship(db, owner.id, pid, {
          sourceCode: projectEntity.entityCode,
          targetCode: task.entityCode,
          relationshipType: "ONE_TO_MANY",
        });
        expect(rel.relationshipType).toBe("ONE_TO_MANY");

        const { entities, relationships } = await listEntityDetails(db, owner.id, pid);
        expect(entities).toHaveLength(2);
        expect(relationships.map((r) => `${r.sourceCode}→${r.targetCode}`)).toEqual([
          "ENT-002→ENT-001",
        ]);
        expect(await listEntities(db, owner.id, pid)).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("never reuses codes across supersede and removal", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `entreuse-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "R", idea: "reuse" });
        const pid = project.project.id;

        const first = await createEntity(db, owner.id, pid, {
          name: "Task v1",
          status: "CONFIRMED",
        });
        const { next } = await supersedeEntity(db, owner.id, pid, first.entityCode, {
          name: "Task v2",
          status: "DRAFT",
        });
        expect(next.entityCode).toBe("ENT-002");
        await removeEntity(db, owner.id, pid, next.entityCode);
        const third = await createEntity(db, owner.id, pid, {
          name: "Task v3",
          status: "DRAFT",
        });
        expect(third.entityCode).toBe("ENT-003");
      });
    } finally {
      await pool.end();
    }
  });
});
