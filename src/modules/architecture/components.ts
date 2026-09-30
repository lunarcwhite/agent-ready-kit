// Architecture component domain model (TASK-059, database-schema.md §45a).
//
// Stable implementation-relevant components, independent from generated
// architecture prose. Codes (ARC-001…) are atomic per-project sequences,
// never LLM output, never reused — including across supersede chains and
// removals.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted change (create/update/remove/
// supersede) numbers the project state version once (TASK-020).
//
// Supersede is the blessed replacement path: the old row freezes as
// SUPERSEDED with metadata.supersededBy, the successor carries
// metadata.supersedes. Direct writes to SUPERSEDED are rejected — a
// supersede without a successor is an orphan by definition. Likewise,
// REMOVED is written only by removeComponent: the row freezes as the audit
// trail and is never hard-deleted, so its code can never be reissued.
//
// Reads use select().from() rather than db.query: this table is new in
// TASK-059 and sibling schema registration happens separately, so the
// shared AppDatabase query map does not name it yet. Writes (insert/
// update) are table-generic and unaffected.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import { architectureComponents } from "../../infrastructure/database/schema/architecture";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { ArchitectureNotFoundError, ArchitectureValidationError } from "./errors";

export const COMPONENT_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "DEFERRED",
  "SUPERSEDED",
  "REMOVED",
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

const LIVE_STATUSES: readonly ComponentStatus[] = ["DRAFT", "CONFIRMED", "DEFERRED"];

export interface ComponentMetadata {
  supersedes?: string;
  supersededBy?: string;
  supersedeReason?: string;
}

export interface ComponentRow {
  id: string;
  projectId: string;
  componentCode: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
  metadata: ComponentMetadata | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateComponentInput {
  name: string;
  description?: string | null;
  status: ComponentStatus;
}

export interface UpdateComponentInput {
  name?: string;
  description?: string | null;
  status?: ComponentStatus;
}

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20000;

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ArchitectureValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireText(raw: string, field: string, max: number): string {
  const text = raw.trim();
  if (text === "") throw new ArchitectureValidationError(`${field} is required.`);
  if (text.length > max) {
    throw new ArchitectureValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireOptionalText(
  raw: string | null | undefined,
  field: string,
  max: number,
): string | null | undefined {
  if (raw === undefined || raw === null) return raw ?? null;
  const text = raw.trim();
  if (text.length > max) {
    throw new ArchitectureValidationError(`${field} must be at most ${max} characters.`);
  }
  return text === "" ? null : text;
}

function parseMetadata(raw: unknown): ComponentMetadata | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  const out: ComponentMetadata = {};
  if (typeof meta.supersedes === "string") out.supersedes = meta.supersedes;
  if (typeof meta.supersededBy === "string") out.supersededBy = meta.supersededBy;
  if (typeof meta.supersedeReason === "string") out.supersedeReason = meta.supersedeReason;
  return Object.keys(out).length > 0 ? out : null;
}

function buildMetadata(
  extra?: Pick<ComponentMetadata, "supersedes" | "supersededBy">,
): ComponentMetadata | null {
  const meta: ComponentMetadata = {};
  if (extra?.supersedes) meta.supersedes = extra.supersedes;
  if (extra?.supersededBy) meta.supersededBy = extra.supersededBy;
  return Object.keys(meta).length > 0 ? meta : null;
}

function toRow(raw: typeof architectureComponents.$inferSelect): ComponentRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    componentCode: raw.componentCode,
    name: raw.name,
    description: raw.description,
    status: raw.status as ComponentStatus,
    metadata: parseMetadata(raw.metadata),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function requireLiveStatusForWrite(status: ComponentStatus, field: string): void {
  if (status === "SUPERSEDED") {
    throw new ArchitectureValidationError("Use supersedeComponent to create a successor.");
  }
  if (status === "REMOVED") {
    throw new ArchitectureValidationError("Use removeComponent to withdraw a component.");
  }
  requireEnum(status, LIVE_STATUSES, field);
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  componentCode: string,
): Promise<ComponentRow> {
  const scope = await requireProjectScope(db, userId, projectId);
  const [found] = await db
    .select()
    .from(architectureComponents)
    .where(
      and(
        eq(architectureComponents.projectId, scope.projectId),
        eq(architectureComponents.componentCode, componentCode),
      ),
    )
    .limit(1);
  if (!found) throw new ArchitectureNotFoundError("Architecture component not found.");
  return toRow(found);
}

export async function createComponent(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateComponentInput,
): Promise<ComponentRow> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const name = requireText(raw.name, "name", MAX_NAME_LENGTH);
  const description = requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const status = requireEnum(raw.status, COMPONENT_STATUSES, "status");
  requireLiveStatusForWrite(status, "status");

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const componentCode = await allocateStableIdTx(tx, scope.projectId, "ARC");
    let inserted: typeof architectureComponents.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(architectureComponents)
        .values({
          projectId: scope.projectId,
          componentCode,
          name,
          description: description ?? null,
          status,
          metadata: buildMetadata(),
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        // Counter race backstop — the allocator owns uniqueness; a clash
        // here means concurrent writers, safe to surface plainly.
        throw new ArchitectureValidationError("Component code clash, retry the operation.");
      }
      throw error;
    }
    if (!inserted) throw new ArchitectureNotFoundError("Component creation failed.");
    const row = toRow(inserted);
    await incrementStateVersion(tx, userId, scope.projectId);
    return row;
  });
}

export async function getComponentByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  componentCode: string,
): Promise<ComponentRow> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const code = componentCode.trim();
  if (code === "") throw new ArchitectureValidationError("componentCode is required.");
  return loadScoped(db, userId, projectId, code);
}

export async function listComponents(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: { status?: ComponentStatus },
): Promise<ComponentRow[]> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  if (filter?.status !== undefined) requireEnum(filter.status, COMPONENT_STATUSES, "status");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db
    .select()
    .from(architectureComponents)
    .where(
      filter?.status === undefined
        ? eq(architectureComponents.projectId, scope.projectId)
        : and(
            eq(architectureComponents.projectId, scope.projectId),
            eq(architectureComponents.status, filter.status),
          ),
    )
    .orderBy(asc(architectureComponents.componentCode));
  return rows.map(toRow);
}

export async function updateComponent(
  db: AppDatabase,
  userId: string,
  projectId: string,
  componentCode: string,
  raw: UpdateComponentInput,
): Promise<ComponentRow> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const code = componentCode.trim();
  if (code === "") throw new ArchitectureValidationError("componentCode is required.");
  if (raw.name !== undefined) requireText(raw.name, "name", MAX_NAME_LENGTH);
  const description =
    raw.description === undefined
      ? undefined
      : requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  if (raw.status !== undefined) requireLiveStatusForWrite(raw.status, "status");
  const touches = raw.name !== undefined || description !== undefined || raw.status !== undefined;

  const current = await loadScoped(db, userId, projectId, code);
  if (!touches) return current;
  if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
    throw new ArchitectureValidationError(
      `A ${current.status} component is frozen; supersede it instead.`,
    );
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(architectureComponents)
      .set({
        ...(raw.name !== undefined ? { name: raw.name.trim() } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(raw.status !== undefined ? { status: raw.status } : {}),
      })
      .where(eq(architectureComponents.id, current.id))
      .returning();
    if (!updated) throw new ArchitectureNotFoundError();
    const row = toRow(updated);
    await incrementStateVersion(tx, userId, current.projectId);
    return row;
  });
}

// Withdrawal without deletion (TASK-059 acceptance: codes are never reused
// after removal). The row freezes as REMOVED and rejects further edits.
export async function removeComponent(
  db: AppDatabase,
  userId: string,
  projectId: string,
  componentCode: string,
): Promise<ComponentRow> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const code = componentCode.trim();
  if (code === "") throw new ArchitectureValidationError("componentCode is required.");

  const current = await loadScoped(db, userId, projectId, code);
  if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
    throw new ArchitectureValidationError(
      `A ${current.status} component is frozen and cannot be removed again.`,
    );
  }

  return db.transaction(async (tx) => {
    const [removed] = await tx
      .update(architectureComponents)
      .set({ status: "REMOVED" })
      .where(eq(architectureComponents.id, current.id))
      .returning();
    if (!removed) throw new ArchitectureNotFoundError();
    const row = toRow(removed);
    await incrementStateVersion(tx, userId, current.projectId);
    return row;
  });
}

// Blessed replacement path (TASK-059 acceptance): the old row freezes as
// SUPERSEDED pointing at its successor, the successor carries a FRESH code
// (never reused, §68) pointing back. One user action, one version bump.
export async function supersedeComponent(
  db: AppDatabase,
  userId: string,
  projectId: string,
  componentCode: string,
  raw: CreateComponentInput,
  reason?: string | null,
): Promise<{ old: ComponentRow; next: ComponentRow }> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const code = componentCode.trim();
  if (code === "") throw new ArchitectureValidationError("componentCode is required.");
  const name = requireText(raw.name, "name", MAX_NAME_LENGTH);
  const description = requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const status = requireEnum(raw.status, COMPONENT_STATUSES, "status");
  if (status === "SUPERSEDED" || status === "REMOVED") {
    throw new ArchitectureValidationError("A successor must start in a live status.");
  }
  const changeReason =
    reason === undefined || reason === null || reason.trim() === "" ? null : reason.trim();

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const [found] = await tx
      .select()
      .from(architectureComponents)
      .where(
        and(
          eq(architectureComponents.projectId, scope.projectId),
          eq(architectureComponents.componentCode, code),
        ),
      )
      .limit(1);
    if (!found) throw new ArchitectureNotFoundError("Architecture component not found.");
    const current = toRow(found);
    if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
      throw new ArchitectureValidationError(
        `A ${current.status} component cannot be superseded again.`,
      );
    }

    const nextCode = await allocateStableIdTx(tx, scope.projectId, "ARC");
    const [inserted] = await tx
      .insert(architectureComponents)
      .values({
        projectId: scope.projectId,
        componentCode: nextCode,
        name,
        description: description ?? null,
        status,
        metadata: buildMetadata({ supersedes: code }),
      })
      .returning();
    if (!inserted) throw new ArchitectureNotFoundError("Component creation failed.");
    const next = toRow(inserted);

    const oldMeta: ComponentMetadata = {
      ...(current.metadata ?? {}),
      supersededBy: nextCode,
      ...(changeReason ? { supersedeReason: changeReason } : {}),
    };
    const [frozen] = await tx
      .update(architectureComponents)
      .set({ status: "SUPERSEDED", metadata: oldMeta })
      .where(eq(architectureComponents.id, current.id))
      .returning();
    if (!frozen) throw new ArchitectureNotFoundError();

    await incrementStateVersion(tx, userId, scope.projectId);
    return { old: toRow(frozen), next };
  });
}
