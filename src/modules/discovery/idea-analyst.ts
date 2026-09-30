// Idea Analyst domain service (TASK-050, FR-002, agents.md A-001).
//
// Analyzes the initial project idea after creation (TASK-013) via the AI
// orchestrator (TASK-045). Proposal-only by construction:
//
// - Reads project input (idea, target users, constraints, references) plus
//   the context builder's `idea-analysis` projection — nothing else.
// - Calls the orchestrator with the versioned `discovery.idea-analysis`
//   prompt and the strict idea-analysis schema (TASK-042).
// - Returns the validated analysis + operation trace. It NEVER writes
//   decisions, knowledge, discovery nodes, or specifications, NEVER bumps
//   the project state version, and NEVER confirms anything.
//
// Failure contract (AGENTS.md §27, §57): provider errors, validation
// failures, and authorization failures propagate with the project row
// untouched — creation stays intact, approved state stays valid, retry is
// safe and idempotent (no canonical writes means no duplicates).
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import { IDEA_ANALYSIS_PROMPT, IDEA_ANALYSIS_PROMPT_KEY } from "../../ai/prompts/idea-analysis";
import { IDEA_ANALYSIS_SCHEMA, type IdeaAnalysis } from "../../ai/schemas/idea-analysis";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { DiscoveryValidationError } from "./errors";

export const IDEA_ANALYSIS_CAPABILITY = "idea-analysis" as const;
export const IDEA_ANALYSIS_OPERATION_TYPE = "IDEA_ANALYSIS";

export class IdeaAnalysisError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "IdeaAnalysisError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface AnalyzeIdeaDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
}

export interface AnalyzeIdeaResult {
  analysis: IdeaAnalysis;
  operationId: string;
  model: string;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
  stateVersion: number;
}

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(IDEA_ANALYSIS_PROMPT_KEY, IDEA_ANALYSIS_PROMPT.version);
  } catch {
    try {
      registry.register({ ...IDEA_ANALYSIS_PROMPT });
    } catch (error) {
      // Concurrent caller registered first — resolve must now succeed.
      registry.resolve(IDEA_ANALYSIS_PROMPT_KEY, IDEA_ANALYSIS_PROMPT.version);
      void error;
    }
  }
}

function buildTaskInput(detail: Awaited<ReturnType<typeof getProject>>): string {
  const settings =
    detail.settings.settings !== null && typeof detail.settings.settings === "object"
      ? (detail.settings.settings as Record<string, unknown>)
      : {};
  return JSON.stringify({
    name: detail.project.name,
    idea: detail.input.idea,
    targetUsers: detail.input.targetUsers,
    constraints: detail.input.constraints,
    references: detail.input.references,
    preferredStack: settings.preferred_stack ?? null,
  });
}

// Runtime shape guard after orchestrator schema validation: the schema
// already enforces confidence ∈ {EXPLICIT, INFERRED}, but a defense-in-depth
// check here keeps a future schema relaxation from silently promoting an
// assumption into a candidate decision.
function assertNoConfirmedDecisions(data: unknown): asserts data is IdeaAnalysis {
  const analysis = data as IdeaAnalysis;
  for (const decision of analysis.candidateDecisions ?? []) {
    if (decision.confidence !== "EXPLICIT" && decision.confidence !== "INFERRED") {
      throw new IdeaAnalysisError(
        "VALIDATION",
        "pending",
        `Candidate decision "${decision.key}" must be EXPLICIT or INFERRED, never assumed or confirmed.`,
      );
    }
  }
}

export async function analyzeIdea(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: AnalyzeIdeaDeps = {},
): Promise<AnalyzeIdeaResult> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  if (projectId.trim() === "") throw new DiscoveryValidationError("projectId is required.");

  // Ownership + existence first: cross-user calls fail as NotFound before
  // any AI spend, and failure never touches the project row.
  const detail = await getProject(db, userId, projectId);
  const versionBefore = await getStateVersion(db, userId, detail.project.id);

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId: detail.project.id,
        capability: IDEA_ANALYSIS_CAPABILITY,
        operationType: IDEA_ANALYSIS_OPERATION_TYPE,
        promptKey: IDEA_ANALYSIS_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: buildTaskInput(detail),
        schema: IDEA_ANALYSIS_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new IdeaAnalysisError(error.code, error.operationId, error.message);
    }
    throw error;
  }

  try {
    assertNoConfirmedDecisions(orchestrated.data);
  } catch (error) {
    if (error instanceof IdeaAnalysisError) {
      throw new IdeaAnalysisError(error.code, orchestrated.operationId, error.message);
    }
    throw error;
  }

  // Read-only guarantee: ledger writes are observability, not canonical
  // state. If a future refactor accidentally bumps the version here, fail
  // loudly instead of hiding the regression.
  const versionAfter = await getStateVersion(db, userId, detail.project.id);
  if (versionAfter !== versionBefore) {
    throw new IdeaAnalysisError(
      "STATE_MUTATED",
      orchestrated.operationId,
      "Idea analysis must not change canonical project state.",
    );
  }

  return {
    analysis: orchestrated.data as IdeaAnalysis,
    operationId: orchestrated.operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
    stateVersion: versionBefore,
  };
}
