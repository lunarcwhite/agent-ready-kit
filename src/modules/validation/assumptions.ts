// Assumption domain model (TASK-074, database-schema.md §36–§38).
//
// First-class implementation-relevant beliefs, tracked separately from
// confirmed knowledge (AGENTS.md §36). Each row carries a stable ASM-*
// code from the atomic per-project counter (TASK-004, family "ASM" →
// ASM-001), never LLM output, never reused.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted mutation numbers the project
// state version once (TASK-020) inside the same transaction as the data
// change, so a rollback never leaves a version pointing at missing state.
//
// Lifecycle (§37, AGENTS.md §36 Confirm/Replace/Defer/Reject):
//   OPEN → CONFIRMED | REJECTED | DEFERRED  (resolveAssumption, reason kept)
//   DEFERRED ↔ OPEN                          (reopenAssumption)
//   OPEN|DEFERRED → REPLACED                 (replaceAssumption, atomic with
//                                            successor creation)
//   CONFIRMED|REJECTED → OPEN                (reopenAssumption)
//   REPLACED is terminal: act on the successor, linked through
//   assumption_impacts with target_type ASSUMPTION.
// Terminal and deferred rows are frozen like RESOLVED issues (TASK-070):
// content edits are rejected until reopen. resolved_at/resolution are
// server-owned — stamped on resolve, cleared on reopen.
//
// Polymorphic impacts (§38, §67): (target_type, target_id) cannot use FKs,
// so the domain validates DECISION / REQUIREMENT / KNOWLEDGE_ITEM /
// ASSUMPTION ids same-project (missing and foreign rows surface
// identically as validation errors, never revealing whether another
// user's row exists). TASK refs accept any UUID structurally: strict
// user-task linkage resolves in a follow-up once the user-task model
// lands (same posture as issue_references).
//
// Canonical-state rule: resolving an assumption updates the assumption
// lifecycle (status + resolution + version bump) — never silently rewrites
// decisions, knowledge, or requirements. Turning a CONFIRMED assumption
// into knowledge/decisions is an explicit later write through those
// modules (curator/TASK-054), not a side effect here.
//
// Query style note: like issues.ts this module uses the query-builder
// (select/insert/update) so it compiles against the shared AppDatabase
// type while the tables land in the schema registry.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import { decisions } from "../../infrastructure/database/schema/decisions";
import { knowledgeItems } from "../../infrastructure/database/schema/knowledge";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { assumptionImpacts, assumptions } from "../../infrastructure/database/schema/assumptions";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { AssumptionNotFoundError, AssumptionValidationError } from "./errors";

export const ASSUMPTION_STATUSES = [
  "OPEN",
  "CONFIRMED",
  "REPLACED",
  "DEFERRED",
  "REJECTED",
] as const;
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number];

export const ASSUMPTION_IMPACTS = ["HIGH", "MEDIUM", "LOW"] as const;
export type AssumptionImpact = (typeof ASSUMPTION_IMPACTS)[number];

export const ASSUMPTION_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type AssumptionConfidence = (typeof ASSUMPTION_CONFIDENCES)[number];

export const ASSUMPTION_SOURCES = [
  "USER_IMPLIED",
  "AI_ASSUMED",
  "AI_RECOMMENDED",
  "SYSTEM_DERIVED",
] as const;
export type AssumptionSource = (typeof ASSUMPTION_SOURCES)[number];

// Row-backed link targets are validated same-project; TASK is
// structural-only until the user-task model lands. ASSUMPTION targets
// chain replacements (old → successor).
export const ASSUMPTION_TARGET_TYPES = [
  "DECISION",
  "REQUIREMENT",
  "KNOWLEDGE_ITEM",
  "TASK",
  "ASSUMPTION",
] as const;
export type AssumptionTargetType = (typeof ASSUMPTION_TARGET_TYPES)[number];

export const ASSUMPTION_RESOLUTIONS = ["CONFIRMED", "REJECTED", "DEFERRED"] as const;
export type AssumptionResolution = (typeof ASSUMPTION_RESOLUTIONS)[number];

export interface AssumptionImpactInput {
  targetType: AssumptionTargetType;
  targetId: string;
}

export interface AssumptionImpactRow {
  id: string;
  assumptionId: string;
  targetType: AssumptionTargetType;
  targetId: string;
  createdAt: Date;
}

export interface AssumptionRow {
  id: string;
  projectId: string;
  assumptionCode: string;
  title: string;
  description: string;
  impact: AssumptionImpact;
  confidence: AssumptionConfidence;
  source: AssumptionSource;
  status: AssumptionStatus;
  resolution: string | null;
  resolvedAt: Date | null;
  impacts: AssumptionImpactRow[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAssumptionInput {
  title: string;
  description: string;
  impact: AssumptionImpact;
  confidence: AssumptionConfidence;
  source: AssumptionSource;
  impacts?: AssumptionImpactInput[];
}

export interface UpdateAssumptionInput {
  title?: string;
  description?: string;
  impact?: AssumptionImpact;
  confidence?: AssumptionConfidence;
}

export interface ListAssumptionsFilter {
  status?: AssumptionStatus;
  impact?: AssumptionImpact;
  source?: AssumptionSource;
}

const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20000;
const MAX_RESOLUTION_LENGTH = 2000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new AssumptionValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireText(raw: string, field: string, max: number): string {
  const text = raw.trim();
  if (text === "") throw new AssumptionValidationError(`${field} is required.`);
  if (text.length > max) {
    throw new AssumptionValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireOwner(userId: string): void {
  if (userId.trim() === "") throw new AssumptionValidationError("Owner is required.");
}

function requireTargetId(raw: string, field: string): string {
  const id = raw.trim();
  if (!UUID_PATTERN.test(id)) {
    throw new AssumptionValidationError(`${field} must be a UUID.`);
  }
  return id;
}

// Structural validation only — existence/scope checks run inside the
// caller's transaction via assertTargetInScope. Exact duplicates collapse
// here so one call never doubles a link.
function requireImpacts(raw: AssumptionImpactInput[] | undefined): AssumptionImpactInput[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new AssumptionValidationError("impacts must be an array when provided.");
  }
  const seen = new Set<string>();
  const out: AssumptionImpactInput[] = [];
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new AssumptionValidationError(`impacts[${i}] must be { targetType, targetId }.`);
    }
    const candidate = item as { targetType?: unknown; targetId?: unknown };
    const targetType = requireEnum(
      String(candidate.targetType ?? ""),
      ASSUMPTION_TARGET_TYPES,
      `impacts[${i}].targetType`,
    );
    const targetId = requireTargetId(String(candidate.targetId ?? ""), `impacts[${i}].targetId`);
    const sig = `${targetType}::${targetId}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ targetType, targetId });
  });
  return out;
}

// Strict same-project check for row-backed target types. Missing rows and
// foreign rows surface identically as validation errors — the domain never
// reveals whether another user's row exists (TASK-014). TASK refs are
// structural-only: strict user-task linkage resolves in a follow-up once
// the user-task model lands.
async function assertTargetInScope(
  db: AppDatabase,
  projectId: string,
  targetType: AssumptionTargetType,
  targetId: string,
): Promise<void> {
  if (targetType === "TASK") return;
  const tables = {
    DECISION: decisions,
    REQUIREMENT: requirements,
    KNOWLEDGE_ITEM: knowledgeItems,
    ASSUMPTION: assumptions,
  } as const;
  const table = tables[targetType];
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.projectId, projectId), eq(table.id, targetId)))
    .limit(1);
  if (rows.length === 0) {
    throw new AssumptionValidationError(
      `Referenced ${targetType.toLowerCase().replace("_", " ")} not found in this project.`,
    );
  }
}

function toImpactRow(raw: typeof assumptionImpacts.$inferSelect): AssumptionImpactRow {
  return { ...raw, targetType: raw.targetType as AssumptionTargetType };
}

async function loadImpacts(db: AppDatabase, assumptionId: string): Promise<AssumptionImpactRow[]> {
  const rows = await db
    .select()
    .from(assumptionImpacts)
    .where(eq(assumptionImpacts.assumptionId, assumptionId))
    .orderBy(asc(assumptionImpacts.createdAt));
  return rows.map(toImpactRow);
}

function toAssumptionRow(
  raw: typeof assumptions.$inferSelect,
  impacts: AssumptionImpactRow[],
): AssumptionRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    assumptionCode: raw.assumptionCode,
    title: raw.title,
    description: raw.description,
    impact: raw.impact as AssumptionImpact,
    confidence: raw.confidence as AssumptionConfidence,
    source: raw.source as AssumptionSource,
    status: raw.status as AssumptionStatus,
    resolution: raw.resolution,
    resolvedAt: raw.resolvedAt,
    impacts: [...impacts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  assumptionCode: string,
): Promise<typeof assumptions.$inferSelect> {
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db
    .select()
    .from(assumptions)
    .where(
      and(
        eq(assumptions.projectId, scope.projectId),
        eq(assumptions.assumptionCode, assumptionCode),
      ),
    )
    .limit(1);
  const found = rows[0];
  if (!found) throw new AssumptionNotFoundError();
  return found;
}

async function withImpacts(
  db: AppDatabase,
  assumption: typeof assumptions.$inferSelect,
): Promise<AssumptionRow> {
  return toAssumptionRow(assumption, await loadImpacts(db, assumption.id));
}

async function insertImpacts(
  db: AppDatabase,
  projectId: string,
  assumptionId: string,
  impacts: AssumptionImpactInput[],
): Promise<void> {
  for (const impact of impacts) {
    await assertTargetInScope(db, projectId, impact.targetType, impact.targetId);
    await db.insert(assumptionImpacts).values({
      assumptionId,
      targetType: impact.targetType,
      targetId: impact.targetId,
    });
  }
}

export async function createAssumption(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateAssumptionInput,
): Promise<AssumptionRow> {
  // All structural validation runs before any write: malformed calls must
  // not create rows or advance the project version.
  requireOwner(userId);
  const title = requireText(raw.title, "title", MAX_TITLE_LENGTH);
  const description = requireText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const impact = requireEnum(raw.impact, ASSUMPTION_IMPACTS, "impact");
  const confidence = requireEnum(raw.confidence, ASSUMPTION_CONFIDENCES, "confidence");
  const source = requireEnum(raw.source, ASSUMPTION_SOURCES, "source");
  const impacts = requireImpacts(raw.impacts);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const assumptionCode = await allocateStableIdTx(tx, scope.projectId, "ASM");
    let inserted: typeof assumptions.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(assumptions)
        .values({
          projectId: scope.projectId,
          assumptionCode,
          title,
          description,
          impact,
          confidence,
          source,
          status: "OPEN",
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        // Counter race backstop — the allocator owns uniqueness; a clash
        // here means concurrent writers, safe to surface plainly.
        throw new AssumptionValidationError("Assumption code clash, retry the operation.");
      }
      throw error;
    }
    if (!inserted) throw new AssumptionNotFoundError("Assumption creation failed.");
    await insertImpacts(tx, scope.projectId, inserted.id, impacts);
    await incrementStateVersion(tx, userId, scope.projectId);
    return withImpacts(tx, inserted);
  });
}

export async function getAssumptionByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  assumptionCode: string,
): Promise<AssumptionRow> {
  requireOwner(userId);
  const code = assumptionCode.trim();
  if (code === "") throw new AssumptionValidationError("assumptionCode is required.");
  return withImpacts(db, await loadScoped(db, userId, projectId, code));
}

export async function listAssumptions(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: ListAssumptionsFilter,
): Promise<AssumptionRow[]> {
  requireOwner(userId);
  if (filter?.status !== undefined) requireEnum(filter.status, ASSUMPTION_STATUSES, "status");
  if (filter?.impact !== undefined) requireEnum(filter.impact, ASSUMPTION_IMPACTS, "impact");
  if (filter?.source !== undefined) requireEnum(filter.source, ASSUMPTION_SOURCES, "source");
  const scope = await requireProjectScope(db, userId, projectId);
  const conditions = [eq(assumptions.projectId, scope.projectId)];
  if (filter?.status !== undefined) conditions.push(eq(assumptions.status, filter.status));
  if (filter?.impact !== undefined) conditions.push(eq(assumptions.impact, filter.impact));
  if (filter?.source !== undefined) conditions.push(eq(assumptions.source, filter.source));
  const rows = await db
    .select()
    .from(assumptions)
    .where(and(...conditions))
    .orderBy(asc(assumptions.assumptionCode));
  const out: AssumptionRow[] = [];
  for (const row of rows) {
    out.push(await withImpacts(db, row));
  }
  return out;
}

// Content edits only. Status moves go through the deliberate paths below
// (resolve/reopen/replace) so every lifecycle change carries its reason.
// Terminal and deferred rows are frozen until reopened.
export async function updateAssumption(
  db: AppDatabase,
  userId: string,
  projectId: string,
  assumptionCode: string,
  raw: UpdateAssumptionInput,
): Promise<AssumptionRow> {
  requireOwner(userId);
  const code = assumptionCode.trim();
  if (code === "") throw new AssumptionValidationError("assumptionCode is required.");
  if (raw.title !== undefined) requireText(raw.title, "title", MAX_TITLE_LENGTH);
  if (raw.description !== undefined)
    requireText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  if (raw.impact !== undefined) requireEnum(raw.impact, ASSUMPTION_IMPACTS, "impact");
  if (raw.confidence !== undefined)
    requireEnum(raw.confidence, ASSUMPTION_CONFIDENCES, "confidence");
  const touches =
    raw.title !== undefined ||
    raw.description !== undefined ||
    raw.impact !== undefined ||
    raw.confidence !== undefined;

  const current = await loadScoped(db, userId, projectId, code);
  if (!touches) return withImpacts(db, current);
  const currentStatus = current.status as AssumptionStatus;
  if (currentStatus !== "OPEN" && currentStatus !== "DEFERRED") {
    throw new AssumptionValidationError(
      `A ${currentStatus} assumption is frozen; reopen it to change it.`,
    );
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(assumptions)
      .set({
        ...(raw.title !== undefined ? { title: raw.title.trim() } : {}),
        ...(raw.description !== undefined ? { description: raw.description.trim() } : {}),
        ...(raw.impact !== undefined ? { impact: raw.impact } : {}),
        ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
      })
      .where(eq(assumptions.id, current.id))
      .returning();
    if (!updated) throw new AssumptionNotFoundError();
    await incrementStateVersion(tx, userId, current.projectId);
    return withImpacts(tx, updated);
  });
}

// Blessed terminal path (AGENTS.md §36: Confirm / Reject / Defer).
// Resolution reason is stored; resolved_at is server-stamped. Only OPEN
// and DEFERRED rows resolve directly — anything else must reopen first.
export async function resolveAssumption(
  db: AppDatabase,
  userId: string,
  projectId: string,
  assumptionCode: string,
  outcome: AssumptionResolution,
  resolution: string,
): Promise<AssumptionRow> {
  requireOwner(userId);
  const code = assumptionCode.trim();
  if (code === "") throw new AssumptionValidationError("assumptionCode is required.");
  requireEnum(outcome, ASSUMPTION_RESOLUTIONS, "outcome");
  const resolutionText = requireText(resolution, "resolution", MAX_RESOLUTION_LENGTH);

  const current = await loadScoped(db, userId, projectId, code);
  const currentStatus = current.status as AssumptionStatus;
  if (currentStatus !== "OPEN" && currentStatus !== "DEFERRED") {
    throw new AssumptionValidationError(
      `A ${currentStatus} assumption must reopen before it can resolve.`,
    );
  }

  return db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(assumptions)
      .set({ status: outcome, resolution: resolutionText, resolvedAt: now })
      .where(eq(assumptions.id, current.id))
      .returning();
    if (!updated) throw new AssumptionNotFoundError();
    await incrementStateVersion(tx, userId, current.projectId);
    return withImpacts(tx, updated);
  });
}

// Reopen path: CONFIRMED / REJECTED / DEFERRED → OPEN. Server-owned
// resolution metadata is cleared — the row returns to undecided, it does
// not keep its old verdict. REPLACED rows never reopen: the successor
// owns the question now.
export async function reopenAssumption(
  db: AppDatabase,
  userId: string,
  projectId: string,
  assumptionCode: string,
): Promise<AssumptionRow> {
  requireOwner(userId);
  const code = assumptionCode.trim();
  if (code === "") throw new AssumptionValidationError("assumptionCode is required.");

  const current = await loadScoped(db, userId, projectId, code);
  const currentStatus = current.status as AssumptionStatus;
  if (currentStatus === "OPEN") return withImpacts(db, current);
  if (currentStatus === "REPLACED") {
    throw new AssumptionValidationError("A REPLACED assumption cannot reopen; use its successor.");
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(assumptions)
      .set({ status: "OPEN", resolution: null, resolvedAt: null })
      .where(eq(assumptions.id, current.id))
      .returning();
    if (!updated) throw new AssumptionNotFoundError();
    await incrementStateVersion(tx, userId, current.projectId);
    return withImpacts(tx, updated);
  });
}

// Replace path (AGENTS.md §36: Replace): one transaction creates the OPEN
// successor and freezes the current row as REPLACED, linked through
// assumption_impacts (target_type ASSUMPTION → successor id) so the chain
// stays queryable. Only OPEN/DEFERRED rows can be replaced.
export async function replaceAssumption(
  db: AppDatabase,
  userId: string,
  projectId: string,
  assumptionCode: string,
  successor: CreateAssumptionInput,
  reason: string,
): Promise<{ replaced: AssumptionRow; successor: AssumptionRow }> {
  requireOwner(userId);
  const code = assumptionCode.trim();
  if (code === "") throw new AssumptionValidationError("assumptionCode is required.");
  const reasonText = requireText(reason, "reason", MAX_RESOLUTION_LENGTH);
  const title = requireText(successor.title, "successor.title", MAX_TITLE_LENGTH);
  const description = requireText(
    successor.description,
    "successor.description",
    MAX_DESCRIPTION_LENGTH,
  );
  const impact = requireEnum(successor.impact, ASSUMPTION_IMPACTS, "successor.impact");
  const confidence = requireEnum(
    successor.confidence,
    ASSUMPTION_CONFIDENCES,
    "successor.confidence",
  );
  const source = requireEnum(successor.source, ASSUMPTION_SOURCES, "successor.source");
  const impacts = requireImpacts(successor.impacts);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const [current] = await tx
      .select()
      .from(assumptions)
      .where(and(eq(assumptions.projectId, scope.projectId), eq(assumptions.assumptionCode, code)))
      .limit(1);
    if (!current) throw new AssumptionNotFoundError();
    const currentStatus = current.status as AssumptionStatus;
    if (currentStatus !== "OPEN" && currentStatus !== "DEFERRED") {
      throw new AssumptionValidationError(`A ${currentStatus} assumption cannot be replaced.`);
    }

    const successorCode = await allocateStableIdTx(tx, scope.projectId, "ASM");
    const [inserted] = await tx
      .insert(assumptions)
      .values({
        projectId: scope.projectId,
        assumptionCode: successorCode,
        title,
        description,
        impact,
        confidence,
        source,
        status: "OPEN",
      })
      .returning();
    if (!inserted) throw new AssumptionNotFoundError("Successor creation failed.");
    await insertImpacts(tx, scope.projectId, inserted.id, impacts);

    const now = new Date();
    const [replaced] = await tx
      .update(assumptions)
      .set({ status: "REPLACED", resolution: reasonText, resolvedAt: now })
      .where(eq(assumptions.id, current.id))
      .returning();
    if (!replaced) throw new AssumptionNotFoundError();
    await tx.insert(assumptionImpacts).values({
      assumptionId: current.id,
      targetType: "ASSUMPTION",
      targetId: inserted.id,
    });

    await incrementStateVersion(tx, userId, scope.projectId);
    return {
      replaced: await withImpacts(tx, replaced),
      successor: await withImpacts(tx, inserted),
    };
  });
}

// Idempotent link append (AGENTS.md §94): exact duplicates — against the
// stored rows or within the call — are skipped, so a network retry never
// doubles impact rows. The version bumps only when a row is added.
// Frozen rows reject new links until reopened.
export async function addAssumptionImpacts(
  db: AppDatabase,
  userId: string,
  projectId: string,
  assumptionCode: string,
  raw: AssumptionImpactInput[],
): Promise<AssumptionRow> {
  requireOwner(userId);
  const code = assumptionCode.trim();
  if (code === "") throw new AssumptionValidationError("assumptionCode is required.");
  const impacts = requireImpacts(raw);
  const current = await loadScoped(db, userId, projectId, code);
  const currentStatus = current.status as AssumptionStatus;
  if (currentStatus !== "OPEN" && currentStatus !== "DEFERRED") {
    throw new AssumptionValidationError(
      `A ${currentStatus} assumption is frozen; reopen it to change it.`,
    );
  }
  if (impacts.length === 0) return withImpacts(db, current);
  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const existing = await loadImpacts(tx, current.id);
    const seen = new Set(existing.map((row) => `${row.targetType}::${row.targetId}`));
    let added = 0;
    for (const impact of impacts) {
      const sig = `${impact.targetType}::${impact.targetId}`;
      if (seen.has(sig)) continue;
      await assertTargetInScope(tx, scope.projectId, impact.targetType, impact.targetId);
      await tx.insert(assumptionImpacts).values({
        assumptionId: current.id,
        targetType: impact.targetType,
        targetId: impact.targetId,
      });
      seen.add(sig);
      added += 1;
    }
    if (added > 0) await incrementStateVersion(tx, userId, scope.projectId);
    const reread = await tx
      .select()
      .from(assumptions)
      .where(eq(assumptions.id, current.id))
      .limit(1);
    const found = reread[0];
    if (!found) throw new AssumptionNotFoundError();
    return withImpacts(tx, found);
  });
}

export async function listAssumptionImpacts(
  db: AppDatabase,
  userId: string,
  projectId: string,
  assumptionCode: string,
): Promise<AssumptionImpactRow[]> {
  requireOwner(userId);
  const code = assumptionCode.trim();
  if (code === "") throw new AssumptionValidationError("assumptionCode is required.");
  const current = await loadScoped(db, userId, projectId, code);
  return loadImpacts(db, current.id);
}

// Stable duplicate identity for the analyzer (TASK-075): same normalized
// statement always yields the same key, so reruns and overlapping
// producers converge instead of minting duplicates.
export function assumptionDedupeKey(statement: string): string {
  const key = statement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return key === "" ? "assumption" : key;
}
