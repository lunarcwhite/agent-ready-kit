// Entity domain model (TASK-064, database-schema.md §26–§28).
//
// Stable implementation-relevant domain entities, independent from generated
// database-schema prose (compiled by the data compiler in the same task).
// Codes (ENT-001…) are atomic per-project sequences, never LLM output,
// never reused — including across supersede chains and removals.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first. Every accepted change numbers the project
// state version once (TASK-020).
//
// Domain ≠ persistence (agents.md §23): a Product Entity such as
// Subscription exists before physical tables are generated; the compiler
// performs that translation explicitly into PROPOSED sections, which are
// derived state and never bump the version.
//
// Supersede is the blessed replacement path: the old row freezes as
// SUPERSEDED with metadata.supersededBy, the successor carries
// metadata.supersedes. Direct writes to SUPERSEDED are rejected.
// REMOVED is written only by removeEntity: the row freezes as the audit
// trail and is never hard-deleted, so its code can never be reissued.
//
// Reads use select().from() rather than db.query: this table is new and
// the shared AppDatabase query map may lag behind schema registration in
// some wiring orders; select/from is table-generic and unaffected.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { allocateStableIdTx } from "../../infrastructure/database/identifiers";
import {
  domainEntities,
  entityAttributes,
  entityRelationships,
} from "../../infrastructure/database/schema/entities";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { EntityNotFoundError, EntityValidationError } from "./errors";

export const ENTITY_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED", "SUPERSEDED", "REMOVED"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const ENTITY_RELATIONSHIP_TYPES = ["ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY"] as const;
export type EntityRelationshipType = (typeof ENTITY_RELATIONSHIP_TYPES)[number];

const LIVE_STATUSES: readonly EntityStatus[] = ["DRAFT", "CONFIRMED", "DEFERRED"];

export interface EntityMetadata {
  supersedes?: string;
  supersededBy?: string;
  supersedeReason?: string;
}

export interface EntityAttributeInput {
  name: string;
  dataType: string;
  required?: boolean;
  uniqueValue?: boolean;
  description?: string | null;
}

export interface EntityAttributeRow {
  id: string;
  entityId: string;
  name: string;
  dataType: string;
  required: boolean;
  uniqueValue: boolean;
  description: string | null;
}

export interface EntityRelationshipRow {
  id: string;
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  sourceCode: string;
  targetCode: string;
  relationshipType: EntityRelationshipType;
  name: string | null;
  description: string | null;
}

export interface EntityRow {
  id: string;
  projectId: string;
  entityCode: string;
  name: string;
  description: string | null;
  ownershipModel: unknown;
  lifecycle: unknown;
  status: EntityStatus;
  metadata: EntityMetadata | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityDetail extends EntityRow {
  attributes: EntityAttributeRow[];
}

export interface CreateEntityInput {
  name: string;
  description?: string | null;
  ownershipModel?: unknown;
  lifecycle?: unknown;
  status: EntityStatus;
  attributes?: EntityAttributeInput[];
}

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20000;
const MAX_DATA_TYPE_LENGTH = 64;

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new EntityValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireText(raw: string, field: string, max: number): string {
  const text = raw.trim();
  if (text === "") throw new EntityValidationError(`${field} is required.`);
  if (text.length > max) {
    throw new EntityValidationError(`${field} must be at most ${max} characters.`);
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
    throw new EntityValidationError(`${field} must be at most ${max} characters.`);
  }
  return text === "" ? null : text;
}

function requireJsonSafe(value: unknown, field: string): void {
  if (value === undefined) return;
  try {
    JSON.stringify(value);
  } catch {
    throw new EntityValidationError(`${field} must be JSON-serializable.`);
  }
}

function requireAttributes(raw: EntityAttributeInput[] | undefined): EntityAttributeInput[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new EntityValidationError("attributes must be an array.");
  const seen = new Set<string>();
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new EntityValidationError(`attributes[${i}] must be an object.`);
    }
    const name = requireText(String(item.name ?? ""), `attributes[${i}].name`, MAX_NAME_LENGTH);
    const key = name.toLowerCase();
    if (seen.has(key))
      throw new EntityValidationError(`attributes[${i}]: duplicate name "${name}".`);
    seen.add(key);
    const dataType = requireText(
      String(item.dataType ?? ""),
      `attributes[${i}].dataType`,
      MAX_DATA_TYPE_LENGTH,
    );
    return {
      name,
      dataType,
      required: item.required ?? false,
      uniqueValue: item.uniqueValue ?? false,
      description:
        item.description === undefined
          ? null
          : (requireOptionalText(
              item.description,
              `attributes[${i}].description`,
              MAX_DESCRIPTION_LENGTH,
            ) ?? null),
    };
  });
}

function parseMetadata(raw: unknown): EntityMetadata | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  const out: EntityMetadata = {};
  if (typeof meta.supersedes === "string") out.supersedes = meta.supersedes;
  if (typeof meta.supersededBy === "string") out.supersededBy = meta.supersededBy;
  if (typeof meta.supersedeReason === "string") out.supersedeReason = meta.supersedeReason;
  return Object.keys(out).length > 0 ? out : null;
}

function buildMetadata(
  extra?: Pick<EntityMetadata, "supersedes" | "supersededBy">,
): EntityMetadata | null {
  const meta: EntityMetadata = {};
  if (extra?.supersedes) meta.supersedes = extra.supersedes;
  if (extra?.supersededBy) meta.supersededBy = extra.supersededBy;
  return Object.keys(meta).length > 0 ? meta : null;
}

function toRow(raw: typeof domainEntities.$inferSelect): EntityRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    entityCode: raw.entityCode,
    name: raw.name,
    description: raw.description,
    ownershipModel: (raw.ownershipModel ?? null) as unknown,
    lifecycle: (raw.lifecycle ?? null) as unknown,
    status: raw.status as EntityStatus,
    metadata: parseMetadata(raw.metadata),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function toAttributeRow(raw: typeof entityAttributes.$inferSelect): EntityAttributeRow {
  return {
    id: raw.id,
    entityId: raw.entityId,
    name: raw.name,
    dataType: raw.dataType,
    required: raw.required,
    uniqueValue: raw.uniqueValue,
    description: raw.description,
  };
}

function requireLiveStatusForWrite(status: EntityStatus, field: string): void {
  if (status === "SUPERSEDED") {
    throw new EntityValidationError("Use supersedeEntity to create a successor.");
  }
  if (status === "REMOVED") {
    throw new EntityValidationError("Use removeEntity to withdraw an entity.");
  }
  requireEnum(status, LIVE_STATUSES, field);
}

async function loadScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  entityCode: string,
): Promise<EntityRow> {
  const scope = await requireProjectScope(db, userId, projectId);
  const [found] = await db
    .select()
    .from(domainEntities)
    .where(
      and(eq(domainEntities.projectId, scope.projectId), eq(domainEntities.entityCode, entityCode)),
    )
    .limit(1);
  if (!found) throw new EntityNotFoundError("Domain entity not found.");
  return toRow(found);
}

async function loadAttributes(db: AppDatabase, entityId: string): Promise<EntityAttributeRow[]> {
  const rows = await db
    .select()
    .from(entityAttributes)
    .where(eq(entityAttributes.entityId, entityId))
    .orderBy(asc(entityAttributes.name));
  return rows.map(toAttributeRow);
}

export async function createEntity(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateEntityInput,
): Promise<EntityDetail> {
  if (userId.trim() === "") throw new EntityValidationError("Owner is required.");
  const name = requireText(raw.name, "name", MAX_NAME_LENGTH);
  const description = requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const status = requireEnum(raw.status, ENTITY_STATUSES, "status");
  requireLiveStatusForWrite(status, "status");
  requireJsonSafe(raw.ownershipModel, "ownershipModel");
  requireJsonSafe(raw.lifecycle, "lifecycle");
  const attributes = requireAttributes(raw.attributes);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const entityCode = await allocateStableIdTx(tx, scope.projectId, "ENT");
    let inserted: typeof domainEntities.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(domainEntities)
        .values({
          projectId: scope.projectId,
          entityCode,
          name,
          description: description ?? null,
          ownershipModel: (raw.ownershipModel ?? null) as never,
          lifecycle: (raw.lifecycle ?? null) as never,
          status,
          metadata: buildMetadata() as never,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new EntityValidationError("Entity code clash, retry the operation.");
      }
      throw error;
    }
    if (!inserted) throw new EntityNotFoundError("Entity creation failed.");
    for (const attr of attributes) {
      await tx.insert(entityAttributes).values({
        entityId: inserted.id,
        name: attr.name,
        dataType: attr.dataType,
        required: attr.required ?? false,
        uniqueValue: attr.uniqueValue ?? false,
        description: attr.description ?? null,
      });
    }
    await incrementStateVersion(tx, userId, scope.projectId);
    return { ...toRow(inserted), attributes: await loadAttributes(tx, inserted.id) };
  });
}

export async function getEntityByCode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  entityCode: string,
): Promise<EntityDetail> {
  if (userId.trim() === "") throw new EntityValidationError("Owner is required.");
  const code = entityCode.trim();
  if (code === "") throw new EntityValidationError("entityCode is required.");
  const row = await loadScoped(db, userId, projectId, code);
  return { ...row, attributes: await loadAttributes(db, row.id) };
}

export async function listEntities(
  db: AppDatabase,
  userId: string,
  projectId: string,
  filter?: { status?: EntityStatus },
): Promise<EntityRow[]> {
  if (userId.trim() === "") throw new EntityValidationError("Owner is required.");
  if (filter?.status !== undefined) requireEnum(filter.status, ENTITY_STATUSES, "status");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db
    .select()
    .from(domainEntities)
    .where(
      filter?.status === undefined
        ? eq(domainEntities.projectId, scope.projectId)
        : and(
            eq(domainEntities.projectId, scope.projectId),
            eq(domainEntities.status, filter.status),
          ),
    )
    .orderBy(asc(domainEntities.entityCode));
  return rows.map(toRow);
}

// Full detail projection behind the data compiler: every live entity with
// its attributes plus all project relationships with resolved codes, so the
// model receives explicit structure instead of inferring it.
export async function listEntityDetails(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<{ entities: EntityDetail[]; relationships: EntityRelationshipRow[] }> {
  const rows = await listEntities(db, userId, projectId);
  const scope = await requireProjectScope(db, userId, projectId);
  const entities: EntityDetail[] = [];
  for (const row of rows) {
    entities.push({ ...row, attributes: await loadAttributes(db, row.id) });
  }
  const codeById = new Map(entities.map((entity) => [entity.id, entity.entityCode]));
  const relRows = await db
    .select()
    .from(entityRelationships)
    .where(eq(entityRelationships.projectId, scope.projectId))
    .orderBy(asc(entityRelationships.createdAt));
  return {
    entities,
    relationships: relRows.map((rel) => ({
      id: rel.id,
      projectId: rel.projectId,
      sourceEntityId: rel.sourceEntityId,
      targetEntityId: rel.targetEntityId,
      sourceCode: codeById.get(rel.sourceEntityId) ?? "?",
      targetCode: codeById.get(rel.targetEntityId) ?? "?",
      relationshipType: rel.relationshipType as EntityRelationshipType,
      name: rel.name,
      description: rel.description,
    })),
  };
}

export interface CreateRelationshipInput {
  sourceCode: string;
  targetCode: string;
  relationshipType: EntityRelationshipType;
  name?: string | null;
  description?: string | null;
}

export async function addRelationship(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateRelationshipInput,
): Promise<EntityRelationshipRow> {
  if (userId.trim() === "") throw new EntityValidationError("Owner is required.");
  const relationshipType = requireEnum(
    raw.relationshipType,
    ENTITY_RELATIONSHIP_TYPES,
    "relationshipType",
  );
  const sourceCode = raw.sourceCode.trim();
  const targetCode = raw.targetCode.trim();
  if (sourceCode === "" || targetCode === "") {
    throw new EntityValidationError("sourceCode and targetCode are required.");
  }
  const name = requireOptionalText(raw.name, "name", MAX_NAME_LENGTH);
  const description = requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const [source] = await tx
      .select()
      .from(domainEntities)
      .where(
        and(
          eq(domainEntities.projectId, scope.projectId),
          eq(domainEntities.entityCode, sourceCode),
        ),
      )
      .limit(1);
    const [target] = await tx
      .select()
      .from(domainEntities)
      .where(
        and(
          eq(domainEntities.projectId, scope.projectId),
          eq(domainEntities.entityCode, targetCode),
        ),
      )
      .limit(1);
    if (!source || !target) throw new EntityNotFoundError("Domain entity not found.");
    const [inserted] = await tx
      .insert(entityRelationships)
      .values({
        projectId: scope.projectId,
        sourceEntityId: source.id,
        targetEntityId: target.id,
        relationshipType,
        name: name ?? null,
        description: description ?? null,
      })
      .returning();
    if (!inserted) throw new EntityNotFoundError("Relationship creation failed.");
    await incrementStateVersion(tx, userId, scope.projectId);
    return {
      id: inserted.id,
      projectId: inserted.projectId,
      sourceEntityId: inserted.sourceEntityId,
      targetEntityId: inserted.targetEntityId,
      sourceCode: source.entityCode,
      targetCode: target.entityCode,
      relationshipType: inserted.relationshipType as EntityRelationshipType,
      name: inserted.name,
      description: inserted.description,
    };
  });
}

// Withdrawal without deletion (codes are never reused after removal). The
// row freezes as REMOVED and rejects further edits.
export async function removeEntity(
  db: AppDatabase,
  userId: string,
  projectId: string,
  entityCode: string,
): Promise<EntityRow> {
  if (userId.trim() === "") throw new EntityValidationError("Owner is required.");
  const code = entityCode.trim();
  if (code === "") throw new EntityValidationError("entityCode is required.");

  const current = await loadScoped(db, userId, projectId, code);
  if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
    throw new EntityValidationError(
      `A ${current.status} entity is frozen and cannot be removed again.`,
    );
  }

  return db.transaction(async (tx) => {
    const [removed] = await tx
      .update(domainEntities)
      .set({ status: "REMOVED" })
      .where(eq(domainEntities.id, current.id))
      .returning();
    if (!removed) throw new EntityNotFoundError();
    const row = toRow(removed);
    await incrementStateVersion(tx, userId, current.projectId);
    return row;
  });
}

// Blessed replacement path: the old row freezes as SUPERSEDED pointing at
// its successor, the successor carries a FRESH code (never reused, §68)
// pointing back. One user action, one version bump.
export async function supersedeEntity(
  db: AppDatabase,
  userId: string,
  projectId: string,
  entityCode: string,
  raw: CreateEntityInput,
  reason?: string | null,
): Promise<{ old: EntityRow; next: EntityDetail }> {
  if (userId.trim() === "") throw new EntityValidationError("Owner is required.");
  const code = entityCode.trim();
  if (code === "") throw new EntityValidationError("entityCode is required.");
  const name = requireText(raw.name, "name", MAX_NAME_LENGTH);
  const description = requireOptionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  const status = requireEnum(raw.status, ENTITY_STATUSES, "status");
  if (status === "SUPERSEDED" || status === "REMOVED") {
    throw new EntityValidationError("A successor must start in a live status.");
  }
  requireJsonSafe(raw.ownershipModel, "ownershipModel");
  requireJsonSafe(raw.lifecycle, "lifecycle");
  const attributes = requireAttributes(raw.attributes);
  const changeReason =
    reason === undefined || reason === null || reason.trim() === "" ? null : reason.trim();

  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const [found] = await tx
      .select()
      .from(domainEntities)
      .where(
        and(eq(domainEntities.projectId, scope.projectId), eq(domainEntities.entityCode, code)),
      )
      .limit(1);
    if (!found) throw new EntityNotFoundError("Domain entity not found.");
    const current = toRow(found);
    if (current.status === "SUPERSEDED" || current.status === "REMOVED") {
      throw new EntityValidationError(`A ${current.status} entity cannot be superseded again.`);
    }

    const nextCode = await allocateStableIdTx(tx, scope.projectId, "ENT");
    const [inserted] = await tx
      .insert(domainEntities)
      .values({
        projectId: scope.projectId,
        entityCode: nextCode,
        name,
        description: description ?? null,
        ownershipModel: (raw.ownershipModel ?? null) as never,
        lifecycle: (raw.lifecycle ?? null) as never,
        status,
        metadata: buildMetadata({ supersedes: code }) as never,
      })
      .returning();
    if (!inserted) throw new EntityNotFoundError("Entity creation failed.");
    for (const attr of attributes) {
      await tx.insert(entityAttributes).values({
        entityId: inserted.id,
        name: attr.name,
        dataType: attr.dataType,
        required: attr.required ?? false,
        uniqueValue: attr.uniqueValue ?? false,
        description: attr.description ?? null,
      });
    }
    const next = toRow(inserted);

    const oldMeta: EntityMetadata = {
      ...(current.metadata ?? {}),
      supersededBy: nextCode,
      ...(changeReason ? { supersedeReason: changeReason } : {}),
    };
    const [frozen] = await tx
      .update(domainEntities)
      .set({ status: "SUPERSEDED", metadata: oldMeta as never })
      .where(eq(domainEntities.id, current.id))
      .returning();
    if (!frozen) throw new EntityNotFoundError();

    await incrementStateVersion(tx, userId, scope.projectId);
    return { old: toRow(frozen), next: { ...next, attributes: await loadAttributes(tx, next.id) } };
  });
}
