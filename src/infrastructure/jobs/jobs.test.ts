// TASK-005 acceptance coverage for the synchronous job runner:
// queueing, persisted status, recoverable failure, bounded retry,
// and idempotent enqueue. No timers, no I/O, no live providers.
import { describe, expect, it, vi } from "vitest";
import {
  canRetryJob,
  DEFAULT_MAX_ATTEMPTS,
  InMemoryJobStore,
  isRetryable,
  JobError,
  JobQueue,
  NonRetryableError,
  type JobRecord,
  type JobStatus,
  type JobStore,
} from "./jobs";

// Exposes the status transitions a durable TASK-131 store must persist.
class RecordingStore extends InMemoryJobStore {
  readonly seen: JobStatus[] = [];
  override create(record: JobRecord): void {
    this.seen.push(record.status);
    super.create(record);
  }
  override update(record: JobRecord): void {
    this.seen.push(record.status);
    super.update(record);
  }
}

function alwaysFail(message = "boom"): () => Promise<never> {
  return () => Promise.reject(new Error(message));
}

describe("job queue (synchronous MVP executor)", () => {
  it("runs an enqueued job immediately and persists its status", async () => {
    const store = new InMemoryJobStore();
    const done = await new JobQueue(store).enqueue(
      { kind: "specification.generate", payload: { section: "overview" } },
      async () => "rendered",
    );
    expect(done.status).toBe("SUCCEEDED");
    expect(done.attempts).toBe(1);
    expect(done.result).toBe("rendered");
    expect(done.payload).toEqual({ section: "overview" });
    expect(done.errorMessage).toBeUndefined();
    // Status is persisted: a second handle over the same store sees it.
    const reread = new JobQueue(store).get(done.id);
    expect(reread?.status).toBe("SUCCEEDED");
    expect(reread?.result).toBe("rendered");
  });

  it("persists PENDING → RUNNING → SUCCEEDED transitions", async () => {
    const store = new RecordingStore();
    const done = await new JobQueue(store).enqueue({ kind: "tasks.generate" }, () => "ok");
    expect(done.status).toBe("SUCCEEDED");
    expect(store.seen).toEqual(["PENDING", "RUNNING", "SUCCEEDED"]);
  });

  it("retries recoverable failures within a bounded budget", async () => {
    let calls = 0;
    const done = await new JobQueue().enqueue(
      { kind: "validation.semantic", maxAttempts: 3 },
      () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "steady";
      },
    );
    expect(done.status).toBe("SUCCEEDED");
    expect(done.attempts).toBe(3);
    expect(done.result).toBe("steady");
    expect(done.errorMessage).toBeUndefined();
  });

  it("caps attempts at the default budget when none is given", async () => {
    const done = await new JobQueue().enqueue({ kind: "agent-kit.generate" }, alwaysFail());
    expect(done.status).toBe("FAILED");
    expect(done.attempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(done.errorMessage).toBe("boom");
  });

  it("exposes recoverable FAILED state with attempts and error preserved", async () => {
    const store: JobStore = new InMemoryJobStore();
    const queue = new JobQueue(store);
    const done = await queue.enqueue(
      { kind: "tasks.generate", maxAttempts: 2 },
      alwaysFail("timeout"),
    );
    expect(done.status).toBe("FAILED");
    expect(done.attempts).toBe(2);
    expect(done.errorMessage).toBe("timeout");
    expect(done.result).toBeUndefined();
    expect(canRetryJob(done)).toBe(false); // budget exhausted
    expect(queue.get(done.id)?.status).toBe("FAILED"); // visible without re-running
  });

  it("stops immediately on permanent failures without consuming the budget", async () => {
    const done = await new JobQueue().enqueue(
      { kind: "specification.generate", maxAttempts: 3 },
      () => {
        throw new NonRetryableError("invalid input");
      },
    );
    expect(done.status).toBe("FAILED");
    expect(done.attempts).toBe(1);
    expect(done.errorMessage).toBe("invalid input");
    expect(canRetryJob(done)).toBe(true); // budget left, operator may retry
  });

  it("recovers failed jobs through explicit retry with a fresh budget", async () => {
    const queue = new JobQueue();
    const failed = await queue.enqueue(
      { kind: "validation.semantic", maxAttempts: 1 },
      alwaysFail(),
    );
    expect(failed.status).toBe("FAILED");
    const recovered = await queue.retry(failed.id, () => "recovered");
    expect(recovered.id).toBe(failed.id);
    expect(recovered.status).toBe("SUCCEEDED");
    expect(recovered.attempts).toBe(1);
    expect(recovered.result).toBe("recovered");
    expect(recovered.errorMessage).toBeUndefined();
  });

  it("rejects retry of non-failed jobs and unknown jobs", async () => {
    const queue = new JobQueue();
    const done = await queue.enqueue({ kind: "tasks.generate" }, () => "ok");
    await expect(queue.retry(done.id, () => "again")).rejects.toBeInstanceOf(JobError);
    await expect(queue.retry("no-such-job", () => "again")).rejects.toBeInstanceOf(JobError);
  });

  it("prevents duplicate execution via idempotency key", async () => {
    const queue = new JobQueue();
    const execute = vi.fn(async () => "once");
    const first = await queue.enqueue(
      { kind: "agent-kit.generate", idempotencyKey: "kit-1" },
      execute,
    );
    const second = await queue.enqueue(
      { kind: "agent-kit.generate", idempotencyKey: "kit-1" },
      execute,
    );
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("SUCCEEDED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("recovers failed jobs via retry, not re-enqueue", async () => {
    const queue = new JobQueue();
    const execute = vi.fn(alwaysFail());
    const failed = await queue.enqueue(
      { kind: "agent-kit.generate", idempotencyKey: "kit-2", maxAttempts: 1 },
      execute,
    );
    expect(failed.status).toBe("FAILED");
    // Re-enqueue collapses onto the same FAILED record instead of re-running.
    const same = await queue.enqueue(
      { kind: "agent-kit.generate", idempotencyKey: "kit-2", maxAttempts: 1 },
      execute,
    );
    expect(same.id).toBe(failed.id);
    expect(same.status).toBe("FAILED");
    expect(execute).toHaveBeenCalledTimes(1);
    const recovered = await queue.retry(failed.id, () => "ok");
    expect(recovered.status).toBe("SUCCEEDED");
  });

  it("rejects malformed definitions without consuming the idempotency key", async () => {
    const queue = new JobQueue();
    await expect(queue.enqueue({ kind: "  " }, () => "ok")).rejects.toBeInstanceOf(JobError);
    await expect(
      queue.enqueue({ kind: "tasks.generate", maxAttempts: 0 }, () => "ok"),
    ).rejects.toBeInstanceOf(JobError);
    const done = await queue.enqueue(
      { kind: "tasks.generate", idempotencyKey: "fresh-key" },
      () => "ok",
    );
    expect(done.status).toBe("SUCCEEDED");
  });
});

describe("retry helpers", () => {
  it("marks retryable errors and exhausted or finished jobs correctly", () => {
    expect(isRetryable(new Error("timeout"))).toBe(true);
    expect(isRetryable("plain string failure")).toBe(true);
    expect(isRetryable(new NonRetryableError("bad input"))).toBe(false);
    const retryable: JobRecord = {
      id: "a",
      kind: "k",
      status: "FAILED",
      attempts: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(canRetryJob(retryable)).toBe(true);
    expect(canRetryJob({ ...retryable, attempts: 3 })).toBe(false);
    expect(canRetryJob({ ...retryable, status: "SUCCEEDED" })).toBe(false);
  });
});
