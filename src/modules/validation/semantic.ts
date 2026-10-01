// Semantic Validator service (TASK-073, agents.md A-020, FR-061).
//
// Compares approved specification sections across deterministic pairs and
// persists genuine contradictions as CONSISTENCY issues. Pipeline:
//
//   approved sections → pair selection (deterministic)
//     → one orchestrated AI call (all pairs, cost-aware)
//     → meaning validation + LOW-confidence suppression (deterministic)
//     → reconcile (dedupe / reopen / auto-resolve, shared with TASK-071/072)
//
// AI boundary (AGENT-IMPL-INV-001, AG-INV-001): the model only proposes.
// Nothing reaches canonical state except through reconcileFindings, which
// writes issues via TASK-070. A provider failure propagates with no issue
// written — approved state stays intact (AG-INV-006).
//
// Noise tolerance differs deliberately from the compilers: where
// PRD/architecture compilation aborts a batch on the first bad reference
// (proposals must be exact), a validator degrades gracefully — one noisy
// finding is dropped and counted while valid signal still persists.
// Silencing everything because of one bad finding would itself be a
// validation failure (agents.md §32: high signal over volume).
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  SEMANTIC_VALIDATION_PROMPT,
  SEMANTIC_VALIDATION_PROMPT_KEY,
  SEMANTIC_VALIDATION_PROMPT_VERSION,
} from "../../ai/prompts/semantic-validation";
import {
  SEMANTIC_VALIDATION_SCHEMA,
  type SemanticIssue,
  type SemanticValidation,
} from "../../ai/schemas/semantic-validation";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { requireProjectScope } from "../projects/repository";
import {
  listDocuments,
  listSections,
  type SpecificationSectionRow,
} from "../specifications/documents";
import { SpecificationNotFoundError } from "../specifications/errors";
import { reconcileFindings, type ValidatorFinding } from "./reconcile";
import { IssueValidationError } from "./errors";
import type { IssueSeverity } from "./issues";

export const SEMANTIC_VALIDATOR = "semantic-v1" as const;
export const SEMANTIC_RULE = "semantic-contradiction" as const;
export const SEMANTIC_CAPABILITY = "semantic-validation" as const;
export const SEMANTIC_OPERATION_TYPE = "SEMANTIC_VALIDATION";

export class SemanticValidatorError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "SemanticValidatorError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface SemanticDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
}

export interface SemanticReport {
  pairs: string[];
  findings: ValidatorFinding[];
  suppressed: number;
  dropped: number;
  created: string[];
  reopened: string[];
  resolved: string[];
  unchangedOpen: string[];
  operationId: string | null;
  model: string | null;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
}

// Candidate pairs in priority order (agents.md §30). Requirement↔Task and
// Business-Rule↔Workflow pairs are excluded: the executable task graph
// arrives with TASK-093 and workflows have no section mapping yet.
const PAIR_PRIORITY: ReadonlyArray<readonly [string, string]> = [
  ["PRD", "ARCHITECTURE"],
  ["PRD", "DESIGN"],
  ["PRD", "DATABASE_SCHEMA"],
  ["ARCHITECTURE", "DATABASE_SCHEMA"],
];

export interface ValidationPair {
  left: string;
  right: string;
  key: string;
  slug: string;
}

export function pairKey(left: string, right: string): string {
  return `${left}::${right}`;
}

export function pairSlug(left: string, right: string): string {
  return `${left.toLowerCase()}-${right.toLowerCase()}`;
}

// Pure and deterministic: same available document set always yields the
// same pairs in priority order. The model never chooses what to compare
// (agents.md §8: application owns topic selection).
export function selectValidationPairs(available: readonly string[]): ValidationPair[] {
  const present = new Set(available.map((type) => type.trim().toUpperCase()));
  const pairs: ValidationPair[] = [];
  for (const [left, right] of PAIR_PRIORITY) {
    if (present.has(left) && present.has(right)) {
      pairs.push({ left, right, key: pairKey(left, right), slug: pairSlug(left, right) });
    }
  }
  return pairs;
}

// Context budget (AGENTS.md §29, agents.md §49): approved sections only —
// CURRENT status, never STALE (outdated) or PROPOSED (unreviewed) — with
// per-section truncation so input cannot grow with project history.
const MAX_SECTIONS_PER_DOCUMENT = 12;
const MAX_SECTION_CHARS = 2000;

interface SectionInput {
  sectionKey: string;
  title: string;
  body: string;
}

function toSectionInput(section: SpecificationSectionRow): SectionInput {
  const body =
    section.renderedContent.length > MAX_SECTION_CHARS
      ? `${section.renderedContent.slice(0, MAX_SECTION_CHARS)}… (truncated)`
      : section.renderedContent;
  return { sectionKey: section.sectionKey, title: section.title, body };
}

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(SEMANTIC_VALIDATION_PROMPT_KEY, SEMANTIC_VALIDATION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...SEMANTIC_VALIDATION_PROMPT });
    } catch (error) {
      registry.resolve(SEMANTIC_VALIDATION_PROMPT_KEY, SEMANTIC_VALIDATION_PROMPT.version);
      void error;
    }
  }
}

function slug(text: string, maxLength: number): string {
  const slugified = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return slugified === "" ? "finding" : slugified;
}

// Meaning checks the length-based schema cannot express: blank text,
// unknown pairs, and sources that do not resolve to loaded approved
// sections of the finding's own pair. Returns null for droppable noise;
// throws nothing — the caller counts drops (noise tolerance, agents.md §32).
export function normalizeFinding(
  issue: SemanticIssue,
  pairByKey: ReadonlyMap<string, ValidationPair>,
  sectionKeys: ReadonlyMap<string, SpecificationSectionRow>,
): ValidatorFinding | null {
  if (typeof issue !== "object" || issue === null || Array.isArray(issue)) return null;
  const title = String(issue.title ?? "").trim();
  const description = String(issue.description ?? "").trim();
  if (title === "" || description === "") return null;
  const pair = pairByKey.get(
    String(issue.pair ?? "")
      .trim()
      .toUpperCase(),
  );
  if (!pair) return null;
  if (!Array.isArray(issue.sources) || issue.sources.length === 0) return null;

  const sides = new Set([pair.left, pair.right]);
  const resolved: { documentType: string; sectionKey: string; title: string }[] = [];
  for (const source of issue.sources) {
    if (typeof source !== "object" || source === null || Array.isArray(source)) return null;
    const documentType = String((source as { documentType?: unknown }).documentType ?? "")
      .trim()
      .toUpperCase();
    const sectionKey = String((source as { sectionKey?: unknown }).sectionKey ?? "")
      .trim()
      .toLowerCase();
    if (documentType === "" || sectionKey === "") return null;
    if (!sides.has(documentType)) return null;
    const section = sectionKeys.get(`${documentType}::${sectionKey}`);
    if (!section) return null;
    if (
      !resolved.some(
        (entry) => entry.documentType === documentType && entry.sectionKey === sectionKey,
      )
    ) {
      resolved.push({ documentType, sectionKey, title: section.title });
    }
  }
  if (resolved.length === 0) return null;

  const suggestedResolution =
    issue.suggestedResolution === undefined ? "" : String(issue.suggestedResolution).trim();
  if (issue.suggestedResolution !== undefined && suggestedResolution === "") return null;

  const sourcesBlock = resolved
    .map((entry) => `- ${entry.documentType} \`${entry.sectionKey}\` ("${entry.title}")`)
    .join("\n");
  const fullDescription =
    suggestedResolution === ""
      ? `${description}\n\nSources:\n${sourcesBlock}`
      : `${description}\n\nSources:\n${sourcesBlock}\n\nSuggested resolution: ${suggestedResolution}`;

  return {
    rule: SEMANTIC_RULE,
    targetKey: `${pair.slug}::${slug(title, 80)}`,
    title: `Contradiction (${pair.left} ↔ ${pair.right}): ${title}`,
    description: fullDescription,
    severity: issue.severity as IssueSeverity,
    references: [],
  };
}

// LOW-confidence findings are suppressed here, deterministically —
// stylistic differences and speculation never reach the issue tracker
// (acceptance criterion, agents.md §32).
export function selectActionableFindings(issues: SemanticIssue[]): SemanticIssue[] {
  return issues.filter((issue) => issue.confidence === "HIGH" || issue.confidence === "MEDIUM");
}

export async function runSemanticValidation(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: SemanticDeps = {},
): Promise<SemanticReport> {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
  if (projectId.trim() === "") throw new IssueValidationError("projectId is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const pid = scope.projectId;

  const documents = await listDocuments(db, userId, pid);
  const pairs = selectValidationPairs(documents.map((document) => document.documentType));
  const pairByKey = new Map(pairs.map((pair) => [pair.key, pair]));

  // Approved CURRENT sections only; a pair with no approved content on
  // either side is not comparable and is skipped without an AI call.
  const sectionKeys = new Map<string, SpecificationSectionRow>();
  const comparable: ValidationPair[] = [];
  for (const pair of pairs) {
    let left: SpecificationSectionRow[] = [];
    let right: SpecificationSectionRow[] = [];
    try {
      [left, right] = await Promise.all([
        listSections(db, userId, pid, pair.left),
        listSections(db, userId, pid, pair.right),
      ]);
    } catch (error) {
      if (error instanceof SpecificationNotFoundError) continue;
      throw error;
    }
    const leftCurrent = left
      .filter((section) => section.status === "CURRENT")
      .slice(0, MAX_SECTIONS_PER_DOCUMENT);
    const rightCurrent = right
      .filter((section) => section.status === "CURRENT")
      .slice(0, MAX_SECTIONS_PER_DOCUMENT);
    if (leftCurrent.length === 0 || rightCurrent.length === 0) continue;
    // First load wins per (document, section): repeated loads of a shared
    // document across pairs return the same rows.
    for (const bucket of [
      { documentType: pair.left, sections: leftCurrent },
      { documentType: pair.right, sections: rightCurrent },
    ]) {
      for (const section of bucket.sections) {
        const key = `${bucket.documentType}::${section.sectionKey}`;
        if (!sectionKeys.has(key)) sectionKeys.set(key, section);
      }
    }
    comparable.push(pair);
  }

  const emptyReport = async (): Promise<SemanticReport> => {
    const reconciled = await reconcileFindings(
      db,
      userId,
      pid,
      SEMANTIC_VALIDATOR,
      "CONSISTENCY",
      [],
    );
    return {
      pairs: [],
      findings: [],
      suppressed: 0,
      dropped: 0,
      ...reconciled,
      operationId: null,
      model: null,
      promptKey: SEMANTIC_VALIDATION_PROMPT_KEY,
      promptVersion: deps.promptVersion ?? SEMANTIC_VALIDATION_PROMPT_VERSION,
      repaired: false,
      latencyMs: 0,
    };
  };
  if (comparable.length === 0) return emptyReport();

  const taskInput = JSON.stringify({
    pairs: comparable.map((pair) => ({
      pair: pair.key,
      left: {
        documentType: pair.left,
        sections: sectionInputsFor(pair.left, sectionKeys),
      },
      right: {
        documentType: pair.right,
        sections: sectionInputsFor(pair.right, sectionKeys),
      },
    })),
  });

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId: pid,
        capability: SEMANTIC_CAPABILITY,
        operationType: SEMANTIC_OPERATION_TYPE,
        promptKey: SEMANTIC_VALIDATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput,
        schema: SEMANTIC_VALIDATION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new SemanticValidatorError(error.code, error.operationId, error.message);
    }
    throw error;
  }

  const payload = orchestrated.data as SemanticValidation;
  if (!payload || !Array.isArray(payload.issues)) {
    throw new SemanticValidatorError(
      "VALIDATION",
      orchestrated.operationId,
      "Semantic proposal must contain an issues array.",
    );
  }
  const suppressed = payload.issues.length - selectActionableFindings(payload.issues).length;
  const actionable = selectActionableFindings(payload.issues);

  const seen = new Set<string>();
  const findings: ValidatorFinding[] = [];
  let dropped = 0;
  for (const issue of actionable) {
    const normalized = normalizeFinding(issue, pairByKey, sectionKeys);
    if (!normalized) {
      dropped += 1;
      continue;
    }
    const identity = `${normalized.rule}::${normalized.targetKey}`;
    if (seen.has(identity)) {
      dropped += 1;
      continue;
    }
    seen.add(identity);
    findings.push(normalized);
  }

  const reconciled = await reconcileFindings(
    db,
    userId,
    pid,
    SEMANTIC_VALIDATOR,
    "CONSISTENCY",
    findings,
  );
  return {
    pairs: comparable.map((pair) => pair.key),
    findings,
    suppressed,
    dropped,
    ...reconciled,
    operationId: orchestrated.operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
  };
}

function sectionInputsFor(
  documentType: string,
  sectionKeys: ReadonlyMap<string, SpecificationSectionRow>,
): SectionInput[] {
  const out: SectionInput[] = [];
  for (const [key, section] of sectionKeys) {
    if (key.startsWith(`${documentType}::`)) out.push(toSectionInput(section));
  }
  out.sort((a, b) => a.sectionKey.localeCompare(b.sectionKey));
  return out;
}
