// Validation issue domain model (TASK-070, database-schema.md §39–§43).
//
// Stores Validation Engine findings (agents.md A-020/A-021 producers) with
// stable ISSUE-* codes from the atomic per-project counter (TASK-004,
// family "ISSUE" → ISSUE-001 per D-C05), never LLM output, never reused.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted mutation numbers the project
// state version once (TASK-020) inside the same transaction as the data
// change, so a rollback never leaves a version pointing at missing state.
//
// Status lifecycle (§42): OPEN ↔ IGNORED, OPEN → RESOLVED, RESOLVED → OPEN
// (reopen). RESOLVED rows are frozen like requirements (TASK-023): only
// reopen edits them. resolved_at is server-owned — stamped on resolve,
// cleared on reopen — never caller-supplied.
//
// Polymorphic refs (§67): issue_references.(reference_type, reference_id)
// cannot use FKs, so the domain validates DECISION / REQUIREMENT /
// KNOWLEDGE_ITEM ids same-project (assertReferenceInScope mirrors the
// knowledge.ts assertSourceInScope pattern — missing and foreign rows
// surface identically as validation errors, never revealing whether
// another user's row exists). TASK refs accept any UUID structurally:
// strict user-task linkage resolves in a follow-up once the user-task
// model lands.
//
// Resolution metadata merges {resolution, reason?, resolvedAt} into
// metadata, preserving existing keys.
//
// Query style note: this module uses the query-builder (select/insert/
// update) rather than the relational db.query API, so it compiles against
// the shared AppDatabase type while the validation tables land in the
// schema registry — the builder needs no registration.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import { decisions } from "../../infrastructure/database/schema/decisions";
import { knowledgeItems } from "../../infrastructure/database/schema/knowledge";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { issueReferences, validationIssues } from "../../infrastructure/database/schema/validation";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { IssueNotFoundError, IssueValidationError } from "./errors";

export const ISSUE_TYPES = [
  "COMPLETENESS",
  "CONSISTENCY",
  "DEPENDENCY",
  "IMPLEMENTATION_COVERAGE",
  "ASSUMPTION",
  "ORPHAN",
  "SECURITY",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_SEVERITIES = ["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_STATUSES = ["OPEN", "RESOLVED", "IGNORED"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_RELATIONSHIPS = ["SOURCE", "AFFECTED"] as const;
export type IssueRelationship = (typeof ISSUE_RELATIONSHIPS)[number];

// Row-backed refs are validated same-project; TASK is structural-only until
// the user-task model lands (see assertReferenceInScope).
export const ISSUE_REFERENCE_TYPES = ["DECISION", "REQUIREMENT", "KNOWLEDGE_ITEM", "TASK"] as const;
export type IssueReferenceType = (typeof ISSUE_REFERENCE_TYPES)[number];

export interface IssueMetadata {
  resolution?: string;
  reason?: string;
  resolvedAt?: string;
  [key: string]: unknown;
}

export interface IssueReferenceInput {
  referenceType: IssueReferenceType;
  referenceId: string;
  relationship: IssueRelationship;
}

export interface IssueReferenceRow {
  id: string;
  issueId: string;
  referenceType: IssueReferenceType;
  referenceId: string;
  relationship: IssueRelationship;
  createdAt: Date;
}

export interface IssueRow {
  id: string;
  projectId: string;
  issueCode: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  status: IssueStatus;
  metadata: IssueMetadata | null;
  resolvedAt: Date | null;
  references: IssueReferenceRow[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIssueInput {
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  metadata?: IssueMetadata | null;
  references?: IssueReferenceInput[];
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  severity?: IssueSeverity;
  type?: IssueType;
  status?: IssueStatus;
}

export interface ListIssuesFilter {
  status?: IssueStatus;
  severity?: IssueSeverity;
  type?: IssueType;
}

const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20000;
const MAX_RESOLUTION_LENGTH = 2000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allowed status moves (§42 policy): OPEN ↔ IGNORED, OPEN → RESOLVED,
// RESOLVED → OPEN (reopen). IGNORED → RESOLVED must reopen first so the
// resolution path (resolveIssue with metadata) stays deliberate.
const ALLOWED_TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]> = {
  OPEN: ["OPEN", "IGNORED", "RESOLVED"],
  IGNORED: ["IGNORED", "OPEN"],
  RESOLVED: ["RESOLVED", "OPEN"],
};

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new IssueValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireText(raw: string, field: string, max: number): string {
  const text = raw.trim();
  if (text === "") throw new IssueValidationError(`${field} is required.`);
  if (text.length > max) {
    throw new IssueValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireOwner(userId: string): void {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
}

function requireReferenceId(raw: string, field: string): string {
  const id = raw.trim();
  if (!UUID_PATTERN.test(id)) {
    throw new IssueValidationError(`${field} must be a UUID.`);
  }
  return id;
}

// Structural validation only — existence/scope checks run inside the
// caller's transaction via assertReferenceInScope. Exact duplicates collapse
// here so one call never doubles a link.
function requireReferences(raw: IssueReferenceInput[] | undefined): IssueReferenceInput[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new IssueValidationError("references must be an array when provided.");
  }
  const seen = new Set<string>();
  const out: IssueReferenceInput[] = [];
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new IssueValidationError(
        `references[${i}] must be { referenceType, referenceId, relationship }.`,
      );
    }
    const candidate = item as {
      referenceType?: unknown;
      referenceId?: unknown;
      relationship?: unknown;
    };
    const referenceType = requireEnum(
      String(candidate.referenceType ?? ""),
      ISSUE_REFERENCE_TYPES,
      `references[${i}].referenceType`,
    );
    const referenceId = requireReferenceId(
      String(candidate.referenceId ?? ""),
      `references[${i}].referenceId`,
    );
    const relationship = requireEnum(
      String(candidate.relationship ?? ""),
      ISSUE_RELATIONSHIPS,
      `references[${i}].relationship`,
    );
    const sig = `${referenceType}::${referenceId}::${relationship}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ referenceType, referenceId, relationship });
  });
  return out;
}

function parseMetadata(raw: unknown): IssueMetadata | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return { ...(raw as Record<string, unknown>) };
}

// Strict same-project check for row-backed reference types. Missing rows and
// foreign rows surface identically as validation errors — the domain never
// reveals whether another user's decision, requirement, or knowledge item
// exists (TASK-014). TASK refs are structural-only: strict user-task linkage
// resolves in a follow-up once the user-task model lands.
async function assertReferenceInScope(
  db: AppDatabase,
  projectId: string,
  referenceType: IssueReferenceType,
  referenceId: string,
): Promise<void> {
  if (referenceType === "TASK") return;
  if (referenceType === "DECISION") {
    const rows = await db
      .select({ id: decisions.id })
      .from(decisions)
      .where(and(eq(decisions.projectId, projectId), eq(decisions.id, referenceId)))
      .limit(1);
    if (rows.length === 0) {
      throw new IssueValidationError("Referenced decision not found in this project.");
    }
    return;
  }
  if (referenceType === "REQUIREMENT") {
    const rows = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(and(eq(requirements.projectId, projectId), eq(requirements.id, referenceId)))
      .limit(1);
    if (rows.length === 0) {
      throw new IssueValidationError("Referenced requirement not found in this project.");
    }
    return;
  }
  const rows = await db
    .select({ id: knowledgeItems.id })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.id, referenceId)))
    .limit(1);
  if (rows.length === 0) {
    throw new IssueValidationError("Referenced knowledge item not found in this project.");
  }
}

function toReferenceRow(raw: typeof issueReferences.$inferSelect): IssueReferenceRow {
  return {
    ...raw,
    referenceType: raw.referenceType as IssueReferenceType,
    relationship: raw.relationship as IssueRelationship,
  };
}

async function loadReferences(db: AppDatabase, issueId: string): Promise<IssueReferenceRow[]> {
  const rows = await db
    .select()
    .from(issueReferences)
    .where(eq(issueReferences.issueId, issueId))
    .orderBy(asc(issueReferences.createdAt));
  return rows.map(toReferenceRow);
}

function toIssueRow(
  raw: typeof validationIssues.$inferSelect,
  references: IssueReferenceRow[],
): IssueRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    issueCode: raw.issueCode,
    type: raw.type as IssueType,
    severity: raw.severity as IssueSeverity,
    title: raw.title,
    description: raw.description,
    status: raw.status as IssueStatus,
    metadata: parseMetadata(raw.metadata),
    resolvedAt: raw.resolvedAt,
    references: [...references].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  issueCode: string,
): Promise<typeof validationIssues.$inferSelect> {
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db
    .select()
    .from(validationIssues)
    .where(
      and(
        eq(validationIssues.projectId, scope.projectId),
        eq(validationIssues.issueCode, issueCode),
      ),
    )
    .limit(1);
  const found = rows[0];
  if (!found) throw new IssueNotFoundError();
  return found;
}

async function withReferences(
  db: AppDatabase,
  issue: typeof validationIssues.$inferSelect,
): Promise<IssueRow> {
  return toIssueRow(issue, await loadReferences(db, issue.id));
}

async function insertReferences(
  db: AppDatabase,
  projectId: string,
  issueId: string,
  references: IssueReferenceInput[],
): Promise<void> {
  for (const ref of references) {
    await assertReferenceInScope(db, projectId, ref.referenceType, ref.referenceId);
    await db.insert(issueReferences).values({
      issueId,
      referenceType: ref.referenceType,
      referenceId: ref.referenceId,
      relationship: ref.relationship,
    });
  }
}

export async function createIssue(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateIssueInput,
): Promise<IssueRow> {
  // All structural validation runs before any write: malformed calls must
  // not create rows or advance the project version.
  requireOwner(userId);
  const type = requireEnum(raw.type, ISSUE_TYPES, "type");
  const severity = requireEnum(raw.severity, ISSUE_SEVERITIES, "severity");
  const title = requireText(raw.title, "title", MAX_TITLE_LENGTH);
  const description = requireText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const references = requireReferences(raw.references);
  const metadata = raw.metadata === undefined ? null : parseMetadata(raw.metadata);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const issueCode = await allocateStableIdTx(tx, scope.projectId, "ISSUE");
    let inserted: typeof validationIssues.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(validationIssues)
        .values({
          projectId: scope.projectId,
          issueCode,
          type,
          severity,
          title,
          description,
          status: "OPEN",
          metadata,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        // Counter race backstop — the allocator owns uniqueness; a clash
        // here means concurrent writers, safe to surface plainly.
        throw new IssueValidationError("Issue code clash, retry the operation.");
      }
      throw error;
    }
    if (!inserted) throw new IssueNotFoundError("Issue creation failed.");
    await insertReferences(tx, scope.projectId, inserted.id, references);
    await incrementStateVersion(tx, userId, scope.projectId);
    return withReferences(tx, inserted);
  });
}

export async function getIssueByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  issueCode: string,
): Promise<IssueRow> {
  requireOwner(userId);
  const code = issueCode.trim();
  if (code === "") throw new IssueValidationError("issueCode is required.");
  return withReferences(db, await loadScoped(db, userId, projectId, code));
}

export async function listIssues(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: ListIssuesFilter,
): Promise<IssueRow[]> {
  requireOwner(userId);
  if (filter?.status !== undefined) requireEnum(filter.status, ISSUE_STATUSES, "status");
  if (filter?.severity !== undefined) requireEnum(filter.severity, ISSUE_SEVERITIES, "severity");
  if (filter?.type !== undefined) requireEnum(filter.type, ISSUE_TYPES, "type");
  const scope = await requireProjectScope(db, userId, projectId);
  const conditions = [eq(validationIssues.projectId, scope.projectId)];
  if (filter?.status !== undefined) {
    conditions.push(eq(validationIssues.status, filter.status));
  }
  if (filter?.severity !== undefined) {
    conditions.push(eq(validationIssues.severity, filter.severity));
  }
  if (filter?.type !== undefined) {
    conditions.push(eq(validationIssues.type, filter.type));
  }
  const rows = await db
    .select()
    .from(validationIssues)
    .where(and(...conditions))
    .orderBy(asc(validationIssues.issueCode));
  const out: IssueRow[] = [];
  for (const row of rows) {
    out.push(await withReferences(db, row));
  }
  return out;
}

export async function updateIssue(
  db: AppDatabase,
  userId: string,
  projectId: string,
  issueCode: string,
  raw: UpdateIssueInput,
): Promise<IssueRow> {
  requireOwner(userId);
  const code = issueCode.trim();
  if (code === "") throw new IssueValidationError("issueCode is required.");
  if (raw.title !== undefined) requireText(raw.title, "title", MAX_TITLE_LENGTH);
  if (raw.description !== undefined)
    requireText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  if (raw.severity !== undefined) requireEnum(raw.severity, ISSUE_SEVERITIES, "severity");
  if (raw.type !== undefined) requireEnum(raw.type, ISSUE_TYPES, "type");
  if (raw.status !== undefined) requireEnum(raw.status, ISSUE_STATUSES, "status");
  const touches =
    raw.title !== undefined ||
    raw.description !== undefined ||
    raw.severity !== undefined ||
    raw.type !== undefined ||
    raw.status !== undefined;

  const current = await loadScoped(db, userId, projectId, code);
  if (!touches) return withReferences(db, current);
  const currentStatus = current.status as IssueStatus;
  if (currentStatus === "RESOLVED") {
    // Frozen like requirements: a resolved issue only reopens — content and
    // severity edits would rewrite auditable history.
    const reopenOnly = raw.status === "OPEN" && touchesStatusOnly(raw);
    if (!reopenOnly) {
      throw new IssueValidationError("A RESOLVED issue is frozen; reopen it to change it.");
    }
  }
  if (raw.status !== undefined) {
    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
    if (!(allowed as readonly string[]).includes(raw.status)) {
      throw new IssueValidationError(
        `Cannot move an issue from ${currentStatus} to ${raw.status}.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    const nextStatus = raw.status ?? currentStatus;
    // resolved_at is server-owned: stamped on resolve, cleared on reopen.
    const resolvedAt =
      nextStatus === "RESOLVED"
        ? (current.resolvedAt ?? new Date())
        : nextStatus === "OPEN" && currentStatus === "RESOLVED"
          ? null
          : current.resolvedAt;
    const [updated] = await tx
      .update(validationIssues)
      .set({
        ...(raw.title !== undefined ? { title: raw.title.trim() } : {}),
        ...(raw.description !== undefined ? { description: raw.description.trim() } : {}),
        ...(raw.severity !== undefined ? { severity: raw.severity } : {}),
        ...(raw.type !== undefined ? { type: raw.type } : {}),
        ...(raw.status !== undefined ? { status: raw.status } : {}),
        ...(raw.status !== undefined ? { resolvedAt } : {}),
      })
      .where(eq(validationIssues.id, current.id))
      .returning();
    if (!updated) throw new IssueNotFoundError();
    await incrementStateVersion(tx, userId, current.projectId);
    return withReferences(tx, updated);
  });
}

function touchesStatusOnly(raw: UpdateIssueInput): boolean {
  return (
    raw.title === undefined &&
    raw.description === undefined &&
    raw.severity === undefined &&
    raw.type === undefined
  );
}

// Idempotent link append (AGENTS.md §94): exact duplicates — against the
// stored rows or within the call — are skipped, so a network retry never
// doubles reference rows. The version bumps only when a row is added.
export async function addIssueReferences(
  db: AppDatabase,
  userId: string,
  projectId: string,
  issueCode: string,
  raw: IssueReferenceInput[],
): Promise<IssueRow> {
  requireOwner(userId);
  const code = issueCode.trim();
  if (code === "") throw new IssueValidationError("issueCode is required.");
  const references = requireReferences(raw);
  const current = await loadScoped(db, userId, projectId, code);
  if ((current.status as IssueStatus) === "RESOLVED") {
    throw new IssueValidationError("A RESOLVED issue is frozen; reopen it to change it.");
  }
  if (references.length === 0) return withReferences(db, current);
  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const existing = await loadReferences(tx, current.id);
    const seen = new Set(
      existing.map((row) => `${row.referenceType}::${row.referenceId}::${row.relationship}`),
    );
    let added = 0;
    for (const ref of references) {
      const sig = `${ref.referenceType}::${ref.referenceId}::${ref.relationship}`;
      if (seen.has(sig)) continue;
      await assertReferenceInScope(tx, scope.projectId, ref.referenceType, ref.referenceId);
      await tx.insert(issueReferences).values({
        issueId: current.id,
        referenceType: ref.referenceType,
        referenceId: ref.referenceId,
        relationship: ref.relationship,
      });
      seen.add(sig);
      added += 1;
    }
    if (added > 0) await incrementStateVersion(tx, userId, scope.projectId);
    const reread = await tx
      .select()
      .from(validationIssues)
      .where(eq(validationIssues.id, current.id))
      .limit(1);
    const found = reread[0];
    if (!found) throw new IssueNotFoundError();
    return withReferences(tx, found);
  });
}

// Blessed resolution path (acceptance: resolution metadata is stored).
// Merges {resolution, reason?, resolvedAt} into metadata, preserving
// existing keys, and stamps server-owned resolved_at. Only OPEN issues
// resolve directly — an IGNORED issue reopens first.
export async function resolveIssue(
  db: AppDatabase,
  userId: string,
  projectId: string,
  issueCode: string,
  resolution: string,
  reason?: string | null,
): Promise<IssueRow> {
  requireOwner(userId);
  const code = issueCode.trim();
  if (code === "") throw new IssueValidationError("issueCode is required.");
  const resolutionText = requireText(resolution, "resolution", MAX_RESOLUTION_LENGTH);
  const reasonText =
    reason === undefined || reason === null || reason.trim() === ""
      ? undefined
      : requireText(reason, "reason", MAX_RESOLUTION_LENGTH);

  const current = await loadScoped(db, userId, projectId, code);
  const currentStatus = current.status as IssueStatus;
  if (currentStatus === "RESOLVED") {
    throw new IssueValidationError("Issue is already RESOLVED; reopen it to change it.");
  }
  if (currentStatus === "IGNORED") {
    throw new IssueValidationError("An IGNORED issue must reopen before it can resolve.");
  }

  return db.transaction(async (tx) => {
    const now = new Date();
    const nextMetadata: IssueMetadata = {
      ...(parseMetadata(current.metadata) ?? {}),
      resolution: resolutionText,
      ...(reasonText !== undefined ? { reason: reasonText } : {}),
      resolvedAt: now.toISOString(),
    };
    const [updated] = await tx
      .update(validationIssues)
      .set({ status: "RESOLVED", metadata: nextMetadata, resolvedAt: now })
      .where(eq(validationIssues.id, current.id))
      .returning();
    if (!updated) throw new IssueNotFoundError();
    await incrementStateVersion(tx, userId, current.projectId);
    return withReferences(tx, updated);
  });
}

export async function listIssueReferences(
  db: AppDatabase,
  userId: string,
  projectId: string,
  issueCode: string,
): Promise<IssueReferenceRow[]> {
  requireOwner(userId);
  const code = issueCode.trim();
  if (code === "") throw new IssueValidationError("issueCode is required.");
  const current = await loadScoped(db, userId, projectId, code);
  return loadReferences(db, current.id);
}
