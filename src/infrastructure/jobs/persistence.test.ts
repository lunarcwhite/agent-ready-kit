// TASK-131 acceptance: persisted status lifecycle, ai_operations link,
// recoverable FAILED state with bounded retry, idempotent enqueue.
//
// Unit tests pin validation without a database (db stub is never touched —
// every function validates owner/inputs first). Row-level proofs run as
// rolled-back integration tests — skipped, not failed, without
// TEST_DATABASE_URL/DATABASE_URL.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../database/db";
import * as schema from "../database/schema";
import { getIntegrationDatabaseUrl, withRolledBackTransaction } from "../database/test-utils";
import { JobError, canRetryJob } from "./jobs";
import { claimJob, completeJob, enqueueJob, failJob, getJob, listJobs } from "./persistence";
import { createProject } from "../../modules/projects/repository";

describe("job persistence input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(enqueueJob(db, "  ", { kind: "spec.generate" })).rejects.toBeInstanceOf(JobError);
    await expect(claimJob(db, "", "j-1")).rejects.toBeInstanceOf(JobError);
    await expect(completeJob(db, "", "j-1")).rejects.toBeInstanceOf(JobError);
    await expect(failJob(db, "", "j-1", { errorCode: "X" })).rejects.toBeInstanceOf(JobError);
    await expect(getJob(db, "", "j-1")).rejects.toBeInstanceOf(JobError);
    await expect(listJobs(db, "")).rejects.toBeInstanceOf(JobError);
  });

  it("rejects blank ids without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(claimJob(db, "u-1", "  ")).rejects.toBeInstanceOf(JobError);
    await expect(getJob(db, "u-1", "")).rejects.toBeInstanceOf(JobError);
    await expect(completeJob(db, "u-1", "  ")).rejects.toBeInstanceOf(JobError);
    await expect(failJob(db, "u-1", "", { errorCode: "X" })).rejects.toBeInstanceOf(JobError);
  });

  it("rejects malformed enqueue input without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(enqueueJob(db, "u-1", { kind: "   " })).rejects.toBeInstanceOf(JobError);
    await expect(enqueueJob(db, "u-1", { kind: "k".repeat(65) })).rejects.toBeInstanceOf(JobError);
    await expect(enqueueJob(db, "u-1", { kind: "k", maxAttempts: 0 })).rejects.toBeInstanceOf(
      JobError,
    );
    await expect(enqueueJob(db, "u-1", { kind: "k", maxAttempts: 11 })).rejects.toBeInstanceOf(
      JobError,
    );
    await expect(enqueueJob(db, "u-1", { kind: "k", maxAttempts: 1.5 })).rejects.toBeInstanceOf(
      JobError,
    );
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(enqueueJob(db, "u-1", { kind: "k", payload: circular })).rejects.toBeInstanceOf(
      JobError,
    );
    await expect(
      enqueueJob(db, "u-1", { kind: "k", idempotencyKey: "k".repeat(129) }),
    ).rejects.toBeInstanceOf(JobError);
  });

  it("rejects malformed terminal transitions without touching the database", async () => {
    const db = {} as AppDatabase;
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(completeJob(db, "u-1", "j-1", circular)).rejects.toBeInstanceOf(JobError);
    await expect(failJob(db, "u-1", "j-1", {})).rejects.toBeInstanceOf(JobError);
    await expect(failJob(db, "u-1", "j-1", { errorCode: "E".repeat(65) })).rejects.toBeInstanceOf(
      JobError,
    );
  });

  it("rejects malformed list filters without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(listJobs(db, "u-1", { status: "DONE" as never })).rejects.toBeInstanceOf(JobError);
    await expect(listJobs(db, "u-1", { kind: "k".repeat(65) })).rejects.toBeInstanceOf(JobError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("job persistence (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "J", idea: "jobs" });
    return { owner, projectId: project.project.id };
  }

  it("runs PENDING → RUNNING → SUCCEEDED with result preserved", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema }) as AppDatabase;
        const { owner, projectId } = await setup(db, `job-${Date.now()}@example.com`);

        const enqueued = await enqueueJob(db, owner.id, {
          kind: "specification.generate",
          projectId,
          maxAttempts: 3,
          payload: { section: "overview" },
        });
        expect(enqueued.status).toBe("PENDING");
        expect(enqueued.attempts).toBe(0);
        expect(enqueued.maxAttempts).toBe(3);

        const claimed = await claimJob(db, owner.id, enqueued.id);
        expect(claimed.status).toBe("RUNNING");
        expect(claimed.attempts).toBe(1);
        expect(claimed.startedAt).toBeInstanceOf(Date);

        const done = await completeJob(db, owner.id, enqueued.id, { markdown: "# PRD" });
        expect(done.status).toBe("SUCCEEDED");
        expect(done.result).toEqual({ markdown: "# PRD" });
        expect(done.completedAt).toBeInstanceOf(Date);

        // Terminal rows are frozen.
        await expect(completeJob(db, owner.id, enqueued.id)).rejects.toBeInstanceOf(JobError);
        await expect(claimJob(db, owner.id, enqueued.id)).rejects.toBeInstanceOf(JobError);

        // Second claim on a fresh job fails after the first wins (atomic).
        const second = await enqueueJob(db, owner.id, { kind: "tasks.generate" });
        await claimJob(db, owner.id, second.id);
        await expect(claimJob(db, owner.id, second.id)).rejects.toThrow(
          /only PENDING jobs can be claimed/,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("collapses repeat enqueues onto one row, terminal rows included", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema }) as AppDatabase;
        const { owner } = await setup(db, `jid-${Date.now()}@example.com`);

        const first = await enqueueJob(db, owner.id, {
          kind: "agent-kit.generate",
          idempotencyKey: "kit-1",
        });
        const same = await enqueueJob(db, owner.id, {
          kind: "agent-kit.generate",
          idempotencyKey: "kit-1",
        });
        expect(same.id).toBe(first.id);

        // Fail it, then re-enqueue: still the same FAILED row, never a
        // duplicate — recovery goes through claim/fail, not re-enqueue.
        await claimJob(db, owner.id, first.id);
        await failJob(db, owner.id, first.id, { errorCode: "TIMEOUT" });
        const again = await enqueueJob(db, owner.id, {
          kind: "agent-kit.generate",
          idempotencyKey: "kit-1",
        });
        expect(again.id).toBe(first.id);
        expect(again.status).toBe("FAILED");
        expect(await listJobs(db, owner.id, { kind: "agent-kit.generate" })).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("exposes recoverable FAILED state with a bounded retry budget", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema }) as AppDatabase;
        const { owner } = await setup(db, `jfr-${Date.now()}@example.com`);

        // Failures must explain themselves.
        const pending = await enqueueJob(db, owner.id, { kind: "tasks.generate" });
        await claimJob(db, owner.id, pending.id);
        await expect(failJob(db, owner.id, pending.id, {})).rejects.toBeInstanceOf(JobError);

        const failed = await failJob(db, owner.id, pending.id, {
          errorCode: "TIMEOUT",
          errorMessage: "timed out with sk-live-secret-value inside",
        });
        expect(failed.status).toBe("FAILED");
        expect(failed.errorCode).toBe("TIMEOUT");
        expect(failed.errorMessage).not.toContain("sk-live-secret-value");
        expect(failed.completedAt).toBeInstanceOf(Date);
        // Bounded retry reuses the runner's rule: FAILED with budget left.
        expect(canRetryJob(failed)).toBe(true);

        const exhausted = await enqueueJob(db, owner.id, {
          kind: "tasks.generate",
          maxAttempts: 1,
        });
        await claimJob(db, owner.id, exhausted.id);
        const dead = await failJob(db, owner.id, exhausted.id, { errorCode: "TIMEOUT" });
        expect(canRetryJob(dead)).toBe(false);
      });
    } finally {
      await pool.end();
    }
  });

  it("links jobs to ai_operations and isolates users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema }) as AppDatabase;
        const { owner, projectId } = await setup(db, `jlk-${Date.now()}@example.com`);
        const [other] = await db
          .insert(schema.users)
          .values({ email: `jlk-other-${Date.now()}@example.com` })
          .returning();

        const op = await db
          .insert(schema.aiOperations)
          .values({
            projectId,
            userId: owner.id,
            capability: "spec-compilation",
            operationType: "SPEC_COMPILATION",
            provider: "fake",
            model: "fake-1",
            status: "RUNNING",
          })
          .returning();
        const job = await enqueueJob(db, owner.id, {
          kind: "specification.generate",
          projectId,
          aiOperationId: op[0].id,
        });
        expect(job.aiOperationId).toBe(op[0].id);

        // Cross-user reads and transitions are unreachable: user_id equality
        // is enforced at query level on every function.
        await expect(getJob(db, other.id, job.id)).rejects.toBeInstanceOf(JobError);
        await expect(claimJob(db, other.id, job.id)).rejects.toBeInstanceOf(JobError);
        await expect(listJobs(db, other.id)).resolves.toEqual([]);

        // Filters: status/kind/project, newest first.
        await enqueueJob(db, owner.id, { kind: "tasks.generate", projectId });
        const newest = await listJobs(db, owner.id);
        expect(newest.map((row) => row.kind)).toEqual(["tasks.generate", "specification.generate"]);
        expect(await listJobs(db, owner.id, { projectId })).toHaveLength(2);
        expect(await listJobs(db, owner.id, { status: "PENDING" })).toHaveLength(2);
        expect(await listJobs(db, owner.id, { kind: "specification.generate" })).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });
});
