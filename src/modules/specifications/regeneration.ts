// Incremental specification regeneration (TASK-069, architecture.md §25–§26).
//
// planRegeneration reads TASK-061 dependency data and reports exactly which
// sections went STALE after a canonical change, with human-readable reasons.
// regenerateAffectedSections re-invokes each affected document's compiler
// scoped to those keys (TASK-069 scope support in every compiler), so model
// cost and review burden stay proportional to the change.
//
// Guarantees, enforced deterministically:
//
// - Unaffected sections are never rewritten: compilers reject out-of-scope
//   proposals, and this service snapshots every unaffected CURRENT section
//   before the run and byte-compares it after — any drift aborts with
//   REGENERATION_VIOLATION instead of silently shipping.
// - Stable identifiers survive: sections update in place by stable key
//   (upsertSection), so ids never churn when concepts are unchanged.
// - Review stays mandatory: regenerated sections land as PROPOSED; approval
//   still goes through createVersion (TASK-068 workspace, TASK-112 review).
// - Failure preserves the last approved state: compilers validate before
//   writing, and this service performs no canonical writes at all.
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import type { PromptRegistry } from "../../ai/prompts/registry";
import { getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { getDocument, listSections, type SpecificationSectionRow } from "./documents";
import { listSectionSources, type SectionSourceRef } from "./dependencies";
import { SpecificationNotFoundError, SpecificationValidationError } from "./errors";
import { compilePrd } from "./prd-compiler";
import { compileArchitecture } from "./architecture-compiler";
import { compileData } from "./data-compiler";
import { compileDesign } from "./design-compiler";
import { compileProductAgents } from "./product-agents-compiler";
import { compileSoul } from "./soul-compiler";

export const REGENERABLE_DOCUMENT_TYPES = [
  "PRD",
  "ARCHITECTURE",
  "DATABASE_SCHEMA",
  "DESIGN",
  "PRODUCT_AGENTS",
  "SOUL",
] as const;

export class RegenerationError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "RegenerationError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface RegenerateAffectedDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
  documentTypes?: string[];
}

export interface AffectedSectionPlan {
  documentType: string;
  sectionKey: string;
  title: string;
  sources: SectionSourceRef[];
}

export interface RegenerationPlan {
  affected: AffectedSectionPlan[];
  unaffectedCurrentCount: number;
}

export interface RegeneratedDocument {
  documentType: string;
  status: "regenerated" | "skipped";
  requestedKeys: string[];
  regeneratedKeys: string[];
  pendingKeys: string[];
  operationId: string | null;
  reason: string;
}

export interface RegenerateAffectedResult {
  documents: RegeneratedDocument[];
  stateVersion: number;
}

interface ScopedDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
  onlySectionKeys: string[];
}

interface CompilerOutcome {
  operationId: string | null;
  applicable?: boolean;
  reasons?: string[];
}

const COMPILERS: Record<
  string,
  (db: AppDatabase, userId: string, projectId: string, deps: ScopedDeps) => Promise<CompilerOutcome>
> = {
  PRD: compilePrd,
  ARCHITECTURE: compileArchitecture,
  DATABASE_SCHEMA: compileData,
  DESIGN: compileDesign,
  PRODUCT_AGENTS: compileProductAgents,
  SOUL: compileSoul,
};

function requireDocumentTypes(raw: string[] | undefined): string[] {
  if (raw === undefined) return [...REGENERABLE_DOCUMENT_TYPES];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SpecificationValidationError(
      "documentTypes must be a non-empty array when provided.",
    );
  }
  const normalized = raw.map((entry) =>
    String(entry ?? "")
      .trim()
      .toUpperCase(),
  );
  for (const entry of normalized) {
    if (!(REGENERABLE_DOCUMENT_TYPES as readonly string[]).includes(entry)) {
      throw new SpecificationValidationError(
        `documentTypes: "${entry}" is not a regenerable document type.`,
      );
    }
  }
  return [...new Set(normalized)].sort();
}

async function resolveScope(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentTypes: string[],
): Promise<{ pid: string; types: string[] }> {
  if (userId.trim() === "")
    throw new RegenerationError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new RegenerationError("VALIDATION", "pending", "projectId is required.");
  }
  let types: string[];
  try {
    types = requireDocumentTypes(documentTypes.length === 0 ? undefined : documentTypes);
  } catch (error) {
    if (error instanceof SpecificationValidationError) {
      throw new RegenerationError("VALIDATION", "pending", error.message);
    }
    throw error;
  }
  const detail = await getProject(db, userId, projectId);
  return { pid: detail.project.id, types };
}

export async function planRegeneration(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentTypes: string[] = [...REGENERABLE_DOCUMENT_TYPES],
): Promise<RegenerationPlan> {
  const { pid, types } = await resolveScope(db, userId, projectId, documentTypes);
  const affected: AffectedSectionPlan[] = [];
  let unaffectedCurrentCount = 0;
  for (const documentType of types) {
    try {
      await getDocument(db, userId, pid, documentType);
    } catch (error) {
      if (error instanceof SpecificationNotFoundError) continue;
      throw error;
    }
    const sections = await listSections(db, userId, pid, documentType);
    for (const section of sections) {
      if (section.status === "STALE") {
        const sources = await listSectionSources(db, userId, pid, documentType, section.sectionKey);
        affected.push({
          documentType,
          sectionKey: section.sectionKey,
          title: section.title,
          sources,
        });
      } else if (section.status === "CURRENT") {
        unaffectedCurrentCount += 1;
      }
    }
  }
  affected.sort((a, b) =>
    a.documentType === b.documentType
      ? a.sectionKey.localeCompare(b.sectionKey)
      : a.documentType.localeCompare(b.documentType),
  );
  return { affected, unaffectedCurrentCount };
}

interface SectionSnapshot {
  id: string;
  title: string;
  renderedContent: string;
  structuredContent: string;
  status: string;
}

function snapshotOf(section: SpecificationSectionRow): SectionSnapshot {
  return {
    id: section.id,
    title: section.title,
    renderedContent: section.renderedContent,
    structuredContent: JSON.stringify(section.structuredContent),
    status: section.status,
  };
}

export async function regenerateAffectedSections(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: RegenerateAffectedDeps = {},
): Promise<RegenerateAffectedResult> {
  const { pid, types } = await resolveScope(db, userId, projectId, deps.documentTypes ?? []);
  const versionBefore = await getStateVersion(db, userId, pid);
  const plan = await planRegeneration(db, userId, pid, types);

  const documents: RegeneratedDocument[] = [];
  for (const documentType of types) {
    const keys = plan.affected
      .filter((entry) => entry.documentType === documentType)
      .map((entry) => entry.sectionKey);
    if (keys.length === 0) continue;

    // Snapshot every unaffected CURRENT section: the post-run guard below
    // proves the compiler left them byte-identical.
    const before = await listSections(db, userId, pid, documentType);
    const preserved = new Map<string, SectionSnapshot>();
    for (const section of before) {
      if (section.status === "CURRENT") preserved.set(section.sectionKey, snapshotOf(section));
    }

    const compile = COMPILERS[documentType];
    if (!compile) {
      throw new RegenerationError(
        "VALIDATION",
        "pending",
        `No compiler registered for "${documentType}".`,
      );
    }
    const outcome = await compile(db, userId, pid, {
      provider: deps.provider,
      prompts: deps.prompts,
      env: deps.env,
      cache: deps.cache,
      promptVersion: deps.promptVersion,
      model: deps.model,
      timeoutMs: deps.timeoutMs,
      onlySectionKeys: keys,
    });
    if (outcome.applicable === false) {
      documents.push({
        documentType,
        status: "skipped",
        requestedKeys: keys,
        regeneratedKeys: [],
        pendingKeys: keys,
        operationId: outcome.operationId,
        reason: (outcome.reasons ?? ["Not applicable."]).join(" "),
      });
      continue;
    }

    const after = await listSections(db, userId, pid, documentType);
    const afterByKey = new Map(after.map((section) => [section.sectionKey, section]));
    for (const [key, snapshot] of preserved) {
      const current = afterByKey.get(key);
      const same =
        current !== undefined &&
        current.id === snapshot.id &&
        current.title === snapshot.title &&
        current.renderedContent === snapshot.renderedContent &&
        JSON.stringify(current.structuredContent) === snapshot.structuredContent &&
        current.status === snapshot.status;
      if (!same) {
        throw new RegenerationError(
          "REGENERATION_VIOLATION",
          outcome.operationId ?? "pending",
          `Unaffected section "${key}" changed during regeneration; run aborted.`,
        );
      }
    }

    const regeneratedKeys: string[] = [];
    const pendingKeys: string[] = [];
    for (const key of keys) {
      const current = afterByKey.get(key);
      if (current && current.status === "PROPOSED") regeneratedKeys.push(key);
      else pendingKeys.push(key);
    }
    documents.push({
      documentType,
      status: "regenerated",
      requestedKeys: keys,
      regeneratedKeys,
      pendingKeys,
      operationId: outcome.operationId,
      reason:
        pendingKeys.length === 0
          ? `${regeneratedKeys.length} section(s) regenerated as PROPOSED for review.`
          : `${pendingKeys.length} section(s) omitted by the proposal and still STALE.`,
    });
  }

  const versionAfter = await getStateVersion(db, userId, pid);
  if (versionAfter !== versionBefore) {
    throw new RegenerationError(
      "STATE_MUTATED",
      "pending",
      "Regeneration must not change canonical project state.",
    );
  }
  return { documents, stateVersion: versionBefore };
}
