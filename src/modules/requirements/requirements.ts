// Requirement domain model (TASK-023, database-schema.md §22–§25).
//
// Stable implementation-relevant requirements, independent from generated
// PRD prose. Codes (FR-001…) are atomic per-project sequences, never LLM
// output, never reused — including across supersede chains and removals.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted change (create/update/
// supersede) numbers the project state version once (TASK-020).
//
// Supersede is the blessed replacement path: the old row freezes as
// SUPERSEDED with metadata.supersededBy, the successor carries
// metadata.supersedes. Direct writes to SUPERSEDED are rejected — a
// supersede without a successor is an orphan by definition.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { RequirementNotFoundError, RequirementValidationError } from "./errors";

export const REQUIREMENT_TYPES = [
  "FUNCTIONAL",
  "NON_FUNCTIONAL",
  "BUSINESS_RULE",
  "CONSTRAINT",
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_PRIORITIES = ["MUST", "SHOULD", "COULD", "WONT"] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

export const REQUIREMENT_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "DEFERRED",
  "SUPERSEDED",
  "REMOVED",
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const REQUIREMENT_SOURCE_TYPES = ["decision", "knowledge"] as const;
export type RequirementSourceType = (typeof REQUIREMENT_SOURCE_TYPES)[number];

export interface RequirementSource {
  type: RequirementSourceType;
  ref: string;
}

export interface RequirementMetadata {
  sources?: RequirementSource[];
  supersedes?: string;
  supersededBy?: string;
  supersedeReason?: string;
}

export interface RequirementRow {
  id: string;
  projectId: string;
  requirementCode: string;
  type: RequirementType;
  title: string;
  description: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  acceptanceCriteria: string[] | null;
  metadata: RequirementMetadata | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRequirementInput {
  type: RequirementType;
  title: string;
  description: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  acceptanceCriteria?: string[];
  sources?: RequirementSource[];
}

export interface UpdateRequirementInput {
  title?: string;
  description?: string;
  priority?: RequirementPriority;
  type?: RequirementType;
  status?: RequirementStatus;
  acceptanceCriteria?: string[] | null;
  sources?: RequirementSource[] | null;
}

const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20000;
const MAX_REF_LENGTH = 128;

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new RequirementValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireText(raw: string, field: string, max: number): string {
  const text = raw.trim();
  if (text === "") throw new RequirementValidationError(`${field} is required.`);
  if (text.length > max) {
    throw new RequirementValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireCriteria(raw: string[] | undefined | null, field: string): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new RequirementValidationError(
      `${field} must be a non-empty array of strings when provided.`,
    );
  }
  return raw.map((item, i) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new RequirementValidationError(`${field}[${i}] must be a non-empty string.`);
    }
    return item.trim();
  });
}

function requireSources(raw: RequirementSource[] | undefined | null): RequirementSource[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    throw new RequirementValidationError("sources must be an array when provided.");
  }
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new RequirementValidationError(`sources[${i}] must be { type, ref }.`);
    }
    const type = requireEnum(
      String((item as { type?: unknown }).type ?? ""),
      REQUIREMENT_SOURCE_TYPES,
      `sources[${i}].type`,
    );
    const ref = String((item as { ref?: unknown }).ref ?? "").trim();
    if (ref === "" || ref.length > MAX_REF_LENGTH) {
      throw new RequirementValidationError(
        `sources[${i}].ref must be 1-${MAX_REF_LENGTH} characters.`,
      );
    }
    return { type, ref };
  });
}

function parseMetadata(raw: unknown): RequirementMetadata | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  const out: RequirementMetadata = {};
  if (Array.isArray(meta.sources)) {
    try {
      const sources = requireSources(meta.sources as RequirementSource[]);
      if (sources) out.sources = sources;
    } catch {
      return null;
    }
  }
  if (typeof meta.supersedes === "string") out.supersedes = meta.supersedes;
  if (typeof meta.supersededBy === "string") out.supersededBy = meta.supersededBy;
  if (typeof meta.supersedeReason === "string") out.supersedeReason = meta.supersedeReason;
  return Object.keys(out).length > 0 ? out : null;
}

function buildMetadata(
  sources: RequirementSource[] | null,
  extra?: Pick<RequirementMetadata, "supersedes" | "supersededBy">,
): RequirementMetadata | null {
  const meta: RequirementMetadata = {};
  if (sources && sources.length > 0) meta.sources = sources;
  if (extra?.supersedes) meta.supersedes = extra.supersedes;
  if (extra?.supersededBy) meta.supersededBy = extra.supersededBy;
  return Object.keys(meta).length > 0 ? meta : null;
}

function toRow(raw: typeof requirements.$inferSelect): RequirementRow {
  return {
    ...raw,
    type: raw.type as RequirementType,
    priority: raw.priority as RequirementPriority,
    status: raw.status as RequirementStatus,
    acceptanceCriteria: (raw.acceptanceCriteria ?? null) as string[] | null,
    metadata: parseMetadata(raw.metadata),
  };
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  requirementCode: string,
): Promise<RequirementRow> {
  const scope = await requireProjectScope(db, userId, projectId);
  const found = await db.query.requirements.findFirst({
    where: and(
      eq(requirements.projectId, scope.projectId),
      eq(requirements.requirementCode, requirementCode),
    ),
  });
  if (!found) throw new RequirementNotFoundError();
  return toRow(found);
}

// Unique violations surface as driver errors (pg 23505, possibly wrapped by
// drizzle layers). Mirrors decisions.ts — kept local so this module never
// depends on a sibling domain for an infrastructure concern.
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (depth > 3 || typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === "23505") return true;
  return "cause" in error
    ? isUniqueViolation((error as { cause?: unknown }).cause, depth + 1)
    : false;
}

export async function createRequirement(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateRequirementInput,
): Promise<RequirementRow> {
  if (userId.trim() === "") throw new RequirementValidationError("Owner is required.");
  const type = requireEnum(raw.type, REQUIREMENT_TYPES, "type");
  const title = requireText(raw.title, "title", MAX_TITLE_LENGTH);
  const description = requireText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const priority = requireEnum(raw.priority, REQUIREMENT_PRIORITIES, "priority");
  const status = requireEnum(raw.status, REQUIREMENT_STATUSES, "status");
  if (status === "SUPERSEDED") {
    throw new RequirementValidationError("Use supersedeRequirement to create a successor.");
  }
  const acceptanceCriteria = requireCriteria(raw.acceptanceCriteria, "acceptanceCriteria");
  const sources = requireSources(raw.sources);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const requirementCode = await allocateStableIdTx(tx, scope.projectId, "FR");
    let inserted: typeof requirements.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(requirements)
        .values({
          projectId: scope.projectId,
          requirementCode,
          type,
          title,
          description,
          priority,
          status,
          acceptanceCriteria,
          metadata: buildMetadata(sources),
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Counter race backstop — the allocator owns uniqueness; a clash
        // here means concurrent writers, safe to surface plainly.
        throw new RequirementValidationError("Requirement code clash, retry the operation.");
      }
      throw error;
    }
    if (!inserted) throw new RequirementNotFoundError("Requirement creation failed.");
    const row = toRow(inserted);
    await incrementStateVersion(tx, userId, scope.projectId);
    return row;
  });
}

export async function getRequirementByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  requirementCode: string,
): Promise<RequirementRow> {
  if (userId.trim() === "") throw new RequirementValidationError("Owner is required.");
  const code = requirementCode.trim();
  if (code === "") throw new RequirementValidationError("requirementCode is required.");
  return loadScoped(db, userId, projectId, code);
}

export async function listRequirements(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: { status?: RequirementStatus },
): Promise<RequirementRow[]> {
  if (userId.trim() === "") throw new RequirementValidationError("Owner is required.");
  if (filter?.status !== undefined) requireEnum(filter.status, REQUIREMENT_STATUSES, "status");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.requirements.findMany({
    where:
      filter?.status === undefined
        ? eq(requirements.projectId, scope.projectId)
        : and(eq(requirements.projectId, scope.projectId), eq(requirements.status, filter.status)),
    orderBy: [asc(requirements.requirementCode)],
  });
  return rows.map(toRow);
}

export async function updateRequirement(
  db: AppDatabase,
  userId: string,
  projectId: string,
  requirementCode: string,
  raw: UpdateRequirementInput,
): Promise<RequirementRow> {
  if (userId.trim() === "") throw new RequirementValidationError("Owner is required.");
  const code = requirementCode.trim();
  if (code === "") throw new RequirementValidationError("requirementCode is required.");
  if (raw.title !== undefined) requireText(raw.title, "title", MAX_TITLE_LENGTH);
  if (raw.description !== undefined)
    requireText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  if (raw.priority !== undefined) requireEnum(raw.priority, REQUIREMENT_PRIORITIES, "priority");
  if (raw.type !== undefined) requireEnum(raw.type, REQUIREMENT_TYPES, "type");
  if (raw.status !== undefined) {
    requireEnum(raw.status, REQUIREMENT_STATUSES, "status");
    if (raw.status === "SUPERSEDED") {
      throw new RequirementValidationError("Use supersedeRequirement to create a successor.");
    }
  }
  const criteria =
    raw.acceptanceCriteria === undefined
      ? undefined
      : requireCriteria(raw.acceptanceCriteria, "acceptanceCriteria");
  const sources = raw.sources === undefined ? undefined : requireSources(raw.sources);
  const touches =
    raw.title !== undefined ||
    raw.description !== undefined ||
    raw.priority !== undefined ||
    raw.type !== undefined ||
    raw.status !== undefined ||
    criteria !== undefined ||
    sources !== undefined;

  const current = await loadScoped(db, userId, projectId, code);
  if (!touches) return current;
  if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
    throw new RequirementValidationError(
      `A ${current.status} requirement is frozen; supersede it instead.`,
    );
  }

  return db.transaction(async (tx) => {
    // sources rewrites metadata.sources only — server-managed supersede
    // links survive user edits.
    const nextMeta: RequirementMetadata = { ...(current.metadata ?? {}) };
    if (sources !== undefined) {
      if (sources && sources.length > 0) nextMeta.sources = sources;
      else delete nextMeta.sources;
    }
    const [updated] = await tx
      .update(requirements)
      .set({
        ...(raw.title !== undefined ? { title: raw.title.trim() } : {}),
        ...(raw.description !== undefined ? { description: raw.description.trim() } : {}),
        ...(raw.priority !== undefined ? { priority: raw.priority } : {}),
        ...(raw.type !== undefined ? { type: raw.type } : {}),
        ...(raw.status !== undefined ? { status: raw.status } : {}),
        ...(criteria !== undefined ? { acceptanceCriteria: criteria } : {}),
        ...(sources !== undefined
          ? { metadata: Object.keys(nextMeta).length > 0 ? nextMeta : null }
          : {}),
      })
      .where(eq(requirements.id, current.id))
      .returning();
    if (!updated) throw new RequirementNotFoundError();
    const row = toRow(updated);
    await incrementStateVersion(tx, userId, current.projectId);
    return row;
  });
}

// Blessed replacement path (TASK-023 acceptance): the old row freezes as
// SUPERSEDED pointing at its successor, the successor carries a FRESH code
// (never reused, §24) pointing back. One user action, one version bump.
export async function supersedeRequirement(
  db: AppDatabase,
  userId: string,
  projectId: string,
  requirementCode: string,
  raw: CreateRequirementInput,
  reason?: string | null,
): Promise<{ old: RequirementRow; next: RequirementRow }> {
  if (userId.trim() === "") throw new RequirementValidationError("Owner is required.");
  const code = requirementCode.trim();
  if (code === "") throw new RequirementValidationError("requirementCode is required.");
  const type = requireEnum(raw.type, REQUIREMENT_TYPES, "type");
  const title = requireText(raw.title, "title", MAX_TITLE_LENGTH);
  const description = requireText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const priority = requireEnum(raw.priority, REQUIREMENT_PRIORITIES, "priority");
  const status = requireEnum(raw.status, REQUIREMENT_STATUSES, "status");
  if (status === "SUPERSEDED" || status === "REMOVED") {
    throw new RequirementValidationError("A successor must start in a live status.");
  }
  const acceptanceCriteria = requireCriteria(raw.acceptanceCriteria, "acceptanceCriteria");
  const sources = requireSources(raw.sources);
  const changeReason =
    reason === undefined || reason === null || reason.trim() === "" ? null : reason.trim();

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const found = await tx.query.requirements.findFirst({
      where: and(
        eq(requirements.projectId, scope.projectId),
        eq(requirements.requirementCode, code),
      ),
    });
    if (!found) throw new RequirementNotFoundError();
    const current = toRow(found);
    if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
      throw new RequirementValidationError(
        `A ${current.status} requirement cannot be superseded again.`,
      );
    }

    const nextCode = await allocateStableIdTx(tx, scope.projectId, "FR");
    const [inserted] = await tx
      .insert(requirements)
      .values({
        projectId: scope.projectId,
        requirementCode: nextCode,
        type,
        title,
        description,
        priority,
        status,
        acceptanceCriteria,
        metadata: buildMetadata(sources, { supersedes: code }),
      })
      .returning();
    if (!inserted) throw new RequirementNotFoundError("Requirement creation failed.");
    const next = toRow(inserted);

    const oldMeta: RequirementMetadata = {
      ...(current.metadata ?? {}),
      supersededBy: nextCode,
      ...(changeReason ? { supersedeReason: changeReason } : {}),
    };
    const [frozen] = await tx
      .update(requirements)
      .set({ status: "SUPERSEDED", metadata: oldMeta })
      .where(eq(requirements.id, current.id))
      .returning();
    if (!frozen) throw new RequirementNotFoundError();

    await incrementStateVersion(tx, userId, scope.projectId);
    return { old: toRow(frozen), next };
  });
}
