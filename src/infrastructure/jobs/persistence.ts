// Durable background-job persistence (TASK-131, spec-decisions.md D-A07/08/09).
//
// Database-backed counterpart to the synchronous JobQueue in ./jobs: same
// status flow (PENDING → RUNNING → SUCCEEDED | FAILED), same bounded retry
// budget, same idempotency collapse. Types are reused from ./jobs — this
// module adds only the persistence envelope (owner, project/operation links,
// timestamps) around JobRecord.
//
// Isolation: every function takes userId first and enforces user_id equality
// at the query level, so one user's jobs are unreachable from another. There
// is deliberately NO project-scope gate: project_id is nullable (user-level
// jobs exist), and the user_id predicate alone is the authorization boundary.
//
// Idempotency choice (documented): enqueueJob returns the existing row for a
// repeated (user, key) REGARDLESS of its status — including terminal
// SUCCEEDED/FAILED rows — and never inserts a duplicate. Recovery of a failed
// job goes through claim/complete/fail, mirroring JobQueue.enqueue collapsing
// onto a FAILED record instead of re-running (jobs.test.ts). A unique partial
// index backs this; a race that loses the insert re-reads the winner.
//
// Operational rows, not canonical state: like the ai_operations ledger, no
// function here bumps the project state version.
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../database/db";
import { isUniqueViolationError } from "../database/errors";
import { backgroundJobs } from "../database/schema/jobs";
import { DEFAULT_MAX_ATTEMPTS, JobError, type JobRecord, type JobStatus } from "./jobs";

export const JOB_STATUSES: readonly JobStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"];

// Persisted job: the runner's JobRecord plus the persistence envelope.
// Reuses JobRecord (imported, not duplicated) so runner and store agree on
// status, attempts, budget, payload, and result shapes.
export interface JobRow extends JobRecord {
  userId: string;
  projectId: string | null;
  aiOperationId: string | null;
  errorCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface EnqueueJobInput {
  kind: string;
  projectId?: string;
  aiOperationId?: string;
  maxAttempts?: number;
  idempotencyKey?: string;
  payload?: unknown;
}

export interface FailJobInput {
  errorCode?: string;
  errorMessage?: string;
}

export interface ListJobsFilter {
  status?: JobStatus;
  kind?: string;
  projectId?: string;
}

const MAX_KIND_LENGTH = 64;
const MAX_KEY_LENGTH = 128;
const MAX_ERROR_CODE_LENGTH = 64;
const MAX_ERROR_LENGTH = 2000;
const MAX_ATTEMPTS = 10;

function requireOwner(userId: string): string {
  if (userId.trim() === "") throw new JobError("Owner is required.");
  return userId;
}

function requireId(id: string, field: string): string {
  const value = id.trim();
  if (value === "") throw new JobError(`${field} is required.`);
  return value;
}

function requireKind(raw: string): string {
  const kind = raw.trim();
  if (kind === "") throw new JobError("Cannot enqueue a job without a kind.");
  if (kind.length > MAX_KIND_LENGTH) {
    throw new JobError(`kind must be at most ${MAX_KIND_LENGTH} characters.`);
  }
  return kind;
}

function requireMaxAttempts(raw: number | undefined): number {
  const maxAttempts = raw ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) {
    throw new JobError(
      `Invalid maxAttempts ${JSON.stringify(raw)}: expected an integer 1-${MAX_ATTEMPTS}.`,
    );
  }
  return maxAttempts;
}

function normalizeKey(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const key = raw.trim();
  if (key === "") return null;
  if (key.length > MAX_KEY_LENGTH) {
    throw new JobError(`idempotencyKey must be at most ${MAX_KEY_LENGTH} characters.`);
  }
  return key;
}

function requireJsonSafe(value: unknown, field: string): void {
  if (value === undefined) return;
  try {
    JSON.stringify(value);
  } catch {
    throw new JobError(`${field} must be JSON-serializable.`);
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new JobError(`${field} must be JSON-serializable.`);
  }
}

// Caps failure text and strips credential-shaped fragments before persistence,
// mirroring the ledger's sanitize rule so error rows cannot become secret
// stores. Secrets must never reach payload/result either (AGENTS.md §55).
function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/(sk-[A-Za-z0-9-_]{4})[A-Za-z0-9-_]+/g, "$1…redacted")
    .trim()
    .slice(0, MAX_ERROR_LENGTH);
}

function toRow(raw: typeof backgroundJobs.$inferSelect): JobRow {
  return {
    id: raw.id,
    kind: raw.kind,
    status: raw.status as JobStatus,
    attempts: raw.attempts,
    maxAttempts: raw.maxAttempts,
    ...(raw.idempotencyKey !== null ? { idempotencyKey: raw.idempotencyKey } : {}),
    ...(raw.payload !== null ? { payload: raw.payload } : {}),
    ...(raw.result !== null ? { result: raw.result } : {}),
    ...(raw.errorMessage !== null ? { errorMessage: raw.errorMessage } : {}),
    userId: raw.userId,
    projectId: raw.projectId,
    aiOperationId: raw.aiOperationId,
    errorCode: raw.errorCode,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
  };
}

async function findByKey(
  db: AppDatabase,
  userId: string,
  key: string,
): Promise<JobRow | undefined> {
  const rows = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.idempotencyKey, key)))
    .limit(1);
  const found = rows[0];
  return found === undefined ? undefined : toRow(found);
}

// Insert a PENDING row, collapsing onto the existing row for a repeated
// (user, key) — terminal rows included, never duplicated (see module header).
export async function enqueueJob(
  db: AppDatabase,
  userId: string,
  raw: EnqueueJobInput,
): Promise<JobRow> {
  requireOwner(userId);
  const kind = requireKind(raw.kind);
  const maxAttempts = requireMaxAttempts(raw.maxAttempts);
  const idempotencyKey = normalizeKey(raw.idempotencyKey);
  requireJsonSafe(raw.payload, "payload");
  const projectId = raw.projectId === undefined ? null : requireId(raw.projectId, "projectId");
  const aiOperationId =
    raw.aiOperationId === undefined ? null : requireId(raw.aiOperationId, "aiOperationId");

  if (idempotencyKey !== null) {
    const existing = await findByKey(db, userId, idempotencyKey);
    if (existing) return existing;
  }
  try {
    const [inserted] = await db
      .insert(backgroundJobs)
      .values({
        userId,
        projectId,
        aiOperationId,
        kind,
        status: "PENDING",
        attempts: 0,
        maxAttempts,
        idempotencyKey,
        payload: (raw.payload ?? null) as object | null,
      })
      .returning();
    if (!inserted) throw new JobError("Job creation failed.");
    return toRow(inserted);
  } catch (error) {
    // Lost a concurrent-enqueue race on the partial unique index: the winner
    // owns the key, so return its row instead of surfacing a driver error.
    if (idempotencyKey !== null && isUniqueViolationError(error)) {
      const winner = await findByKey(db, userId, idempotencyKey);
      if (winner) return winner;
    }
    throw error;
  }
}

// Atomically claim a PENDING job: one UPDATE gated on status=PENDING, so two
// workers cannot both take it. Stamps started_at and consumes one attempt.
// Errors reuse JobError (from ./jobs): "Unknown job" when the id is missing
// for this user, a conflict message when it exists but is not PENDING.
export async function claimJob(db: AppDatabase, userId: string, jobId: string): Promise<JobRow> {
  requireOwner(userId);
  const id = requireId(jobId, "jobId");
  const [claimed] = await db
    .update(backgroundJobs)
    .set({
      status: "RUNNING",
      startedAt: new Date(),
      attempts: sql`${backgroundJobs.attempts} + 1`,
    })
    .where(
      and(
        eq(backgroundJobs.id, id),
        eq(backgroundJobs.userId, userId),
        eq(backgroundJobs.status, "PENDING"),
      ),
    )
    .returning();
  if (claimed) return toRow(claimed);
  const current = await getJobOrNull(db, userId, id);
  if (!current) throw new JobError(`Unknown job ${JSON.stringify(id)}.`);
  throw new JobError(
    `Job ${JSON.stringify(id)} is ${current.status}; only PENDING jobs can be claimed.`,
  );
}

// Finish a RUNNING job successfully, preserving its result for debuggability.
// Terminal rows are frozen: completing a non-RUNNING job is a JobError.
export async function completeJob(
  db: AppDatabase,
  userId: string,
  jobId: string,
  result?: unknown,
): Promise<JobRow> {
  requireOwner(userId);
  const id = requireId(jobId, "jobId");
  requireJsonSafe(result, "result");
  const current = await getJobOrNull(db, userId, id);
  if (!current) throw new JobError(`Unknown job ${JSON.stringify(id)}.`);
  if (current.status !== "RUNNING") {
    throw new JobError(
      `Job ${JSON.stringify(id)} is ${current.status}; only RUNNING jobs can be completed.`,
    );
  }
  const [updated] = await db
    .update(backgroundJobs)
    .set({
      status: "SUCCEEDED",
      result: (result ?? null) as object | null,
      errorCode: null,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(eq(backgroundJobs.id, current.id))
    .returning();
  if (!updated) throw new JobError(`Unknown job ${JSON.stringify(id)}.`);
  return toRow(updated);
}

// Fail a RUNNING job with recoverable state: error fields plus attempts are
// preserved so canRetryJob (from ./jobs: FAILED && attempts < maxAttempts)
// decides bounded recovery. Like the ledger, failures must explain
// themselves — at least one error field is required.
export async function failJob(
  db: AppDatabase,
  userId: string,
  jobId: string,
  raw: FailJobInput,
): Promise<JobRow> {
  requireOwner(userId);
  const id = requireId(jobId, "jobId");
  const errorCode =
    raw.errorCode === undefined || raw.errorCode.trim() === ""
      ? null
      : requireId(raw.errorCode, "errorCode");
  if (errorCode !== null && errorCode.length > MAX_ERROR_CODE_LENGTH) {
    throw new JobError(`errorCode must be at most ${MAX_ERROR_CODE_LENGTH} characters.`);
  }
  const errorMessage =
    raw.errorMessage === undefined || raw.errorMessage.trim() === ""
      ? null
      : sanitizeErrorMessage(raw.errorMessage);
  if (errorCode === null && errorMessage === null) {
    throw new JobError("Failed jobs must record an errorCode or errorMessage.");
  }
  const current = await getJobOrNull(db, userId, id);
  if (!current) throw new JobError(`Unknown job ${JSON.stringify(id)}.`);
  if (current.status !== "RUNNING") {
    throw new JobError(
      `Job ${JSON.stringify(id)} is ${current.status}; only RUNNING jobs can be failed.`,
    );
  }
  const [updated] = await db
    .update(backgroundJobs)
    .set({ status: "FAILED", errorCode, errorMessage, completedAt: new Date() })
    .where(eq(backgroundJobs.id, current.id))
    .returning();
  if (!updated) throw new JobError(`Unknown job ${JSON.stringify(id)}.`);
  return toRow(updated);
}

async function getJobOrNull(
  db: AppDatabase,
  userId: string,
  id: string,
): Promise<JobRow | undefined> {
  const rows = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.userId, userId)))
    .limit(1);
  const found = rows[0];
  return found === undefined ? undefined : toRow(found);
}

export async function getJob(db: AppDatabase, userId: string, jobId: string): Promise<JobRow> {
  requireOwner(userId);
  const id = requireId(jobId, "jobId");
  const found = await getJobOrNull(db, userId, id);
  if (!found) throw new JobError(`Unknown job ${JSON.stringify(id)}.`);
  return found;
}

// Newest first. Filters are optional and additive; all queries stay
// user-scoped — projectId filters within the caller's jobs, it does not open
// a project gate (project_id is nullable by design).
export async function listJobs(
  db: AppDatabase,
  userId: string,
  filter?: ListJobsFilter,
): Promise<JobRow[]> {
  requireOwner(userId);
  if (filter?.status !== undefined && !JOB_STATUSES.includes(filter.status)) {
    throw new JobError(`status must be one of ${JOB_STATUSES.join(", ")}.`);
  }
  const kind =
    filter?.kind === undefined || filter.kind.trim() === "" ? undefined : filter.kind.trim();
  if (kind !== undefined && kind.length > MAX_KIND_LENGTH) {
    throw new JobError(`kind must be at most ${MAX_KIND_LENGTH} characters.`);
  }
  const projectId =
    filter?.projectId === undefined ? undefined : requireId(filter.projectId, "projectId");
  const rows = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.userId, userId),
        ...(filter?.status !== undefined ? [eq(backgroundJobs.status, filter.status)] : []),
        ...(kind !== undefined ? [eq(backgroundJobs.kind, kind)] : []),
        ...(projectId !== undefined ? [eq(backgroundJobs.projectId, projectId)] : []),
      ),
    )
    .orderBy(desc(backgroundJobs.createdAt));
  return rows.map(toRow);
}
