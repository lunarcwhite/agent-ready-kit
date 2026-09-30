// Specification domain model (TASK-060, database-schema.md §29–§33).
//
// Documents, sections, and immutable version snapshots for compiled
// specifications. Every function resolves ownership through
// requireProjectScope first (TASK-014).
//
// NO STATE-VERSION BUMPS — deliberately. Specifications are derived
// artifacts: they point AT a project state version (versions store it;
// sections will carry dependency hashes in TASK-061) rather than creating
// canonical facts. Bumping on spec writes would inflate the version the
// specs themselves reference — a self-referential loop. Canonical writes
// (decisions, knowledge, requirements) own all version increments; spec
// staleness is derived from those versions, never the reverse.
//
// Document lifecycle: ensureDocument creates DRAFT containers on demand;
// compilers write PROPOSED sections; review promotes to CURRENT;
// canonical changes mark dependents STALE (TASK-061); approving a render
// freezes an immutable specification_versions row and advances
// current_version. Snapshots are append-only: no updates, no deletes.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import {
  specificationDocuments,
  specificationSections,
  specificationVersions,
} from "../../infrastructure/database/schema/specifications";
import { requireProjectScope } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { SpecificationNotFoundError, SpecificationValidationError } from "./errors";

export const SPECIFICATION_DOCUMENT_TYPES = [
  "PRD",
  "ARCHITECTURE",
  "DATABASE_SCHEMA",
  "DESIGN",
  "PRODUCT_AGENTS",
  "SOUL",
  "TASKS",
  "CONTEXT",
  "AGENT_INSTRUCTIONS",
] as const;
export type SpecificationDocumentType = (typeof SPECIFICATION_DOCUMENT_TYPES)[number];

export const SPECIFICATION_DOCUMENT_STATUSES = [
  "DRAFT",
  "CURRENT",
  "STALE",
  "REVIEW_REQUIRED",
] as const;
export type SpecificationDocumentStatus = (typeof SPECIFICATION_DOCUMENT_STATUSES)[number];

export const SPECIFICATION_SECTION_STATUSES = [
  "CURRENT",
  "STALE",
  "PROPOSED",
  "REVIEW_REQUIRED",
] as const;
export type SpecificationSectionStatus = (typeof SPECIFICATION_SECTION_STATUSES)[number];

export interface SpecificationDocumentRow {
  id: string;
  projectId: string;
  documentType: SpecificationDocumentType;
  title: string;
  status: SpecificationDocumentStatus;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpecificationSectionRow {
  id: string;
  documentId: string;
  sectionKey: string;
  title: string;
  sortOrder: number;
  structuredContent: unknown;
  renderedContent: string;
  status: SpecificationSectionStatus;
  dependencyHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpecificationVersionRow {
  id: string;
  documentId: string;
  version: number;
  content: string;
  projectStateVersion: number;
  createdAt: Date;
}

export interface UpsertSectionInput {
  sectionKey: string;
  title: string;
  sortOrder?: number;
  structuredContent?: unknown;
  renderedContent?: string;
  status?: SpecificationSectionStatus;
}

const MAX_KEY_LENGTH = 128;
const MAX_TITLE_LENGTH = 255;
// Section keys mirror decision/knowledge key shape (dot-notation logic
// keys, e.g. `architecture.authentication` per §32) so dependency tracking
// (TASK-061) and compilers share one vocabulary.
const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function requireKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "") throw new SpecificationValidationError("sectionKey is required.");
  if (key.length > MAX_KEY_LENGTH) {
    throw new SpecificationValidationError(
      `sectionKey must be at most ${MAX_KEY_LENGTH} characters.`,
    );
  }
  if (!KEY_PATTERN.test(key)) {
    throw new SpecificationValidationError(
      "sectionKey must be lowercase dot-notation (e.g. architecture.authentication).",
    );
  }
  return key;
}

function requireTitle(raw: string, field: string): string {
  const title = raw.trim();
  if (title === "") throw new SpecificationValidationError(`${field} is required.`);
  if (title.length > MAX_TITLE_LENGTH) {
    throw new SpecificationValidationError(
      `${field} must be at most ${MAX_TITLE_LENGTH} characters.`,
    );
  }
  return title;
}

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new SpecificationValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireJsonSafe(value: unknown, field: string): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new SpecificationValidationError(`${field} must be JSON-serializable.`);
  }
}

function toDocumentRow(raw: typeof specificationDocuments.$inferSelect): SpecificationDocumentRow {
  return {
    ...raw,
    documentType: raw.documentType as SpecificationDocumentType,
    status: raw.status as SpecificationDocumentStatus,
  };
}

function toSectionRow(raw: typeof specificationSections.$inferSelect): SpecificationSectionRow {
  return { ...raw, status: raw.status as SpecificationSectionStatus };
}

function toVersionRow(raw: typeof specificationVersions.$inferSelect): SpecificationVersionRow {
  return { ...raw };
}

async function loadDocument(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
): Promise<SpecificationDocumentRow> {
  const type = requireEnum(documentType, SPECIFICATION_DOCUMENT_TYPES, "documentType");
  const scope = await requireProjectScope(db, userId, projectId);
  const found = await db.query.specificationDocuments.findFirst({
    where: and(
      eq(specificationDocuments.projectId, scope.projectId),
      eq(specificationDocuments.documentType, type),
    ),
  });
  if (!found) throw new SpecificationNotFoundError();
  return toDocumentRow(found);
}

const DEFAULT_TITLES: Record<SpecificationDocumentType, string> = {
  PRD: "Product Requirements Document",
  ARCHITECTURE: "Architecture",
  DATABASE_SCHEMA: "Database Schema",
  DESIGN: "Design",
  PRODUCT_AGENTS: "Product Agents",
  SOUL: "Soul",
  TASKS: "Tasks",
  CONTEXT: "Context",
  AGENT_INSTRUCTIONS: "Agent Instructions",
};

// Idempotent container creation: compilers call this before writing
// sections without caring whether the document exists yet. A container is
// structural, not a canonical fact — no version bump (see header note).
export async function ensureDocument(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
): Promise<SpecificationDocumentRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const type = requireEnum(documentType, SPECIFICATION_DOCUMENT_TYPES, "documentType");
  const scope = await requireProjectScope(db, userId, projectId);
  const existing = await db.query.specificationDocuments.findFirst({
    where: and(
      eq(specificationDocuments.projectId, scope.projectId),
      eq(specificationDocuments.documentType, type),
    ),
  });
  if (existing) return toDocumentRow(existing);
  try {
    const [inserted] = await db
      .insert(specificationDocuments)
      .values({ projectId: scope.projectId, documentType: type, title: DEFAULT_TITLES[type] })
      .returning();
    if (!inserted) throw new SpecificationNotFoundError("Document creation failed.");
    return toDocumentRow(inserted);
  } catch (error) {
    // Lost race with a concurrent ensure: the winner's row is the answer.
    if (isUniqueViolationError(error)) {
      return loadDocument(db, userId, scope.projectId, type);
    }
    throw error;
  }
}

export async function getDocument(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
): Promise<SpecificationDocumentRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  return loadDocument(db, userId, projectId, documentType);
}

export async function listDocuments(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<SpecificationDocumentRow[]> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.specificationDocuments.findMany({
    where: eq(specificationDocuments.projectId, scope.projectId),
    orderBy: [asc(specificationDocuments.documentType)],
  });
  return rows.map(toDocumentRow);
}

export async function updateDocumentStatus(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
  status: SpecificationDocumentStatus,
): Promise<SpecificationDocumentRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  requireEnum(status, SPECIFICATION_DOCUMENT_STATUSES, "status");
  const current = await loadDocument(db, userId, projectId, documentType);
  const [updated] = await db
    .update(specificationDocuments)
    .set({ status })
    .where(eq(specificationDocuments.id, current.id))
    .returning();
  if (!updated) throw new SpecificationNotFoundError();
  return toDocumentRow(updated);
}

async function loadSection(
  db: AppDatabase,
  documentId: string,
  sectionKey: string,
): Promise<SpecificationSectionRow> {
  const [found] = await db
    .select()
    .from(specificationSections)
    .where(
      and(
        eq(specificationSections.documentId, documentId),
        eq(specificationSections.sectionKey, sectionKey),
      ),
    )
    .limit(1);
  if (!found) throw new SpecificationNotFoundError("Specification section not found.");
  return toSectionRow(found);
}

// Compiler write path: creates the section on first write, updates in
// place afterwards. Keys are stable — regeneration never renames them.
export async function upsertSection(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
  raw: UpsertSectionInput,
): Promise<SpecificationSectionRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const key = requireKey(raw.sectionKey);
  const title = requireTitle(raw.title, "title");
  const sortOrder = raw.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder)) {
    throw new SpecificationValidationError("sortOrder must be an integer.");
  }
  const structuredContent = raw.structuredContent === undefined ? null : raw.structuredContent;
  requireJsonSafe(structuredContent, "structuredContent");
  if (raw.renderedContent !== undefined && typeof raw.renderedContent !== "string") {
    throw new SpecificationValidationError("renderedContent must be a string.");
  }
  const status =
    raw.status === undefined
      ? undefined
      : requireEnum(raw.status, SPECIFICATION_SECTION_STATUSES, "status");

  const document = await ensureDocument(db, userId, projectId, documentType);
  const existing = await db.query.specificationSections.findFirst({
    where: and(
      eq(specificationSections.documentId, document.id),
      eq(specificationSections.sectionKey, key),
    ),
  });
  if (!existing) {
    const [inserted] = await db
      .insert(specificationSections)
      .values({
        documentId: document.id,
        sectionKey: key,
        title,
        sortOrder,
        structuredContent: structuredContent as object | null,
        renderedContent: raw.renderedContent ?? "",
        status: status ?? "CURRENT",
      })
      .returning();
    if (!inserted) throw new SpecificationNotFoundError("Section creation failed.");
    return toSectionRow(inserted);
  }
  const [updated] = await db
    .update(specificationSections)
    .set({
      title,
      sortOrder,
      structuredContent: structuredContent as object | null,
      ...(raw.renderedContent !== undefined ? { renderedContent: raw.renderedContent } : {}),
      ...(status !== undefined ? { status } : {}),
    })
    .where(eq(specificationSections.id, existing.id))
    .returning();
  if (!updated) throw new SpecificationNotFoundError();
  return toSectionRow(updated);
}

export async function getSection(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
  sectionKey: string,
): Promise<SpecificationSectionRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const document = await loadDocument(db, userId, projectId, documentType);
  return loadSection(db, document.id, requireKey(sectionKey));
}

export async function listSections(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
): Promise<SpecificationSectionRow[]> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const document = await loadDocument(db, userId, projectId, documentType);
  const rows = await db.query.specificationSections.findMany({
    where: eq(specificationSections.documentId, document.id),
    orderBy: [asc(specificationSections.sortOrder), asc(specificationSections.sectionKey)],
  });
  return rows.map(toSectionRow);
}

export async function markSectionStale(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
  sectionKey: string,
): Promise<SpecificationSectionRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const document = await loadDocument(db, userId, projectId, documentType);
  const current = await loadSection(db, document.id, requireKey(sectionKey));
  // Idempotent: already-STALE returns as is. PROPOSED sections are unreviewed
  // drafts — staleness is meaningless until they are accepted.
  if (current.status === "STALE" || current.status === "PROPOSED") return current;
  const [updated] = await db
    .update(specificationSections)
    .set({ status: "STALE" })
    .where(eq(specificationSections.id, current.id))
    .returning();
  if (!updated) throw new SpecificationNotFoundError();
  return toSectionRow(updated);
}

// Freezes the document's CURRENT sections into an immutable snapshot bound
// to the present project state version, then advances current_version.
// Snapshots are never edited or deleted: history stays queryable.
export async function createVersion(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
): Promise<SpecificationVersionRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const document = await loadDocument(db, userId, projectId, documentType);
  const sections = await listSections(db, userId, projectId, documentType);
  const content = sections
    .map((section) => `# ${section.title}\n\n${section.renderedContent}`.trimEnd())
    .join("\n\n");
  const stateVersion = await getStateVersion(db, userId, document.projectId);
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(specificationVersions)
      .values({
        documentId: document.id,
        version: document.currentVersion,
        content,
        projectStateVersion: stateVersion,
      })
      .returning();
    if (!inserted) throw new SpecificationNotFoundError("Version snapshot failed.");
    await tx
      .update(specificationDocuments)
      .set({ currentVersion: document.currentVersion + 1, status: "CURRENT" })
      .where(eq(specificationDocuments.id, document.id));
    return toVersionRow(inserted);
  });
}

export async function listVersions(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
): Promise<SpecificationVersionRow[]> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const document = await loadDocument(db, userId, projectId, documentType);
  const rows = await db.query.specificationVersions.findMany({
    where: eq(specificationVersions.documentId, document.id),
    orderBy: [asc(specificationVersions.version)],
  });
  return rows.map(toVersionRow);
}

export async function getVersion(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
  version: number,
): Promise<SpecificationVersionRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  if (!Number.isInteger(version) || version < 1) {
    throw new SpecificationValidationError("version must be a positive integer.");
  }
  const document = await loadDocument(db, userId, projectId, documentType);
  const [found] = await db
    .select()
    .from(specificationVersions)
    .where(
      and(
        eq(specificationVersions.documentId, document.id),
        eq(specificationVersions.version, version),
      ),
    )
    .limit(1);
  if (!found) throw new SpecificationNotFoundError("Specification version not found.");
  return toVersionRow(found);
}
