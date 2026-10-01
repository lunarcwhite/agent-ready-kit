// TASK-043 acceptance: success/failure recorded, secrets never persisted,
// user/project scoping, debuggable history.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { createProject } from "../../modules/projects/repository";
import { ProjectNotFoundError } from "../../modules/projects/errors";
import { OperationNotFoundError, OperationValidationError } from "./errors";
import {
  finishOperation,
  getOperation,
  listOperations,
  saveOperationPayloads,
  startOperation,
} from "./ledger";

const BASE = {
  capability: "answer-extraction",
  operationType: "ANSWER_EXTRACTION",
  provider: "fake",
  model: "fake-1",
  promptKey: "discovery.extract-answer",
  promptVersion: "1.2",
  projectStateVersion: 3,
};

describe("ledger input validation", () => {
  it("rejects blank owner and malformed fields without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(startOperation(db, "  ", BASE)).rejects.toBeInstanceOf(OperationValidationError);
    await expect(startOperation(db, "u-1", { ...BASE, capability: "" })).rejects.toBeInstanceOf(
      OperationValidationError,
    );
    await expect(finishOperation(db, "", "op-1", { status: "SUCCEEDED" })).rejects.toBeInstanceOf(
      OperationValidationError,
    );
    await expect(
      finishOperation(db, "u-1", "op-1", { status: "COMPLETE" as never }),
    ).rejects.toBeInstanceOf(OperationValidationError);
    await expect(getOperation(db, "", "op-1")).rejects.toBeInstanceOf(OperationValidationError);
    await expect(listOperations(db, "")).rejects.toBeInstanceOf(OperationValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("operation ledger (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "O", idea: "ops" });
    return { owner, projectId: project.project.id };
  }

  it("records success with usage, cost, and payloads", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ops-${Date.now()}@example.com`);
        const opened = await startOperation(db, owner.id, { ...BASE, projectId });
        expect(opened.status).toBe("RUNNING");
        expect(opened.promptVersion).toBe("1.2");
        expect(opened.projectStateVersion).toBe(3);

        await saveOperationPayloads(db, owner.id, opened.id, {
          input: { system: "s" },
          output: { decisions: [] },
        });
        const done = await finishOperation(db, owner.id, opened.id, {
          status: "SUCCEEDED",
          inputTokens: 120,
          outputTokens: 40,
          estimatedCost: 0.0003,
          latencyMs: 812,
        });
        expect(done.status).toBe("SUCCEEDED");
        expect(done.completedAt).toBeInstanceOf(Date);

        const listed = await listOperations(db, owner.id, { projectId });
        expect(listed.map((row) => row.id)).toEqual([done.id]);
      });
    } finally {
      await pool.end();
    }
  });

  it("records failure with sanitized errors and freezes terminal rows", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `opf-${Date.now()}@example.com`);
        const opened = await startOperation(db, owner.id, { ...BASE, projectId });

        // Failures must explain themselves.
        await expect(
          finishOperation(db, owner.id, opened.id, { status: "FAILED" }),
        ).rejects.toBeInstanceOf(OperationValidationError);

        const failed = await finishOperation(db, owner.id, opened.id, {
          status: "FAILED",
          errorCode: "TIMEOUT",
          errorMessage: "timed out with sk-live-secret-value inside",
          latencyMs: 30000,
        });
        expect(failed.status).toBe("FAILED");
        expect(failed.errorMessage).not.toContain("sk-live-secret-value");

        // Terminal rows are frozen: no rewriting history.
        await expect(
          finishOperation(db, owner.id, opened.id, { status: "SUCCEEDED" }),
        ).rejects.toBeInstanceOf(OperationValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates ledgers between users and scopes by project", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `op-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `op-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        const opened = await startOperation(db, a.id, { ...BASE, projectId: project.project.id });

        await expect(getOperation(db, b.id, opened.id)).rejects.toBeInstanceOf(
          OperationNotFoundError,
        );
        await expect(
          finishOperation(db, b.id, opened.id, { status: "SUCCEEDED" }),
        ).rejects.toBeInstanceOf(OperationNotFoundError);
        expect(await listOperations(db, b.id)).toEqual([]);
        await expect(
          listOperations(db, b.id, { projectId: project.project.id }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        // Unscoped rows (no project) still list for their owner.
        const global = await startOperation(db, a.id, BASE);
        expect((await listOperations(db, a.id)).map((row) => row.id)).toContain(global.id);
      });
    } finally {
      await pool.end();
    }
  });
});
