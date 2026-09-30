// Knowledge Curator service (TASK-056, FR-030–032, agents.md A-004–A-006).
//
// Normalizes validated decisions and statements into Project Knowledge.
// Two phases, mirroring the TASK-054 candidate flow:
//
// 1. curateKnowledge — proposal-only. Loads existing knowledge plus focus
//    decisions, calls the orchestrator with the versioned `knowledge.curate`
//    prompt and strict schema, then validates every proposal
//    deterministically (all-or-nothing). Writes nothing canonical.
// 2. applyCuration — re-validates the proposal, then persists bucket by
//    bucket through the knowledge domain (which owns version bumps).
//    A supersede whose successor key names an EXISTING current item
//    consolidates via merge instead of duplicating content.
//
// Strength rule (acceptance: confirmed decisions are not overwritten by
// weaker AI inference): confidence ranks EXPLICIT > INFERRED > ASSUMED. An
// update or successor must rank at or above its target; an EXPLICIT create
// must be grounded in a user-origin source or a CONFIRMED decision/
// requirement. Source decisions must be CONFIRMED — recommendations that
// were accepted arrive as CONFIRMED (TASK-054), so anything weaker cannot
// ground knowledge.
//
// Failure contract: provider/validation failures propagate with canonical
// state untouched (version-unchanged guard fails loudly on regression).
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  KNOWLEDGE_CURATION_PROMPT,
  KNOWLEDGE_CURATION_PROMPT_KEY,
} from "../../ai/prompts/knowledge-curation";
import {
  KNOWLEDGE_CURATION_SCHEMA,
  type CuratorSource,
  type KnowledgeCuration,
} from "../../ai/schemas/knowledge-curation";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { decisions } from "../../infrastructure/database/schema/decisions";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { getDecisionByKey, type DecisionRow } from "../decisions/decisions";
import { DecisionNotFoundError } from "../decisions/errors";
import {
  addKnowledgeSources,
  createKnowledgeItem,
  getKnowledgeByKey,
  listKnowledge,
  mergeKnowledgeItems,
  supersedeKnowledgeItem,
  updateKnowledgeItem,
  type KnowledgeConfidence,
  type KnowledgeDomain,
  type KnowledgeItemRow,
  type KnowledgeSourceType,
} from "./knowledge";
import { normalizeKnowledgeDomain } from "./taxonomy";
import { normalizeKnowledgeKey } from "./knowledge";
import { KnowledgeNotFoundError, KnowledgeValidationError } from "./errors";

export const CURATION_CAPABILITY = "knowledge-curation" as const;
export const CURATION_OPERATION_TYPE = "KNOWLEDGE_CURATION";

export class CuratorError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "CuratorError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface CurateKnowledgeInput {
  decisionKeys?: string[];
}

export interface CurateKnowledgeDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
}

export interface CurateKnowledgeResult {
  proposal: KnowledgeCuration;
  operationId: string;
  model: string;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
  stateVersion: number;
}

export interface AppliedCuration {
  created: string[];
  updated: string[];
  superseded: string[];
  merged: { winner: string; loser: string }[];
  sourcesAttached: string[];
  stateVersionBefore: number;
  stateVersionAfter: number;
}

// EXPLICIT > INFERRED > ASSUMED. Numbers only exist to compare strength —
// they never persist and never gate readiness.
const CONFIDENCE_RANK: Record<KnowledgeConfidence, number> = {
  EXPLICIT: 3,
  INFERRED: 2,
  ASSUMED: 1,
};

function requireConfidence(raw: string, field: string): KnowledgeConfidence {
  if (raw !== "EXPLICIT" && raw !== "INFERRED" && raw !== "ASSUMED") {
    throw new KnowledgeValidationError(`${field} must be EXPLICIT, INFERRED, or ASSUMED.`);
  }
  return raw;
}

interface ValidatedSource {
  sourceType: KnowledgeSourceType;
  sourceId: string | null;
}

interface ValidatedProposal {
  create: {
    key: string;
    domain: KnowledgeDomain;
    title: string;
    content: unknown;
    confidence: KnowledgeConfidence;
    sources: ValidatedSource[];
  }[];
  update: {
    key: string;
    target: KnowledgeItemRow;
    title?: string;
    content?: unknown;
    confidence?: KnowledgeConfidence;
  }[];
  supersede: {
    key: string;
    target: KnowledgeItemRow;
    successorKey: string;
    successor: KnowledgeItemRow | null;
    domain?: KnowledgeDomain;
    title?: string;
    content?: unknown;
    confidence?: KnowledgeConfidence;
  }[];
  sources: { key: string; target: KnowledgeItemRow; sources: ValidatedSource[] }[];
}

function checkSourceShape(source: CuratorSource, field: string): ValidatedSource {
  const type = source.type as string;
  if (
    type !== "DECISION" &&
    type !== "USER_MESSAGE" &&
    type !== "PROJECT_INPUT" &&
    type !== "AI_INFERENCE" &&
    type !== "REQUIREMENT"
  ) {
    throw new KnowledgeValidationError(`${field}.type must be a known source type.`);
  }
  const sourceId =
    source.sourceId === undefined || source.sourceId === null
      ? null
      : String(source.sourceId).trim() === ""
        ? null
        : String(source.sourceId).trim();
  if ((type === "DECISION" || type === "REQUIREMENT") && sourceId === null) {
    throw new KnowledgeValidationError(`${field}.sourceId is required for type ${type}.`);
  }
  return { sourceType: type as KnowledgeSourceType, sourceId };
}

async function checkSourceSemantics(
  db: AppDatabase,
  projectId: string,
  source: ValidatedSource,
  field: string,
  operationId: string,
): Promise<{ userOrigin: boolean }> {
  if (source.sourceType === "PROJECT_INPUT" || source.sourceType === "USER_MESSAGE") {
    return { userOrigin: true };
  }
  if (source.sourceType === "AI_INFERENCE") {
    return { userOrigin: false };
  }
  if (source.sourceType === "DECISION") {
    const found = await db.query.decisions.findFirst({
      where: and(eq(decisions.projectId, projectId), eq(decisions.id, source.sourceId ?? "")),
    });
    if (!found) {
      throw new CuratorError(
        "VALIDATION",
        operationId,
        `${field}: source decision not found in this project.`,
      );
    }
    // Only confirmed decisions ground knowledge. Accepted recommendations
    // arrive as CONFIRMED (TASK-054); anything weaker stays a proposal.
    if (found.status !== "CONFIRMED") {
      throw new CuratorError(
        "VALIDATION",
        operationId,
        `${field}: source decision "${found.decisionKey}" is ${found.status}, not CONFIRMED.`,
      );
    }
    // A confirmed USER/EXPLICIT decision is a user-stated fact and grounds
    // EXPLICIT knowledge; anything else (e.g. a confirmed recommendation)
    // grounds INFERRED knowledge at most.
    return { userOrigin: found.sourceType === "USER" && found.confidence === "EXPLICIT" };
  }
  const found = await db.query.requirements.findFirst({
    where: and(eq(requirements.projectId, projectId), eq(requirements.id, source.sourceId ?? "")),
  });
  if (!found) {
    throw new CuratorError(
      "VALIDATION",
      operationId,
      `${field}: source requirement not found in this project.`,
    );
  }
  if (found.status === "REMOVED" || found.status === "SUPERSEDED") {
    throw new CuratorError(
      "VALIDATION",
      operationId,
      `${field}: source requirement "${found.requirementCode}" is ${found.status}.`,
    );
  }
  // A CONFIRMED requirement is reviewed canonical state and grounds
  // EXPLICIT knowledge; drafts ground INFERRED knowledge at most.
  return { userOrigin: found.status === "CONFIRMED" };
}

// Full deterministic validation of a curator proposal (acceptance:
// "Application validates proposals"). All-or-nothing: the first invalid
// entry aborts the whole batch before anything persists.
async function validateProposal(
  db: AppDatabase,
  userId: string,
  projectId: string,
  proposal: KnowledgeCuration,
  operationId: string,
): Promise<ValidatedProposal> {
  const fail = (message: string): never => {
    throw new CuratorError("VALIDATION", operationId, message);
  };
  if (userId.trim() === "") throw new CuratorError("VALIDATION", operationId, "Owner is required.");
  const scopeProject = projectId;

  const seen = new Set<string>();
  const claimKey = (key: string, bucket: string): void => {
    if (seen.has(key)) fail(`Knowledge "${key}" appears in multiple proposal buckets (${bucket}).`);
    seen.add(key);
  };

  const validated: ValidatedProposal = { create: [], update: [], supersede: [], sources: [] };

  for (const [index, item] of (proposal.create ?? []).entries()) {
    let key: string;
    let domain: KnowledgeDomain;
    try {
      key = normalizeKnowledgeKey(item.key);
      domain = normalizeKnowledgeDomain(item.domain);
    } catch (error) {
      if (error instanceof KnowledgeValidationError) fail(`create[${index}]: ${error.message}`);
      throw error;
    }
    claimKey(key, "create");
    const title = item.title.trim();
    if (title === "") fail(`create[${index}]: title is required.`);
    if (item.content === undefined) fail(`create[${index}]: content is required.`);
    const confidence = requireConfidence(String(item.confidence), `create[${index}].confidence`);
    const sources = (item.sources ?? []).map((source, i) =>
      checkSourceShape(source, `create[${index}].sources[${i}]`),
    );
    if (sources.length === 0) fail(`create[${index}]: at least one source is required.`);
    let grounded = false;
    for (const [i, source] of sources.entries()) {
      const { userOrigin } = await checkSourceSemantics(
        db,
        scopeProject,
        source,
        `create[${index}].sources[${i}]`,
        operationId,
      );
      if (userOrigin) grounded = true;
    }
    // EXPLICIT knowledge claims user-confirmed grounding; inference alone
    // cannot mint it (provenance honesty, TASK-025).
    if (confidence === "EXPLICIT" && !grounded) {
      fail(
        `create[${index}]: EXPLICIT knowledge requires a user-origin source or CONFIRMED decision.`,
      );
    }
    try {
      await getKnowledgeByKey(db, userId, scopeProject, key);
      fail(`create[${index}]: knowledge "${key}" already exists; use update or supersede.`);
    } catch (error) {
      if (!(error instanceof KnowledgeNotFoundError)) throw error;
    }
    validated.create.push({ key, domain, title, content: item.content, confidence, sources });
  }

  const loadTarget = async (key: string, bucket: string): Promise<KnowledgeItemRow> => {
    let normalized: string;
    try {
      normalized = normalizeKnowledgeKey(key);
    } catch (error) {
      if (error instanceof KnowledgeValidationError) fail(`${bucket}: ${error.message}`);
      throw error;
    }
    try {
      const target = await getKnowledgeByKey(db, userId, scopeProject, normalized);
      if (target.status === "SUPERSEDED") {
        fail(`${bucket}: knowledge "${normalized}" is SUPERSEDED and frozen.`);
      }
      return target;
    } catch (error) {
      if (error instanceof KnowledgeNotFoundError) {
        fail(`${bucket}: knowledge "${normalized}" does not exist.`);
      }
      throw error;
    }
  };

  for (const [index, item] of (proposal.update ?? []).entries()) {
    const target = await loadTarget(item.key, `update[${index}]`);
    claimKey(target.knowledgeKey, "update");
    const confidence =
      item.confidence === undefined
        ? undefined
        : requireConfidence(String(item.confidence), `update[${index}].confidence`);
    // Weaker inference never downgrades confirmed knowledge.
    if (
      confidence !== undefined &&
      CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[target.confidence]
    ) {
      fail(
        `update[${index}]: cannot downgrade "${target.knowledgeKey}" from ${target.confidence} to ${confidence}.`,
      );
    }
    validated.update.push({
      key: target.knowledgeKey,
      target,
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.content !== undefined ? { content: item.content } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    });
  }

  for (const [index, item] of (proposal.supersede ?? []).entries()) {
    const target = await loadTarget(item.key, `supersede[${index}]`);
    claimKey(target.knowledgeKey, "supersede");
    let successorKey: string;
    try {
      successorKey = normalizeKnowledgeKey(item.successorKey);
    } catch (error) {
      if (error instanceof KnowledgeValidationError) fail(`supersede[${index}]: ${error.message}`);
      throw error;
    }
    if (successorKey === target.knowledgeKey) {
      fail(`supersede[${index}]: successor must use a new knowledge key.`);
    }
    let domain: KnowledgeDomain | undefined;
    if (item.domain !== undefined) {
      try {
        domain = normalizeKnowledgeDomain(item.domain);
      } catch (error) {
        if (error instanceof KnowledgeValidationError)
          fail(`supersede[${index}]: ${error.message}`);
        throw error;
      }
    }
    const confidence =
      item.confidence === undefined
        ? undefined
        : requireConfidence(String(item.confidence), `supersede[${index}].confidence`);
    const effectiveConfidence = confidence ?? target.confidence;
    if (CONFIDENCE_RANK[effectiveConfidence] < CONFIDENCE_RANK[target.confidence]) {
      fail(
        `supersede[${index}]: successor cannot be weaker (${effectiveConfidence}) than "${target.knowledgeKey}" (${target.confidence}).`,
      );
    }
    let successor: KnowledgeItemRow | null = null;
    try {
      successor = await getKnowledgeByKey(db, userId, scopeProject, successorKey);
      // Existing successor key routes to merge (duplicate consolidation).
      // Merge requires both CURRENT in the same domain.
      if (successor.status !== "CURRENT") {
        fail(
          `supersede[${index}]: successor "${successorKey}" is ${successor.status}; only CURRENT items merge.`,
        );
      }
      const successorDomain = domain ?? target.domain;
      if (successor.domain !== successorDomain) {
        fail(
          `supersede[${index}]: successor "${successorKey}" is ${successor.domain}, cannot merge ${successorDomain} knowledge.`,
        );
      }
    } catch (error) {
      if (!(error instanceof KnowledgeNotFoundError)) throw error;
    }
    validated.supersede.push({
      key: target.knowledgeKey,
      target,
      successorKey,
      successor,
      ...(domain !== undefined ? { domain } : {}),
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.content !== undefined ? { content: item.content } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    });
  }

  for (const [index, item] of (proposal.sources ?? []).entries()) {
    const target = await loadTarget(item.key, `sources[${index}]`);
    claimKey(target.knowledgeKey, "sources");
    const sources = (item.sources ?? []).map((source, i) =>
      checkSourceShape(source, `sources[${index}].sources[${i}]`),
    );
    if (sources.length === 0) fail(`sources[${index}]: at least one source is required.`);
    for (const [i, source] of sources.entries()) {
      await checkSourceSemantics(
        db,
        scopeProject,
        source,
        `sources[${index}].sources[${i}]`,
        operationId,
      );
    }
    validated.sources.push({ key: target.knowledgeKey, target, sources });
  }

  return validated;
}

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(KNOWLEDGE_CURATION_PROMPT_KEY, KNOWLEDGE_CURATION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...KNOWLEDGE_CURATION_PROMPT });
    } catch (error) {
      registry.resolve(KNOWLEDGE_CURATION_PROMPT_KEY, KNOWLEDGE_CURATION_PROMPT.version);
      void error;
    }
  }
}

function buildTaskInput(existing: KnowledgeItemRow[], focus: DecisionRow[]): string {
  return JSON.stringify({
    existingKnowledge: existing.map((item) => ({
      key: item.knowledgeKey,
      domain: item.domain,
      title: item.title,
      content: item.content,
      confidence: item.confidence,
      status: item.status,
      sourceTypes: item.sources.map((source) => source.sourceType),
    })),
    focusDecisions:
      focus.length === 0
        ? null
        : focus.map((decision) => ({
            key: decision.decisionKey,
            title: decision.title,
            value: decision.value,
            status: decision.status,
            sourceType: decision.sourceType,
            confidence: decision.confidence,
          })),
    canonicalDomains: [
      "PRODUCT",
      "USER",
      "FEATURE",
      "BUSINESS_RULE",
      "ACCESS",
      "DATA",
      "UX",
      "TECHNICAL",
      "INTEGRATION",
      "AI",
      "NON_FUNCTIONAL",
    ],
  });
}

function assertProposalShape(data: unknown): asserts data is KnowledgeCuration {
  const proposal = data as KnowledgeCuration;
  for (const bucket of ["create", "update", "supersede", "sources"] as const) {
    if (!Array.isArray(proposal[bucket])) {
      throw new CuratorError(
        "VALIDATION",
        "pending",
        `Curator proposal bucket "${bucket}" must be an array.`,
      );
    }
  }
}

export async function curateKnowledge(
  db: AppDatabase,
  userId: string,
  projectId: string,
  input: CurateKnowledgeInput = {},
  deps: CurateKnowledgeDeps = {},
): Promise<CurateKnowledgeResult> {
  if (userId.trim() === "") throw new CuratorError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "")
    throw new CuratorError("VALIDATION", "pending", "projectId is required.");

  // Ownership first: cross-user calls fail as NotFound before any AI spend.
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const versionBefore = await getStateVersion(db, userId, pid);

  const focus: DecisionRow[] = [];
  for (const rawKey of input.decisionKeys ?? []) {
    try {
      focus.push(await getDecisionByKey(db, userId, pid, rawKey));
    } catch (error) {
      if (error instanceof DecisionNotFoundError) {
        throw new CuratorError("VALIDATION", "pending", `Focus decision "${rawKey}" not found.`);
      }
      throw error;
    }
  }
  const existing = await listKnowledge(db, userId, pid);

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId: pid,
        capability: CURATION_CAPABILITY,
        operationType: CURATION_OPERATION_TYPE,
        promptKey: KNOWLEDGE_CURATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: buildTaskInput(existing, focus),
        schema: KNOWLEDGE_CURATION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new CuratorError(error.code, error.operationId, error.message);
    }
    throw error;
  }

  try {
    assertProposalShape(orchestrated.data);
    await validateProposal(db, userId, pid, orchestrated.data, orchestrated.operationId);
  } catch (error) {
    if (error instanceof CuratorError) throw error;
    if (error instanceof KnowledgeValidationError) {
      throw new CuratorError("VALIDATION", orchestrated.operationId, error.message);
    }
    throw error;
  }

  const versionAfter = await getStateVersion(db, userId, pid);
  if (versionAfter !== versionBefore) {
    throw new CuratorError(
      "STATE_MUTATED",
      orchestrated.operationId,
      "Knowledge curation must not change canonical project state.",
    );
  }

  return {
    proposal: orchestrated.data as KnowledgeCuration,
    operationId: orchestrated.operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
    stateVersion: versionBefore,
  };
}

export async function applyCuration(
  db: AppDatabase,
  userId: string,
  projectId: string,
  proposal: KnowledgeCuration,
): Promise<AppliedCuration> {
  if (userId.trim() === "") throw new CuratorError("VALIDATION", "local", "Owner is required.");
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const stateVersionBefore = await getStateVersion(db, userId, pid);

  // Re-validate at apply time: proposals may arrive from an earlier state.
  const validated = await validateProposal(db, userId, pid, proposal, "local");

  const result: AppliedCuration = {
    created: [],
    updated: [],
    superseded: [],
    merged: [],
    sourcesAttached: [],
    stateVersionBefore,
    stateVersionAfter: stateVersionBefore,
  };

  for (const item of validated.create) {
    const created = await createKnowledgeItem(db, userId, pid, {
      knowledgeKey: item.key,
      domain: item.domain,
      title: item.title,
      content: item.content,
      confidence: item.confidence,
      sources: item.sources.map((source) => ({
        type: source.sourceType,
        sourceId: source.sourceId,
      })),
    });
    result.created.push(created.knowledgeKey);
  }
  for (const item of validated.update) {
    const updated = await updateKnowledgeItem(db, userId, pid, item.key, {
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.content !== undefined ? { content: item.content } : {}),
      ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
    });
    result.updated.push(updated.knowledgeKey);
  }
  for (const item of validated.supersede) {
    if (item.successor !== null) {
      // Existing successor key: consolidate duplicates via merge. The
      // successor may carry refined content/title from the proposal.
      if (item.title !== undefined || item.content !== undefined || item.confidence !== undefined) {
        await updateKnowledgeItem(db, userId, pid, item.successorKey, {
          ...(item.title !== undefined ? { title: item.title } : {}),
          ...(item.content !== undefined ? { content: item.content } : {}),
          ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
        });
      }
      await mergeKnowledgeItems(db, userId, pid, item.successorKey, item.key);
      result.merged.push({ winner: item.successorKey, loser: item.key });
      continue;
    }
    await supersedeKnowledgeItem(db, userId, pid, item.key, {
      newKey: item.successorKey,
      ...(item.domain !== undefined ? { domain: item.domain } : {}),
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.content !== undefined ? { content: item.content } : {}),
      ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
    });
    result.superseded.push(item.key);
  }
  for (const item of validated.sources) {
    await addKnowledgeSources(
      db,
      userId,
      pid,
      item.key,
      item.sources.map((source) => ({ type: source.sourceType, sourceId: source.sourceId })),
    );
    result.sourcesAttached.push(item.key);
  }

  result.stateVersionAfter = await getStateVersion(db, userId, pid);
  return result;
}
