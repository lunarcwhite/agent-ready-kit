// Specification dependency tracking (TASK-061, database-schema.md §34).
//
// Every section declares which canonical elements influence it; when one of
// those elements changes, markStaleDependents flips exactly the dependent
// sections to STALE and leaves the rest CURRENT. Deterministic throughout:
// the dependency hash is a pure function of the sorted dep set, so equal
// inputs always produce equal hashes and compilers can skip unchanged work.
//
// Like specifications themselves, dependency rows are derived state — writes
// here never bump the project state version.
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import {
  sectionDependencies,
  specificationDocuments,
  specificationSections,
} from "../../infrastructure/database/schema/specifications";
import { decisions } from "../../infrastructure/database/schema/decisions";
import { knowledgeItems } from "../../infrastructure/database/schema/knowledge";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { requireProjectScope } from "../projects/repository";
import { getSection, markSectionStale, type SpecificationSectionRow } from "./documents";
import { SpecificationValidationError } from "./errors";

export const SECTION_SOURCE_TYPES = ["DECISION", "KNOWLEDGE", "REQUIREMENT", "ENTITY"] as const;
export type SectionSourceType = (typeof SECTION_SOURCE_TYPES)[number];

export interface SectionDependencyInput {
  sourceType: SectionSourceType;
  sourceId: string;
}

export interface SectionDependencyRow {
  id: string;
  sectionId: string;
  sourceType: SectionSourceType;
  sourceId: string;
  createdAt: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new SpecificationValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

// FNV-1a 64-bit, hex-encoded. Crypto is overkill for a change-detection
// fingerprint; what matters is determinism across processes and readability
// in debugging. Input must already be canonical (sorted) — see
// computeDependencyHash.
function fnv1aHex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function computeDependencyHash(refs: SectionDependencyInput[]): string {
  const sorted = [...refs].map((ref) => `${ref.sourceType}::${ref.sourceId}`).sort();
  return fnv1aHex(sorted.join("\n"));
}

function requireRefs(raw: SectionDependencyInput[] | undefined): ValidatedRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new SpecificationValidationError("dependencies must be an array when provided.");
  }
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new SpecificationValidationError(
        `dependencies[${i}] must be { sourceType, sourceId }.`,
      );
    }
    const sourceType = requireEnum(
      String((item as { sourceType?: unknown }).sourceType ?? ""),
      SECTION_SOURCE_TYPES,
      `dependencies[${i}].sourceType`,
    );
    const sourceId = String((item as { sourceId?: unknown }).sourceId ?? "").trim();
    if (!UUID_PATTERN.test(sourceId)) {
      throw new SpecificationValidationError(`dependencies[${i}].sourceId must be a UUID.`);
    }
    return { sourceType, sourceId };
  });
}

interface ValidatedRef {
  sourceType: SectionSourceType;
  sourceId: string;
}

// Strict same-project existence for row-backed types. ENTITY rows live in a
// future domain_entities table (TASK-064 area) — until then ENTITY refs are
// structural (valid UUID) so compilers can declare them without fabricating
// validation. Missing and foreign rows surface identically as validation
// errors, never revealing other projects.
async function assertRefInScope(
  db: AppDatabase,
  projectId: string,
  ref: ValidatedRef,
  field: string,
): Promise<void> {
  if (ref.sourceType === "ENTITY") return;
  const missing = (): never => {
    throw new SpecificationValidationError(
      `${field}: ${ref.sourceType} source not found in this project.`,
    );
  };
  if (ref.sourceType === "DECISION") {
    const found = await db.query.decisions.findFirst({
      columns: { id: true },
      where: and(eq(decisions.projectId, projectId), eq(decisions.id, ref.sourceId)),
    });
    if (!found) missing();
    return;
  }
  if (ref.sourceType === "KNOWLEDGE") {
    const found = await db.query.knowledgeItems.findFirst({
      columns: { id: true },
      where: and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.id, ref.sourceId)),
    });
    if (!found) missing();
    return;
  }
  const found = await db.query.requirements.findFirst({
    columns: { id: true },
    where: and(eq(requirements.projectId, projectId), eq(requirements.id, ref.sourceId)),
  });
  if (!found) missing();
}

// Replace-all primitive: the compiler declares the section's complete dep
// set every run, so removed links vanish instead of lingering. Stores the
// dependency hash on the section for cheap change detection. Atomic.
export async function setSectionDependencies(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
  sectionKey: string,
  raw: SectionDependencyInput[],
): Promise<SpecificationSectionRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const refs = requireRefs(raw);
  const section = await getSection(db, userId, projectId, documentType, sectionKey);
  const scope = await requireProjectScope(db, userId, projectId);
  for (const [i, ref] of refs.entries()) {
    await assertRefInScope(db, scope.projectId, ref, `dependencies[${i}]`);
  }
  return db.transaction(async (tx) => {
    await tx.delete(sectionDependencies).where(eq(sectionDependencies.sectionId, section.id));
    for (const ref of refs) {
      await tx.insert(sectionDependencies).values({
        sectionId: section.id,
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
      });
    }
    const hash = refs.length === 0 ? null : computeDependencyHash(refs);
    const [updated] = await tx
      .update(specificationSections)
      .set({ dependencyHash: hash })
      .where(eq(specificationSections.id, section.id))
      .returning();
    if (!updated) throw new SpecificationValidationError("Section update failed.");
    const reread = await getSection(db, userId, scope.projectId, documentType, sectionKey);
    return { ...reread, dependencyHash: hash };
  });
}

export async function listSectionDependencies(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
  sectionKey: string,
): Promise<SectionDependencyRow[]> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const section = await getSection(db, userId, projectId, documentType, sectionKey);
  const rows = await db.query.sectionDependencies.findMany({
    where: eq(sectionDependencies.sectionId, section.id),
  });
  return rows.map((row) => ({ ...row, sourceType: row.sourceType as SectionSourceType }));
}

// Reverse lookup: every section (document type + key) depending on a
// canonical element, scoped to the caller's project. Powers deterministic
// staleness propagation.
export async function listSectionsDependingOn(
  db: AppDatabase,
  userId: string,
  projectId: string,
  sourceType: SectionSourceType,
  sourceId: string,
): Promise<{ documentType: string; sectionKey: string }[]> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  requireEnum(sourceType, SECTION_SOURCE_TYPES, "sourceType");
  const id = sourceId.trim();
  if (!UUID_PATTERN.test(id)) {
    throw new SpecificationValidationError("sourceId must be a UUID.");
  }
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db
    .select({
      documentType: specificationDocuments.documentType,
      sectionKey: specificationSections.sectionKey,
    })
    .from(sectionDependencies)
    .innerJoin(specificationSections, eq(sectionDependencies.sectionId, specificationSections.id))
    .innerJoin(
      specificationDocuments,
      eq(specificationSections.documentId, specificationDocuments.id),
    )
    .where(
      and(
        eq(sectionDependencies.sourceType, sourceType),
        eq(sectionDependencies.sourceId, id),
        eq(specificationDocuments.projectId, scope.projectId),
      ),
    );
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const sig = `${row.documentType}::${row.sectionKey}`;
    if (seen.has(sig)) return [];
    seen.add(sig);
    return [{ documentType: row.documentType as string, sectionKey: row.sectionKey }];
  });
}

// Deterministic staleness propagation (acceptance): after a canonical
// element changes, exactly its dependent sections become STALE —
// unaffected sections stay CURRENT. Returns the affected section keys.
export async function markStaleDependents(
  db: AppDatabase,
  userId: string,
  projectId: string,
  sourceType: SectionSourceType,
  sourceId: string,
): Promise<{ documentType: string; sectionKey: string }[]> {
  const dependents = await listSectionsDependingOn(db, userId, projectId, sourceType, sourceId);
  const affected: { documentType: string; sectionKey: string }[] = [];
  for (const dependent of dependents) {
    const before = await getSection(
      db,
      userId,
      projectId,
      dependent.documentType,
      dependent.sectionKey,
    );
    if (before.status === "STALE") {
      affected.push(dependent);
      continue;
    }
    await markSectionStale(db, userId, projectId, dependent.documentType, dependent.sectionKey);
    affected.push(dependent);
  }
  return affected;
}
