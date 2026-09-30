// Discovery Interviewer service (TASK-052, agents.md A-002, soul §17).
//
// Generates the next user-facing question for the topic the application
// selected via deterministic prioritization (TASK-032). The topic arrives
// as an argument — this service never lists, ranks, or reorders the
// Discovery Map. Like the Idea Analyst it is proposal-only: no decisions,
// no knowledge, no node updates, no version bump. Failures propagate with
// canonical state untouched and the conversation evidence intact.
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  DISCOVERY_QUESTION_PROMPT,
  DISCOVERY_QUESTION_PROMPT_KEY,
} from "../../ai/prompts/discovery-question";
import {
  DISCOVERY_QUESTION_SCHEMA,
  type DiscoveryQuestion,
} from "../../ai/schemas/discovery-question";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { getDiscoveryNode } from "./discovery";
import { DiscoveryValidationError } from "./errors";

export const INTERVIEWER_CAPABILITY = "discovery-question" as const;
export const INTERVIEWER_OPERATION_TYPE = "DISCOVERY_QUESTION";

export class InterviewerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "InterviewerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface GenerateQuestionDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
}

export interface GenerateQuestionResult {
  question: DiscoveryQuestion;
  operationId: string;
  model: string;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
  nodeKey: string;
}

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(DISCOVERY_QUESTION_PROMPT_KEY, DISCOVERY_QUESTION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...DISCOVERY_QUESTION_PROMPT });
    } catch (error) {
      registry.resolve(DISCOVERY_QUESTION_PROMPT_KEY, DISCOVERY_QUESTION_PROMPT.version);
      void error;
    }
  }
}

// Defense in depth behind the schema (which is length-based, like every
// other TASK-042 contract — trimming lives at the domain layer, e.g.
// decisions requireTitle). Rejects whitespace-only text the schema cannot
// see, and requires a recommendation to resolve to one of the offered
// options — otherwise the UI could render a "recommended" choice the user
// can never select. Pure, so it unit-tests without a database.
export function assertQuestionBusinessRules(data: unknown): asserts data is DiscoveryQuestion {
  const result = data as DiscoveryQuestion;
  if (result.question.trim() === "") {
    throw new InterviewerError("VALIDATION", "pending", "Question must not be blank.");
  }
  for (const option of result.options ?? []) {
    if (option.label.trim() === "") {
      throw new InterviewerError("VALIDATION", "pending", "Option labels must not be blank.");
    }
  }
  const recommendation = result.recommendation;
  if (recommendation === undefined) return;
  if (recommendation.rationale.trim() === "") {
    throw new InterviewerError("VALIDATION", "pending", "Recommendation needs its rationale.");
  }
  const offered = new Set(result.options.map((option) => option.label.trim()));
  if (!offered.has(recommendation.optionLabel.trim())) {
    throw new InterviewerError(
      "VALIDATION",
      "pending",
      `Recommendation "${recommendation.optionLabel}" must match one of the offered options.`,
    );
  }
}

export async function generateDiscoveryQuestion(
  db: AppDatabase,
  userId: string,
  projectId: string,
  nodeKey: string,
  deps: GenerateQuestionDeps = {},
): Promise<GenerateQuestionResult> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  if (projectId.trim() === "") throw new DiscoveryValidationError("projectId is required.");
  if (nodeKey.trim() === "") throw new DiscoveryValidationError("nodeKey is required.");

  // The application selected this topic: verify it exists and still needs
  // attention. Resolved or not-applicable topics are never re-asked.
  const node = await getDiscoveryNode(db, userId, projectId, nodeKey);
  if (node.status === "RESOLVED" || node.status === "NOT_APPLICABLE") {
    throw new DiscoveryValidationError(`Topic "${node.nodeKey}" is already ${node.status}.`);
  }

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId,
        capability: INTERVIEWER_CAPABILITY,
        operationType: INTERVIEWER_OPERATION_TYPE,
        promptKey: DISCOVERY_QUESTION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: JSON.stringify({
          nodeKey: node.nodeKey,
          title: node.title,
          description: node.description,
        }),
        schema: DISCOVERY_QUESTION_SCHEMA,
        contextOptions: { nodeKey: node.nodeKey },
      },
      { provider: deps.provider, prompts, env: deps.env },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new InterviewerError(error.code, error.operationId, error.message);
    }
    throw error;
  }

  try {
    assertQuestionBusinessRules(orchestrated.data);
  } catch (error) {
    if (error instanceof InterviewerError) {
      throw new InterviewerError(error.code, orchestrated.operationId, error.message);
    }
    throw error;
  }

  return {
    question: orchestrated.data as DiscoveryQuestion,
    operationId: orchestrated.operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
    nodeKey: node.nodeKey,
  };
}
