// Screen domain model (TASK-059, database-schema.md §45).
//
// Major UI screens modeled independently for traceability (FR → SCREEN via
// traceability_links, TASK-063 consumes this catalog). Codes (SCREEN-001…)
// are atomic per-project sequences, never LLM output, never reused —
// including across supersede chains and removals.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted change (create/update/remove/
// supersede) numbers the project state version once (TASK-020).
//
// Supersede is the blessed replacement path: the old row freezes as
// SUPERSEDED with metadata.supersededBy, the successor carries
// metadata.supersedes. Direct writes to SUPERSEDED are rejected — a
// supersede without a successor is an orphan by definition. Likewise,
// REMOVED is written only by removeScreen: the row freezes as the audit
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
import { screens } from "../../infrastructure/database/schema/architecture";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { ArchitectureNotFoundError, ArchitectureValidationError } from "./errors";

export const SCREEN_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED", "SUPERSEDED", "REMOVED"] as const;
export type ScreenStatus = (typeof SCREEN_STATUSES)[number];

const LIVE_STATUSES: readonly ScreenStatus[] = ["DRAFT", "CONFIRMED", "DEFERRED"];

export interface ScreenMetadata {
  supersedes?: string;
  supersededBy?: string;
  supersedeReason?: string;
}

export interface ScreenRow {
  id: string;
  projectId: string;
  screenCode: string;
  name: string;
  description: string | null;
  routeHint: string | null;
  status: ScreenStatus;
  metadata: ScreenMetadata | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScreenInput {
  name: string;
  description?: string | null;
  routeHint?: string | null;
  status: ScreenStatus;
}

export interface UpdateScreenInput {
  name?: string;
  description?: string | null;
  routeHint?: string | null;
  status?: ScreenStatus;
}

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20000;
const MAX_ROUTE_HINT_LENGTH = 255;

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

function parseMetadata(raw: unknown): ScreenMetadata | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  const out: ScreenMetadata = {};
  if (typeof meta.supersedes === "string") out.supersedes = meta.supersedes;
  if (typeof meta.supersededBy === "string") out.supersededBy = meta.supersededBy;
  if (typeof meta.supersedeReason === "string") out.supersedeReason = meta.supersedeReason;
  return Object.keys(out).length > 0 ? out : null;
}

function buildMetadata(
  extra?: Pick<ScreenMetadata, "supersedes" | "supersededBy">,
): ScreenMetadata | null {
  const meta: ScreenMetadata = {};
  if (extra?.supersedes) meta.supersedes = extra.supersedes;
  if (extra?.supersededBy) meta.supersededBy = extra.supersededBy;
  return Object.keys(meta).length > 0 ? meta : null;
}

function toRow(raw: typeof screens.$inferSelect): ScreenRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    screenCode: raw.screenCode,
    name: raw.name,
    description: raw.description,
    routeHint: raw.routeHint,
    status: raw.status as ScreenStatus,
    metadata: parseMetadata(raw.metadata),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function requireLiveStatusForWrite(status: ScreenStatus, field: string): void {
  if (status === "SUPERSEDED") {
    throw new ArchitectureValidationError("Use supersedeScreen to create a successor.");
  }
  if (status === "REMOVED") {
    throw new ArchitectureValidationError("Use removeScreen to withdraw a screen.");
  }
  requireEnum(status, LIVE_STATUSES, field);
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  screenCode: string,
): Promise<ScreenRow> {
  const scope = await requireProjectScope(db, userId, projectId);
  const [found] = await db
    .select()
    .from(screens)
    .where(and(eq(screens.projectId, scope.projectId), eq(screens.screenCode, screenCode)))
    .limit(1);
  if (!found) throw new ArchitectureNotFoundError("Screen not found.");
  return toRow(found);
}

export async function createScreen(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateScreenInput,
): Promise<ScreenRow> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const name = requireText(raw.name, "name", MAX_NAME_LENGTH);
  const description = requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const routeHint = requireOptionalText(raw.routeHint, "routeHint", MAX_ROUTE_HINT_LENGTH);
  const status = requireEnum(raw.status, SCREEN_STATUSES, "status");
  requireLiveStatusForWrite(status, "status");

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const screenCode = await allocateStableIdTx(tx, scope.projectId, "SCREEN");
    let inserted: typeof screens.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(screens)
        .values({
          projectId: scope.projectId,
          screenCode,
          name,
          description: description ?? null,
          routeHint: routeHint ?? null,
          status,
          metadata: buildMetadata(),
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        // Counter race backstop — the allocator owns uniqueness; a clash
        // here means concurrent writers, safe to surface plainly.
        throw new ArchitectureValidationError("Screen code clash, retry the operation.");
      }
      throw error;
    }
    if (!inserted) throw new ArchitectureNotFoundError("Screen creation failed.");
    const row = toRow(inserted);
    await incrementStateVersion(tx, userId, scope.projectId);
    return row;
  });
}

export async function getScreenByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  screenCode: string,
): Promise<ScreenRow> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const code = screenCode.trim();
  if (code === "") throw new ArchitectureValidationError("screenCode is required.");
  return loadScoped(db, userId, projectId, code);
}

export async function listScreens(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: { status?: ScreenStatus },
): Promise<ScreenRow[]> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  if (filter?.status !== undefined) requireEnum(filter.status, SCREEN_STATUSES, "status");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db
    .select()
    .from(screens)
    .where(
      filter?.status === undefined
        ? eq(screens.projectId, scope.projectId)
        : and(eq(screens.projectId, scope.projectId), eq(screens.status, filter.status)),
    )
    .orderBy(asc(screens.screenCode));
  return rows.map(toRow);
}

export async function updateScreen(
  db: AppDatabase,
  userId: string,
  projectId: string,
  screenCode: string,
  raw: UpdateScreenInput,
): Promise<ScreenRow> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const code = screenCode.trim();
  if (code === "") throw new ArchitectureValidationError("screenCode is required.");
  if (raw.name !== undefined) requireText(raw.name, "name", MAX_NAME_LENGTH);
  const description =
    raw.description === undefined
      ? undefined
      : requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const routeHint =
    raw.routeHint === undefined
      ? undefined
      : requireOptionalText(raw.routeHint, "routeHint", MAX_ROUTE_HINT_LENGTH);
  if (raw.status !== undefined) requireLiveStatusForWrite(raw.status, "status");
  const touches =
    raw.name !== undefined ||
    description !== undefined ||
    routeHint !== undefined ||
    raw.status !== undefined;

  const current = await loadScoped(db, userId, projectId, code);
  if (!touches) return current;
  if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
    throw new ArchitectureValidationError(
      `A ${current.status} screen is frozen; supersede it instead.`,
    );
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(screens)
      .set({
        ...(raw.name !== undefined ? { name: raw.name.trim() } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(routeHint !== undefined ? { routeHint } : {}),
        ...(raw.status !== undefined ? { status: raw.status } : {}),
      })
      .where(eq(screens.id, current.id))
      .returning();
    if (!updated) throw new ArchitectureNotFoundError();
    const row = toRow(updated);
    await incrementStateVersion(tx, userId, current.projectId);
    return row;
  });
}

// Withdrawal without deletion (TASK-059 acceptance: codes are never reused
// after removal). The row freezes as REMOVED and rejects further edits.
export async function removeScreen(
  db: AppDatabase,
  userId: string,
  projectId: string,
  screenCode: string,
): Promise<ScreenRow> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const code = screenCode.trim();
  if (code === "") throw new ArchitectureValidationError("screenCode is required.");

  const current = await loadScoped(db, userId, projectId, code);
  if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
    throw new ArchitectureValidationError(
      `A ${current.status} screen is frozen and cannot be removed again.`,
    );
  }

  return db.transaction(async (tx) => {
    const [removed] = await tx
      .update(screens)
      .set({ status: "REMOVED" })
      .where(eq(screens.id, current.id))
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
export async function supersedeScreen(
  db: AppDatabase,
  userId: string,
  projectId: string,
  screenCode: string,
  raw: CreateScreenInput,
  reason?: string | null,
): Promise<{ old: ScreenRow; next: ScreenRow }> {
  if (userId.trim() === "") throw new ArchitectureValidationError("Owner is required.");
  const code = screenCode.trim();
  if (code === "") throw new ArchitectureValidationError("screenCode is required.");
  const name = requireText(raw.name, "name", MAX_NAME_LENGTH);
  const description = requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const routeHint = requireOptionalText(raw.routeHint, "routeHint", MAX_ROUTE_HINT_LENGTH);
  const status = requireEnum(raw.status, SCREEN_STATUSES, "status");
  if (status === "SUPERSEDED" || status === "REMOVED") {
    throw new ArchitectureValidationError("A successor must start in a live status.");
  }
  const changeReason =
    reason === undefined || reason === null || reason.trim() === "" ? null : reason.trim();

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const [found] = await tx
      .select()
      .from(screens)
      .where(and(eq(screens.projectId, scope.projectId), eq(screens.screenCode, code)))
      .limit(1);
    if (!found) throw new ArchitectureNotFoundError("Screen not found.");
    const current = toRow(found);
    if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
      throw new ArchitectureValidationError(
        `A ${current.status} screen cannot be superseded again.`,
      );
    }

    const nextCode = await allocateStableIdTx(tx, scope.projectId, "SCREEN");
    const [inserted] = await tx
      .insert(screens)
      .values({
        projectId: scope.projectId,
        screenCode: nextCode,
        name,
        description: description ?? null,
        routeHint: routeHint ?? null,
        status,
        metadata: buildMetadata({ supersedes: code }),
      })
      .returning();
    if (!inserted) throw new ArchitectureNotFoundError("Screen creation failed.");
    const next = toRow(inserted);

    const oldMeta: ScreenMetadata = {
      ...(current.metadata ?? {}),
      supersededBy: nextCode,
      ...(changeReason ? { supersedeReason: changeReason } : {}),
    };
    const [frozen] = await tx
      .update(screens)
      .set({ status: "SUPERSEDED", metadata: oldMeta })
      .where(eq(screens.id, current.id))
      .returning();
    if (!frozen) throw new ArchitectureNotFoundError();

    await incrementStateVersion(tx, userId, scope.projectId);
    return { old: toRow(frozen), next };
  });
}
