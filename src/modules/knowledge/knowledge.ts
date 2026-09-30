// Knowledge domain model (TASK-055, FR-030–032, database-schema.md §18–§21).
//
// Normalized canonical understanding, independent from discovery chatter and
// generated prose. One row per (project, knowledge_key); keys are lowercase
// dot-notation (e.g. `vision.summary`), validated here — never LLM output.
// Domains are canonical (§19); human aliases (Vision, Personas, Entities…)
// converge through taxonomy.ts (tasks.md §18a) before persistence.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted mutation numbers the project
// state version once (TASK-020) inside the same transaction as the data
// change, so a rollback never leaves a version pointing at missing state.
//
// Provenance (TASK-025, FR-031): origin lives in `knowledge_sources`, not in
// prose. `resolveKnowledgeProvenance` projects (primary source, confidence)
// through the shared provenance map, so an ASSUMED item can never read as
// "Confirmed by you". Full decision-provenance joins (inheriting a source
// decision's own origin) belong to the curator (TASK-056); this model maps
// DECISION/REQUIREMENT sources to USER origin and documents the limit.
//
// NOT here: AI normalization/merging semantics (TASK-056 curator), prompt
// wording, and specification rendering (M6 compilers consume these rows).
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { decisions, requirements } from "../../infrastructure/database/schema";
import { knowledgeItems, knowledgeSources } from "../../infrastructure/database/schema/knowledge";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { resolveProvenance, type Provenance } from "../provenance/provenance";
import { KnowledgeNotFoundError, KnowledgeValidationError } from "./errors";
import { normalizeKnowledgeDomain, type KnowledgeDomain } from "./taxonomy";

export type { KnowledgeDomain };
export type { Provenance };

export const KNOWLEDGE_STATUSES = ["CURRENT", "STALE", "SUPERSEDED"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const KNOWLEDGE_CONFIDENCES = ["EXPLICIT", "INFERRED", "ASSUMED"] as const;
export type KnowledgeConfidence = (typeof KNOWLEDGE_CONFIDENCES)[number];

export const KNOWLEDGE_SOURCE_TYPES = [
  "DECISION",
  "USER_MESSAGE",
  "PROJECT_INPUT",
  "AI_INFERENCE",
  "REQUIREMENT",
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export interface KnowledgeSourceInput {
  type: KnowledgeSourceType;
  sourceId?: string | null;
}

export interface KnowledgeSourceRow {
  id: string;
  knowledgeItemId: string;
  sourceType: KnowledgeSourceType;
  sourceId: string | null;
  createdAt: Date;
}

export interface KnowledgeItemRow {
  id: string;
  projectId: string;
  knowledgeKey: string;
  domain: KnowledgeDomain;
  title: string;
  content: unknown;
  confidence: KnowledgeConfidence;
  status: KnowledgeStatus;
  sources: KnowledgeSourceRow[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeInput {
  knowledgeKey: string;
  domain: string;
  title: string;
  content: unknown;
  confidence: KnowledgeConfidence;
  sources?: KnowledgeSourceInput[];
}

export interface UpdateKnowledgeInput {
  title?: string;
  content?: unknown;
  confidence?: KnowledgeConfidence;
  status?: "CURRENT" | "STALE";
}

export interface SupersedeKnowledgeInput {
  newKey: string;
  domain?: string;
  title?: string;
  content?: unknown;
  confidence?: KnowledgeConfidence;
  sources?: KnowledgeSourceInput[];
}

const MAX_KEY_LENGTH = 128;
const MAX_TITLE_LENGTH = 255;
// Lowercase dot-notation logic keys, same shape as decision keys (TASK-021):
// segments keep the key space readable; single-segment keys are allowed.
const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireKey(raw: string): string {
  return normalizeKnowledgeKey(raw);
}

// Exported for proposal-validating callers (curator, TASK-056): same rule,
// same error, no duplicated pattern. Throws KnowledgeValidationError.
export function normalizeKnowledgeKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "") throw new KnowledgeValidationError("knowledgeKey is required.");
  if (key.length > MAX_KEY_LENGTH) {
    throw new KnowledgeValidationError(
      `knowledgeKey must be at most ${MAX_KEY_LENGTH} characters.`,
    );
  }
  if (!KEY_PATTERN.test(key)) {
    throw new KnowledgeValidationError(
      "knowledgeKey must be lowercase dot-notation (e.g. vision.summary).",
    );
  }
  return key;
}

function requireTitle(raw: string): string {
  const title = raw.trim();
  if (title === "") throw new KnowledgeValidationError("title is required.");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new KnowledgeValidationError(`title must be at most ${MAX_TITLE_LENGTH} characters.`);
  }
  return title;
}

function requireContent(raw: unknown): unknown {
  if (raw === undefined) throw new KnowledgeValidationError("content is required.");
  try {
    JSON.stringify(raw);
  } catch {
    throw new KnowledgeValidationError("content must be JSON-serializable.");
  }
  return raw;
}

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new KnowledgeValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireSourceId(raw: string | null | undefined, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  const id = raw.trim();
  if (id === "") return null;
  if (!UUID_PATTERN.test(id)) {
    throw new KnowledgeValidationError(`${field} must be a UUID when provided.`);
  }
  return id;
}

// Source refs are validated structurally here; existence/scope checks for
// row-backed types run inside the caller's transaction (same-project DECISION
// and REQUIREMENT ids only — the acceptance criterion. USER_MESSAGE,
// PROJECT_INPUT, and AI_INFERENCE accept a UUID or null as evidence-grade
// refs; strict message linkage arrives with the curator in TASK-056).
function requireSources(
  raw: KnowledgeSourceInput[] | undefined,
): { sourceType: KnowledgeSourceType; sourceId: string | null }[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new KnowledgeValidationError("sources must be an array when provided.");
  }
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new KnowledgeValidationError(`sources[${i}] must be { type, sourceId? }.`);
    }
    const sourceType = requireEnum(
      String((item as { type?: unknown }).type ?? ""),
      KNOWLEDGE_SOURCE_TYPES,
      `sources[${i}].type`,
    );
    const sourceId = requireSourceId(
      (item as { sourceId?: unknown }).sourceId as string | null | undefined,
      `sources[${i}].sourceId`,
    );
    // Row-backed refs without an id are malformed, not merely unresolvable:
    // reject before any write so bad calls never touch the database.
    if ((sourceType === "DECISION" || sourceType === "REQUIREMENT") && sourceId === null) {
      throw new KnowledgeValidationError(
        `sources[${i}].sourceId is required for type ${sourceType}.`,
      );
    }
    return { sourceType, sourceId };
  });
}

function toSourceRow(raw: typeof knowledgeSources.$inferSelect): KnowledgeSourceRow {
  return {
    ...raw,
    sourceType: raw.sourceType as KnowledgeSourceType,
  };
}

function toItemRow(
  raw: typeof knowledgeItems.$inferSelect,
  sources: KnowledgeSourceRow[],
): KnowledgeItemRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    knowledgeKey: raw.knowledgeKey,
    domain: raw.domain as KnowledgeDomain,
    title: raw.title,
    content: raw.content,
    confidence: raw.confidence as KnowledgeConfidence,
    status: raw.status as KnowledgeStatus,
    sources: [...sources].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async function loadSources(
  db: AppDatabase,
  itemIds: string[],
): Promise<Map<string, KnowledgeSourceRow[]>> {
  const grouped = new Map<string, KnowledgeSourceRow[]>();
  if (itemIds.length === 0) return grouped;
  const rows = await db.query.knowledgeSources.findMany({
    where: inArray(knowledgeSources.knowledgeItemId, itemIds),
  });
  for (const row of rows) {
    const parsed = toSourceRow(row);
    const list = grouped.get(parsed.knowledgeItemId) ?? [];
    list.push(parsed);
    grouped.set(parsed.knowledgeItemId, list);
  }
  return grouped;
}

// Strict same-project check for row-backed source types. Missing rows and
// foreign rows surface identically as validation errors — the domain never
// reveals whether another user's decision or requirement exists (TASK-014).
async function assertSourceInScope(
  db: AppDatabase,
  projectId: string,
  type: KnowledgeSourceType,
  sourceId: string | null,
): Promise<void> {
  if (sourceId === null) {
    if (type === "DECISION" || type === "REQUIREMENT") {
      throw new KnowledgeValidationError(
        `sources of type ${type} require a sourceId referencing this project's row.`,
      );
    }
    return;
  }
  if (type === "DECISION") {
    const found = await db.query.decisions.findFirst({
      columns: { id: true },
      where: and(eq(decisions.projectId, projectId), eq(decisions.id, sourceId)),
    });
    if (!found) {
      throw new KnowledgeValidationError("Source decision not found in this project.");
    }
  } else if (type === "REQUIREMENT") {
    const found = await db.query.requirements.findFirst({
      columns: { id: true },
      where: and(eq(requirements.projectId, projectId), eq(requirements.id, sourceId)),
    });
    if (!found) {
      throw new KnowledgeValidationError("Source requirement not found in this project.");
    }
  }
}

async function insertSources(
  db: AppDatabase,
  itemId: string,
  projectId: string,
  sources: { sourceType: KnowledgeSourceType; sourceId: string | null }[],
): Promise<void> {
  for (const source of sources) {
    await assertSourceInScope(db, projectId, source.sourceType, source.sourceId);
    await db.insert(knowledgeSources).values({
      knowledgeItemId: itemId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
    });
  }
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  knowledgeKey: string,
): Promise<typeof knowledgeItems.$inferSelect> {
  const scope = await requireProjectScope(db, userId, projectId);
  const found = await db.query.knowledgeItems.findFirst({
    where: and(
      eq(knowledgeItems.projectId, scope.projectId),
      eq(knowledgeItems.knowledgeKey, knowledgeKey),
    ),
  });
  if (!found) throw new KnowledgeNotFoundError();
  return found;
}

async function withSources(
  db: AppDatabase,
  item: typeof knowledgeItems.$inferSelect,
): Promise<KnowledgeItemRow> {
  const grouped = await loadSources(db, [item.id]);
  return toItemRow(item, grouped.get(item.id) ?? []);
}

export async function createKnowledgeItem(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateKnowledgeInput,
): Promise<KnowledgeItemRow> {
  // All structural validation runs before any write: malformed calls must
  // not create rows or advance the project version.
  if (userId.trim() === "") throw new KnowledgeValidationError("Owner is required.");
  const knowledgeKey = requireKey(raw.knowledgeKey);
  const domain = normalizeKnowledgeDomain(raw.domain);
  const title = requireTitle(raw.title);
  const content = requireContent(raw.content);
  const confidence = requireEnum(raw.confidence, KNOWLEDGE_CONFIDENCES, "confidence");
  const sources = requireSources(raw.sources);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    let inserted: typeof knowledgeItems.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(knowledgeItems)
        .values({
          projectId: scope.projectId,
          knowledgeKey,
          domain,
          title,
          content: content as object,
          confidence,
          status: "CURRENT",
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new KnowledgeValidationError(
          `Knowledge "${knowledgeKey}" already exists in this project.`,
        );
      }
      throw error;
    }
    if (!inserted) throw new KnowledgeNotFoundError("Knowledge creation failed.");
    await insertSources(tx, inserted.id, scope.projectId, sources);
    await incrementStateVersion(tx, userId, scope.projectId);
    return withSources(tx, inserted);
  });
}

export async function getKnowledgeByKey(
  db: AppDatabase,
  userId: string,
  projectId: string,
  knowledgeKey: string,
): Promise<KnowledgeItemRow> {
  if (userId.trim() === "") throw new KnowledgeValidationError("Owner is required.");
  return withSources(db, await loadScoped(db, userId, projectId, requireKey(knowledgeKey)));
}

export interface ListKnowledgeFilter {
  domain?: string;
  status?: KnowledgeStatus;
}

export async function listKnowledge(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: ListKnowledgeFilter,
): Promise<KnowledgeItemRow[]> {
  if (userId.trim() === "") throw new KnowledgeValidationError("Owner is required.");
  const domain = filter?.domain === undefined ? undefined : normalizeKnowledgeDomain(filter.domain);
  if (filter?.status !== undefined) requireEnum(filter.status, KNOWLEDGE_STATUSES, "status");
  const scope = await requireProjectScope(db, userId, projectId);
  const conditions = [eq(knowledgeItems.projectId, scope.projectId)];
  if (domain !== undefined) conditions.push(eq(knowledgeItems.domain, domain));
  if (filter?.status !== undefined) {
    conditions.push(eq(knowledgeItems.status, filter.status as KnowledgeStatus));
  }
  const rows = await db.query.knowledgeItems.findMany({
    where: and(...conditions),
    orderBy: [asc(knowledgeItems.knowledgeKey)],
  });
  const grouped = await loadSources(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toItemRow(row, grouped.get(row.id) ?? []));
}

// Efficient current-knowledge projection: the read path behind specification
// compilers (M6) and readiness — indexed by (project_id, status), no
// superseded history unless explicitly requested via listKnowledge.
export async function listCurrentKnowledge(
  db: AppDatabase,
  userId: string,
  projectId: string,
  domain?: string,
): Promise<KnowledgeItemRow[]> {
  return listKnowledge(db, userId, projectId, { domain, status: "CURRENT" });
}

export async function updateKnowledgeItem(
  db: AppDatabase,
  userId: string,
  projectId: string,
  knowledgeKey: string,
  raw: UpdateKnowledgeInput,
): Promise<KnowledgeItemRow> {
  if (userId.trim() === "") throw new KnowledgeValidationError("Owner is required.");
  const key = requireKey(knowledgeKey);
  if (raw.title !== undefined) requireTitle(raw.title);
  if (raw.content !== undefined) requireContent(raw.content);
  if (raw.confidence !== undefined)
    requireEnum(raw.confidence, KNOWLEDGE_CONFIDENCES, "confidence");
  if (raw.status !== undefined) {
    // SUPERSEDED is server-managed: supersede/merge own that transition, so
    // a supersede without a surviving winner is unrepresentable.
    requireEnum(raw.status, ["CURRENT", "STALE"] as const, "status");
  }
  const touches =
    raw.title !== undefined ||
    raw.content !== undefined ||
    raw.confidence !== undefined ||
    raw.status !== undefined;

  const current = await loadScoped(db, userId, projectId, key);
  if (current.status === "SUPERSEDED") {
    throw new KnowledgeValidationError("A SUPERSEDED item is frozen; supersede it instead.");
  }
  if (!touches) return withSources(db, current);

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(knowledgeItems)
      .set({
        ...(raw.title !== undefined ? { title: raw.title.trim() } : {}),
        ...(raw.content !== undefined ? { content: raw.content as object } : {}),
        ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
        ...(raw.status !== undefined ? { status: raw.status } : {}),
      })
      .where(eq(knowledgeItems.id, current.id))
      .returning();
    if (!updated) throw new KnowledgeNotFoundError();
    await incrementStateVersion(tx, userId, current.projectId);
    return withSources(tx, updated);
  });
}

// Marks a CURRENT item STALE when upstream canonical state changes
// (database-schema.md §71 transaction). Idempotent: already-STALE returns as
// is without burning a version; SUPERSEDED rows are frozen.
export async function markKnowledgeStale(
  db: AppDatabase,
  userId: string,
  projectId: string,
  knowledgeKey: string,
): Promise<KnowledgeItemRow> {
  if (userId.trim() === "") throw new KnowledgeValidationError("Owner is required.");
  const current = await loadScoped(db, userId, projectId, requireKey(knowledgeKey));
  if (current.status === "SUPERSEDED") {
    throw new KnowledgeValidationError("A SUPERSEDED item is frozen; supersede it instead.");
  }
  if (current.status === "STALE") return withSources(db, current);
  return updateKnowledgeItem(db, userId, projectId, knowledgeKey, { status: "STALE" });
}

export async function addKnowledgeSources(
  db: AppDatabase,
  userId: string,
  projectId: string,
  knowledgeKey: string,
  raw: KnowledgeSourceInput[],
): Promise<KnowledgeItemRow> {
  if (userId.trim() === "") throw new KnowledgeValidationError("Owner is required.");
  const sources = requireSources(raw);
  if (sources.length === 0) {
    return withSources(db, await loadScoped(db, userId, projectId, requireKey(knowledgeKey)));
  }
  const current = await loadScoped(db, userId, projectId, requireKey(knowledgeKey));
  if (current.status === "SUPERSEDED") {
    throw new KnowledgeValidationError("A SUPERSEDED item is frozen; supersede it instead.");
  }
  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const existing = await tx.query.knowledgeSources.findMany({
      where: eq(knowledgeSources.knowledgeItemId, current.id),
    });
    const seen = new Set(existing.map((row) => `${row.sourceType}::${row.sourceId ?? ""}`));
    let added = 0;
    for (const source of sources) {
      // Idempotent retry (AGENTS.md §94): exact duplicates are skipped, so a
      // network retry never doubles provenance rows.
      if (seen.has(`${source.sourceType}::${source.sourceId ?? ""}`)) continue;
      await assertSourceInScope(tx, scope.projectId, source.sourceType, source.sourceId);
      await tx.insert(knowledgeSources).values({
        knowledgeItemId: current.id,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
      });
      seen.add(`${source.sourceType}::${source.sourceId ?? ""}`);
      added += 1;
    }
    if (added > 0) await incrementStateVersion(tx, userId, scope.projectId);
    const reread = await tx.query.knowledgeItems.findFirst({
      where: eq(knowledgeItems.id, current.id),
    });
    if (!reread) throw new KnowledgeNotFoundError();
    return withSources(tx, reread);
  });
}

// Blessed replacement path (acceptance: active/superseded state). The old row
// freezes as SUPERSEDED — its key is never reused — and the successor starts
// CURRENT under a fresh key. Provenance carries over by default (the reasons
// we believed the old item still support its replacement) plus caller extras,
// deduped. One user action, one version bump.
export async function supersedeKnowledgeItem(
  db: AppDatabase,
  userId: string,
  projectId: string,
  knowledgeKey: string,
  raw: SupersedeKnowledgeInput,
): Promise<{ old: KnowledgeItemRow; next: KnowledgeItemRow }> {
  if (userId.trim() === "") throw new KnowledgeValidationError("Owner is required.");
  const oldKey = requireKey(knowledgeKey);
  const newKey = requireKey(raw.newKey);
  if (newKey === oldKey) {
    throw new KnowledgeValidationError("A successor must use a new knowledge key.");
  }
  const domain = raw.domain === undefined ? undefined : normalizeKnowledgeDomain(raw.domain);
  if (raw.title !== undefined) requireTitle(raw.title);
  if (raw.content !== undefined) requireContent(raw.content);
  if (raw.confidence !== undefined)
    requireEnum(raw.confidence, KNOWLEDGE_CONFIDENCES, "confidence");
  const extraSources = requireSources(raw.sources);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const found = await tx.query.knowledgeItems.findFirst({
      where: and(
        eq(knowledgeItems.projectId, scope.projectId),
        eq(knowledgeItems.knowledgeKey, oldKey),
      ),
    });
    if (!found) throw new KnowledgeNotFoundError();
    if (found.status === "SUPERSEDED") {
      throw new KnowledgeValidationError("A SUPERSEDED item cannot be superseded again.");
    }

    let inserted: typeof knowledgeItems.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(knowledgeItems)
        .values({
          projectId: scope.projectId,
          knowledgeKey: newKey,
          domain: domain ?? (found.domain as KnowledgeDomain),
          title: raw.title === undefined ? found.title : raw.title.trim(),
          content: (raw.content === undefined ? found.content : raw.content) as object,
          confidence: raw.confidence ?? (found.confidence as KnowledgeConfidence),
          status: "CURRENT",
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new KnowledgeValidationError(`Knowledge "${newKey}" already exists in this project.`);
      }
      throw error;
    }
    if (!inserted) throw new KnowledgeNotFoundError("Knowledge creation failed.");

    // Carry-over keeps the successor's "why" complete; exact duplicates with
    // caller extras collapse to one row each.
    const carried = await tx.query.knowledgeSources.findMany({
      where: eq(knowledgeSources.knowledgeItemId, found.id),
    });
    const seen = new Set<string>();
    const merged: { sourceType: KnowledgeSourceType; sourceId: string | null }[] = [];
    for (const row of [
      ...carried.map((r) => ({
        sourceType: r.sourceType as KnowledgeSourceType,
        sourceId: r.sourceId,
      })),
      ...extraSources,
    ]) {
      const sig = `${row.sourceType}::${row.sourceId ?? ""}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      merged.push(row);
    }
    await insertSources(tx, inserted.id, scope.projectId, merged);

    const [frozen] = await tx
      .update(knowledgeItems)
      .set({ status: "SUPERSEDED" })
      .where(eq(knowledgeItems.id, found.id))
      .returning();
    if (!frozen) throw new KnowledgeNotFoundError();

    await incrementStateVersion(tx, userId, scope.projectId);
    return { old: await withSources(tx, frozen), next: await withSources(tx, inserted) };
  });
}

// Deterministic duplicate detection (acceptance criterion): same domain plus
// equal normalized title or equal normalized content. Pure normalization —
// no AI similarity — so results are stable and testable; semantic near-dupe
// judgment belongs to the curator (TASK-056).
function normalizeText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .sort();
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface DuplicateKnowledgeGroup {
  domain: KnowledgeDomain;
  items: KnowledgeItemRow[];
}

export async function findDuplicateCandidates(
  db: AppDatabase,
  userId: string,
  projectId: string,
  domain?: string,
): Promise<DuplicateKnowledgeGroup[]> {
  const items = await listKnowledge(db, userId, projectId, { domain, status: "CURRENT" });
  // Union-find over item indices: an item joins every signature bucket its
  // normalized title and content produce; buckets with a shared member merge.
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[i] !== i) {
      const next = parent[i] ?? i;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const buckets = new Map<string, number[]>();
  items.forEach((item, i) => {
    for (const sig of [`t:${normalizeText(item.title)}`, `c:${stableStringify(item.content)}`]) {
      const bucket = buckets.get(`${item.domain}::${sig}`) ?? [];
      for (const member of bucket) union(member, i);
      bucket.push(i);
      buckets.set(`${item.domain}::${sig}`, bucket);
    }
  });
  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(i);
    groups.set(root, group);
  });
  return [...groups.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const sorted = members
        .map((i) => items[i])
        .filter((item): item is KnowledgeItemRow => item !== undefined)
        .sort((a, b) => a.knowledgeKey.localeCompare(b.knowledgeKey));
      return { domain: sorted[0]?.domain ?? ("PRODUCT" as KnowledgeDomain), items: sorted };
    })
    .filter((group) => group.items.length > 1)
    .sort((a, b) => a.items[0]?.knowledgeKey.localeCompare(b.items[0]?.knowledgeKey ?? "") ?? 0);
}

// Deterministic merge: the loser freezes as SUPERSEDED and its provenance
// rows re-point to the winner (deduped), so no origin is lost. Both items
// must be CURRENT in the same domain — cross-domain merges are a modeling
// error, not a cleanup. One user action, one version bump.
export async function mergeKnowledgeItems(
  db: AppDatabase,
  userId: string,
  projectId: string,
  winnerKey: string,
  loserKey: string,
): Promise<KnowledgeItemRow> {
  if (userId.trim() === "") throw new KnowledgeValidationError("Owner is required.");
  const winner = requireKey(winnerKey);
  const loser = requireKey(loserKey);
  if (winner === loser) {
    throw new KnowledgeValidationError("Winner and loser must be different items.");
  }
  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const [winnerRow, loserRow] = await Promise.all([
      tx.query.knowledgeItems.findFirst({
        where: and(
          eq(knowledgeItems.projectId, scope.projectId),
          eq(knowledgeItems.knowledgeKey, winner),
        ),
      }),
      tx.query.knowledgeItems.findFirst({
        where: and(
          eq(knowledgeItems.projectId, scope.projectId),
          eq(knowledgeItems.knowledgeKey, loser),
        ),
      }),
    ]);
    if (!winnerRow || !loserRow) throw new KnowledgeNotFoundError();
    if (winnerRow.status !== "CURRENT" || loserRow.status !== "CURRENT") {
      throw new KnowledgeValidationError("Only CURRENT items can be merged.");
    }
    if (winnerRow.domain !== loserRow.domain) {
      throw new KnowledgeValidationError("Only items in the same domain can be merged.");
    }

    const [winnerSources, loserSources] = await Promise.all([
      tx.query.knowledgeSources.findMany({
        where: eq(knowledgeSources.knowledgeItemId, winnerRow.id),
      }),
      tx.query.knowledgeSources.findMany({
        where: eq(knowledgeSources.knowledgeItemId, loserRow.id),
      }),
    ]);
    const seen = new Set(winnerSources.map((row) => `${row.sourceType}::${row.sourceId ?? ""}`));
    for (const row of loserSources) {
      const sig = `${row.sourceType}::${row.sourceId ?? ""}`;
      if (seen.has(sig)) continue;
      await tx.insert(knowledgeSources).values({
        knowledgeItemId: winnerRow.id,
        sourceType: row.sourceType as KnowledgeSourceType,
        sourceId: row.sourceId,
      });
      seen.add(sig);
    }
    const [frozen] = await tx
      .update(knowledgeItems)
      .set({ status: "SUPERSEDED" })
      .where(eq(knowledgeItems.id, loserRow.id))
      .returning();
    if (!frozen) throw new KnowledgeNotFoundError();

    await incrementStateVersion(tx, userId, scope.projectId);
    const reread = await tx.query.knowledgeItems.findFirst({
      where: eq(knowledgeItems.id, winnerRow.id),
    });
    if (!reread) throw new KnowledgeNotFoundError();
    return withSources(tx, reread);
  });
}

// Projects (primary source, confidence) to the shared five-origin vocabulary
// (TASK-025). Source mapping: PROJECT_INPUT/USER_MESSAGE/DECISION/
// REQUIREMENT originate from the user side; AI_INFERENCE is AI origin. The
// shared resolver guarantees ASSUMED confidence never yields USER_EXPLICIT,
// so assumptions stay visibly assumptions. Sourceless items carry no origin
// claim and resolve to null — like UNRESOLVED decisions.
const SOURCE_TO_PROVENANCE_SOURCE: Record<KnowledgeSourceType, "USER" | "AI_INFERENCE"> = {
  PROJECT_INPUT: "USER",
  USER_MESSAGE: "USER",
  DECISION: "USER",
  REQUIREMENT: "USER",
  AI_INFERENCE: "AI_INFERENCE",
};

export function resolveKnowledgeProvenance(
  sources: Pick<KnowledgeSourceRow, "sourceType" | "createdAt">[],
  confidence: KnowledgeConfidence,
): Provenance | null {
  if (sources.length === 0) return null;
  const primary = [...sources].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  if (!primary) return null;
  return resolveProvenance(SOURCE_TO_PROVENANCE_SOURCE[primary.sourceType], confidence);
}

export function withKnowledgeProvenance<T extends Pick<KnowledgeItemRow, "sources" | "confidence">>(
  item: T,
): T & { provenance: Provenance | null } {
  return { ...item, provenance: resolveKnowledgeProvenance(item.sources, item.confidence) };
}
