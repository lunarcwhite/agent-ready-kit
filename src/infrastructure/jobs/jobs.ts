// Background job infrastructure (TASK-005).
//
// MVP decision: jobs run synchronously inside the request lifecycle.
// Architecture (§43) prescribes platform-supported execution first and
// dedicated queue infrastructure only when proven necessary; none of the
// candidate operations (specification/semantic-validation/task/Agent-Kit
// generation) exists yet, so a queue would be speculation. This module
// provides the stable interface — queue, status, bounded retry, idempotency —
// so TASK-131 can add durable persistence and real background execution
// without changing callers.
//
// Status flow per job: PENDING → RUNNING → SUCCEEDED | FAILED, mirroring
// architecture §56 so future persisted records stay comparable.

import { randomUUID } from "node:crypto";

export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

// Upper bound for automatic attempts per enqueue/retry (AGENTS.md §28:
// retries must be bounded). Callers may lower it per job, never raise it
// past this without an explicit maxAttempts.
export const DEFAULT_MAX_ATTEMPTS = 3;

export class JobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobError";
  }
}

// Marker for permanent failures (bad input, validation, authorization):
// the run stops immediately instead of consuming the retry budget.
// Recoverable failures (timeouts, rate limits) are plain Errors.
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export function isRetryable(error: unknown): boolean {
  return !(error instanceof NonRetryableError);
}

export interface JobDefinition {
  // Free-form operation kind, e.g. "specification.generate".
  // Candidate operations are listed in tasks.md TASK-005.
  kind: string;
  // When set, repeat enqueues return the original record instead of
  // executing again. Recovery of a failed job goes through retry(), not
  // re-enqueue, so one key always means one logical job.
  idempotencyKey?: string;
  // Bounded retry budget for this job; defaults to DEFAULT_MAX_ATTEMPTS.
  maxAttempts?: number;
  // Caller-owned context, opaque to the runner. Keep secrets out
  // (AGENTS.md §55) — TASK-131 must apply retention rules to this field.
  payload?: unknown;
}

export interface JobRecord {
  id: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  idempotencyKey?: string;
  payload?: unknown;
  result?: unknown;
  // Last failure, preserved on FAILED so the state is recoverable and
  // debuggable without re-running. Cleared on success and on retry().
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// FAILED with budget left can be recovered via retry(); exhausted jobs need
// an explicit retry() which opens a fresh budget (see JobQueue.retry).
export function canRetryJob(record: JobRecord): boolean {
  return record.status === "FAILED" && record.attempts < record.maxAttempts;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Persistence boundary. The in-memory implementation below carries MVP;
// TASK-131 adds a database-backed store behind this same interface.
export interface JobStore {
  create(record: JobRecord): void;
  update(record: JobRecord): void;
  get(id: string): JobRecord | undefined;
  findByIdempotencyKey(key: string): JobRecord | undefined;
}

export class InMemoryJobStore implements JobStore {
  private readonly records = new Map<string, JobRecord>();
  private readonly idsByKey = new Map<string, string>();

  create(record: JobRecord): void {
    this.records.set(record.id, record);
    if (record.idempotencyKey !== undefined) this.idsByKey.set(record.idempotencyKey, record.id);
  }

  update(record: JobRecord): void {
    this.records.set(record.id, record);
  }

  get(id: string): JobRecord | undefined {
    return this.records.get(id);
  }

  findByIdempotencyKey(key: string): JobRecord | undefined {
    const id = this.idsByKey.get(key);
    return id === undefined ? undefined : this.records.get(id);
  }
}

export class JobQueue {
  constructor(private readonly store: JobStore = new InMemoryJobStore()) {}

  get(id: string): JobRecord | undefined {
    return this.store.get(id);
  }

  async enqueue<T>(
    definition: JobDefinition,
    execute: (record: JobRecord) => Promise<T> | T,
  ): Promise<JobRecord> {
    // Validate before creating anything: malformed input must not leave
    // a record behind or consume an idempotency key.
    const kind = definition.kind.trim();
    if (kind === "") throw new JobError("Cannot enqueue a job without a kind.");
    const maxAttempts = definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new JobError(
        `Invalid maxAttempts ${JSON.stringify(definition.maxAttempts)}: expected a positive integer.`,
      );
    }
    const idempotencyKey = definition.idempotencyKey?.trim() || undefined;

    // Idempotency check and PENDING registration run before the first await,
    // so concurrent enqueues with the same key collapse onto one record.
    if (idempotencyKey !== undefined) {
      const existing = this.store.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }
    const now = new Date();
    const record: JobRecord = {
      id: randomUUID(),
      kind,
      status: "PENDING",
      attempts: 0,
      maxAttempts,
      idempotencyKey,
      payload: definition.payload,
      createdAt: now,
      updatedAt: now,
    };
    this.store.create(record);
    await this.attempt(record, execute);
    return record;
  }

  // Explicit operator recovery for a FAILED job. Opens a fresh attempt
  // budget: a human re-running a job is a new decision, not a silent retry.
  async retry<T>(id: string, execute: (record: JobRecord) => Promise<T> | T): Promise<JobRecord> {
    const record = this.store.get(id);
    if (!record) throw new JobError(`Unknown job ${JSON.stringify(id)}.`);
    if (record.status !== "FAILED") throw new JobError("Only failed jobs can be retried.");
    record.attempts = 0;
    record.result = undefined;
    record.errorMessage = undefined;
    await this.attempt(record, execute);
    return record;
  }

  // Bounded attempts: retryable errors loop while budget remains, anything
  // else fails the job immediately. Approved state is never touched here —
  // execute() returns a result; persisting it is the caller's decision
  // (AGENTS.md §21, AI boundary).
  private async attempt<T>(
    record: JobRecord,
    execute: (record: JobRecord) => Promise<T> | T,
  ): Promise<void> {
    record.status = "RUNNING";
    record.updatedAt = new Date();
    this.store.update(record);
    while (true) {
      record.attempts += 1;
      try {
        record.result = await execute(record);
        record.status = "SUCCEEDED";
        record.errorMessage = undefined;
        break;
      } catch (error) {
        record.errorMessage = toErrorMessage(error);
        if (!isRetryable(error) || record.attempts >= record.maxAttempts) {
          record.status = "FAILED";
          break;
        }
      }
    }
    record.updatedAt = new Date();
    this.store.update(record);
  }
}
