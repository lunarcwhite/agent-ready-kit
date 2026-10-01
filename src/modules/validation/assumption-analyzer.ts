// Assumption Analyzer service (TASK-075, agents.md A-021, FR-064).
//
// Finds hidden implementation-relevant unknowns in requirements and
// decisions and persists them as OPEN AI_ASSUMED assumptions (TASK-074).
// Pipeline:
//
//   requirements + decisions → one orchestrated AI call (cost-aware)
//     → cosmetic-area suppression + reference grounding (deterministic)
//     → duplicate normalization against OPEN/DEFERRED rows
//     → createAssumption per surviving finding
//
// AI boundary (AGENT-IMPL-INV-001): the model only proposes. Persistence
// goes through createAssumption, which validates, scopes, and versions.
// A provider failure propagates with no assumption written — approved
// state stays intact (AG-INV-006).
//
// No auto-resolution: unlike deterministic validators, the analyzer never
// resolves existing assumptions when the model stops reporting them. An
// assumption dies only by explicit human Confirm/Reject/Replace
// (AGENTS.md §36) — silent disappearance would violate human authority.
// Reruns only skip duplicates.
//
// Readiness seam (acceptance criterion): impact is stored on every row
// and OPEN assumptions filter by impact, so the readiness engine
// (TASK-080) can gate on critical/high assumptions without re-deriving
// them. Severity mapping is the readiness rule's job, not this module's.
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  ASSUMPTION_DETECTION_PROMPT,
  ASSUMPTION_DETECTION_PROMPT_KEY,
} from "../../ai/prompts/assumption-detection";
import {
  ASSUMPTION_DETECTION_SCHEMA,
  type AssumptionDetection,
  type DetectedAssumption,
} from "../../ai/schemas/assumption-detection";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { requireProjectScope } from "../projects/repository";
import { listDecisions } from "../decisions/decisions";
import { listRequirements } from "../requirements/requirements";
import {
  assumptionDedupeKey,
  createAssumption,
  listAssumptions,
  type AssumptionImpactInput,
} from "./assumptions";
import { AssumptionValidationError } from "./errors";

export const ASSUMPTION_ANALYZER_CAPABILITY = "assumption-detection" as const;
export const ASSUMPTION_ANALYZER_OPERATION_TYPE = "ASSUMPTION_DETECTION";

export class AssumptionAnalyzerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "AssumptionAnalyzerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface DetectAssumptionsDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
}

export interface NormalizedAssumption {
  title: string;
  description: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  dedupeKey: string;
  impacts: AssumptionImpactInput[];
}

export interface DetectionReport {
  findings: NormalizedAssumption[];
  created: string[];
  skippedDuplicates: string[];
  droppedCosmetic: number;
  droppedInvalid: number;
  operationId: string;
  model: string;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
}

// Implementation-relevant areas (agents.md §34). OTHER is the cosmetic
// bucket: findings classified there are suppressed, never persisted.
const IMPLEMENTATION_AREAS = new Set([
  "ARCHITECTURE",
  "DATA_MODEL",
  "SECURITY",
  "BUSINESS_BEHAVIOR",
  "USER_FLOW",
  "IMPLEMENTATION_SCOPE",
  "EXTERNAL_INTEGRATION",
  "COST",
]);

// Context budget (agents.md §49): capped canonical slices with truncated
// text so input cannot grow with project history.
const MAX_REQUIREMENTS = 50;
const MAX_DECISIONS = 50;
const MAX_TEXT_CHARS = 500;

function truncate(text: string): string {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text;
}

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(ASSUMPTION_DETECTION_PROMPT_KEY, ASSUMPTION_DETECTION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...ASSUMPTION_DETECTION_PROMPT });
    } catch (error) {
      registry.resolve(ASSUMPTION_DETECTION_PROMPT_KEY, ASSUMPTION_DETECTION_PROMPT.version);
      void error;
    }
  }
}

function buildTaskInput(
  requirements: {
    code: string;
    title: string;
    priority: string;
    status: string;
    description: string;
  }[],
  decisions: { key: string; title: string; status: string; value: string }[],
): string {
  return JSON.stringify({ requirements, decisions });
}

// Meaning checks the schema cannot express: blank statements and
// cosmetic areas. Returns null for droppable findings — the caller
// counts drops (noise tolerance, agents.md §32).
export function normalizeDetected(
  item: DetectedAssumption,
  requirementIds: ReadonlyMap<string, string>,
  decisionIds: ReadonlyMap<string, string>,
): NormalizedAssumption | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const statement = String(item.statement ?? "").trim();
  if (statement === "") return null;
  if (!IMPLEMENTATION_AREAS.has(String(item.area ?? ""))) return null;
  const suggestedCheck =
    item.suggestedCheck === undefined ? "" : String(item.suggestedCheck).trim();
  if (item.suggestedCheck !== undefined && suggestedCheck === "") return null;

  const impacts: AssumptionImpactInput[] = [];
  const seen = new Set<string>();
  for (const raw of item.requirementCodes ?? []) {
    const id = requirementIds.get(
      String(raw ?? "")
        .trim()
        .toUpperCase(),
    );
    if (!id || seen.has(`REQUIREMENT::${id}`)) continue;
    seen.add(`REQUIREMENT::${id}`);
    impacts.push({ targetType: "REQUIREMENT", targetId: id });
  }
  for (const raw of item.decisionKeys ?? []) {
    const id = decisionIds.get(
      String(raw ?? "")
        .trim()
        .toLowerCase(),
    );
    if (!id || seen.has(`DECISION::${id}`)) continue;
    seen.add(`DECISION::${id}`);
    impacts.push({ targetType: "DECISION", targetId: id });
  }

  const description =
    suggestedCheck === ""
      ? `Assumed without confirmation: ${statement}`
      : `Assumed without confirmation: ${statement}\n\nSuggested check: ${suggestedCheck}`;
  // Title carries the statement (bounded to the column width) so the
  // dedupe key below matches assumptionDedupeKey(row.title) on reruns —
  // write-time and read-time keys must be computed identically.
  const title = statement.length > 255 ? statement.slice(0, 255) : statement;
  return {
    title,
    description,
    impact: item.impact,
    confidence: item.confidence,
    dedupeKey: assumptionDedupeKey(title),
    impacts,
  };
}

export async function detectAssumptions(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: DetectAssumptionsDeps = {},
): Promise<DetectionReport> {
  if (userId.trim() === "") throw new AssumptionValidationError("Owner is required.");
  if (projectId.trim() === "") throw new AssumptionValidationError("projectId is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const pid = scope.projectId;

  const [requirements, decisions] = await Promise.all([
    listRequirements(db, userId, pid),
    listDecisions(db, userId, pid),
  ]);
  const requirementIds = new Map(
    requirements
      .slice(0, MAX_REQUIREMENTS)
      .map((requirement) => [requirement.requirementCode.toUpperCase(), requirement.id]),
  );
  const decisionIds = new Map(
    decisions
      .slice(0, MAX_DECISIONS)
      .map((decision) => [decision.decisionKey.toLowerCase(), decision.id]),
  );
  const taskInput = buildTaskInput(
    requirements.slice(0, MAX_REQUIREMENTS).map((requirement) => ({
      code: requirement.requirementCode,
      title: requirement.title,
      priority: requirement.priority,
      status: requirement.status,
      description: truncate(requirement.description),
    })),
    decisions.slice(0, MAX_DECISIONS).map((decision) => ({
      key: decision.decisionKey,
      title: decision.title,
      status: decision.status,
      value: truncate(JSON.stringify(decision.value ?? null)),
    })),
  );

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId: pid,
        capability: ASSUMPTION_ANALYZER_CAPABILITY,
        operationType: ASSUMPTION_ANALYZER_OPERATION_TYPE,
        promptKey: ASSUMPTION_DETECTION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput,
        schema: ASSUMPTION_DETECTION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new AssumptionAnalyzerError(error.code, error.operationId, error.message);
    }
    throw error;
  }

  const payload = orchestrated.data as AssumptionDetection;
  if (!payload || !Array.isArray(payload.assumptions)) {
    throw new AssumptionAnalyzerError(
      "VALIDATION",
      orchestrated.operationId,
      "Assumption proposal must contain an assumptions array.",
    );
  }

  // Duplicate normalization (acceptance criterion): within-run dedupe plus
  // cross-run skip against live (OPEN/DEFERRED) rows. Live keys reuse
  // assumptionDedupeKey(row.title) — identical to the write-time key above.
  const live = await listAssumptions(db, userId, pid);
  const liveKeys = new Set(
    live
      .filter((row) => row.status === "OPEN" || row.status === "DEFERRED")
      .map((row) => assumptionDedupeKey(row.title)),
  );

  const seen = new Set<string>();
  const findings: NormalizedAssumption[] = [];
  const skippedDuplicates: string[] = [];
  let droppedCosmetic = 0;
  let droppedInvalid = 0;
  for (const item of payload.assumptions) {
    const normalized = normalizeDetected(item, requirementIds, decisionIds);
    if (!normalized) {
      // Cosmetic (OTHER area) vs malformed share the drop path; the area
      // check distinguishes them for observability.
      if (
        typeof item === "object" &&
        item !== null &&
        String((item as DetectedAssumption).statement ?? "").trim() !== "" &&
        !IMPLEMENTATION_AREAS.has(String((item as DetectedAssumption).area ?? ""))
      ) {
        droppedCosmetic += 1;
      } else {
        droppedInvalid += 1;
      }
      continue;
    }
    if (seen.has(normalized.dedupeKey) || liveKeys.has(normalized.dedupeKey)) {
      skippedDuplicates.push(normalized.dedupeKey);
      continue;
    }
    seen.add(normalized.dedupeKey);
    liveKeys.add(normalized.dedupeKey);
    findings.push(normalized);
  }

  const created: string[] = [];
  for (const finding of findings) {
    const row = await createAssumption(db, userId, pid, {
      title: finding.title,
      description: finding.description,
      impact: finding.impact,
      confidence: finding.confidence,
      source: "AI_ASSUMED",
      impacts: finding.impacts,
    });
    created.push(row.assumptionCode);
  }

  return {
    findings,
    created,
    skippedDuplicates,
    droppedCosmetic,
    droppedInvalid,
    operationId: orchestrated.operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
  };
}
