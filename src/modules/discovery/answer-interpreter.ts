// Answer Interpreter service (TASK-053, agents.md A-003).
//
// Translates one natural-language discovery answer into structured
// candidate changes. Translation only: results are returned to the caller
// (stored as conversation evidence with the answer), never written to
// decisions, knowledge, or nodes — validation and application belong to
// TASK-054. Failures propagate with canonical state untouched; the raw
// answer itself is still the caller's to preserve as evidence.
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  ANSWER_INTERPRETATION_PROMPT,
  ANSWER_INTERPRETATION_PROMPT_KEY,
} from "../../ai/prompts/answer-interpretation";
import {
  ANSWER_INTERPRETATION_SCHEMA,
  type AnswerInterpretation,
} from "../../ai/schemas/answer-interpretation";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { getDiscoveryNode } from "./discovery";
import { DiscoveryValidationError } from "./errors";

export const INTERPRETER_CAPABILITY = "answer-extraction" as const;
export const INTERPRETER_OPERATION_TYPE = "ANSWER_EXTRACTION";

export class InterpreterError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "InterpreterError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface InterpretAnswerInput {
  answer: string;
  nodeKey?: string;
  sessionId?: string;
}

export interface InterpretAnswerDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
}

export interface InterpretAnswerResult {
  interpretation: AnswerInterpretation;
  operationId: string;
  model: string;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
}

// Same dot-notation vocabulary as the Decision registry (decisions.ts
// KEY_PATTERN): interpretation keys must match so TASK-054 can resolve
// them, and anything else is rejected rather than trusted.
const DECISION_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const MAX_ANSWER_LENGTH = 20000;

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(ANSWER_INTERPRETATION_PROMPT_KEY, ANSWER_INTERPRETATION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...ANSWER_INTERPRETATION_PROMPT });
    } catch (error) {
      registry.resolve(ANSWER_INTERPRETATION_PROMPT_KEY, ANSWER_INTERPRETATION_PROMPT.version);
      void error;
    }
  }
}

// Service-level guards behind the schema: identifier shape, blank text the
// length-based schema cannot see, and the EXPLICIT/INFERRED/assumption
// separation. Pure, so representative answers unit-test without a database.
export function assertInterpretationBusinessRules(
  data: unknown,
): asserts data is AnswerInterpretation {
  const result = data as AnswerInterpretation;
  for (const decision of result.decisions ?? []) {
    if (!DECISION_KEY_PATTERN.test(decision.key)) {
      throw new InterpreterError(
        "VALIDATION",
        "pending",
        `Decision key "${decision.key}" must be lowercase dot-notation.`,
      );
    }
    if (decision.confidence !== "EXPLICIT" && decision.confidence !== "INFERRED") {
      throw new InterpreterError(
        "VALIDATION",
        "pending",
        `Decision "${decision.key}" must be EXPLICIT or INFERRED, never assumed.`,
      );
    }
    if (decision.rationale !== undefined && decision.rationale.trim() === "") {
      throw new InterpreterError(
        "VALIDATION",
        "pending",
        `Decision "${decision.key}" rationale must not be blank.`,
      );
    }
    try {
      JSON.stringify(decision.value ?? null);
    } catch {
      throw new InterpreterError(
        "VALIDATION",
        "pending",
        `Decision "${decision.key}" value must be JSON-serializable.`,
      );
    }
  }
  for (const assumption of result.assumptions ?? []) {
    if (assumption.statement.trim() === "") {
      throw new InterpreterError(
        "VALIDATION",
        "pending",
        "Assumption statements must not be blank.",
      );
    }
  }
}

export async function interpretAnswer(
  db: AppDatabase,
  userId: string,
  projectId: string,
  input: InterpretAnswerInput,
  deps: InterpretAnswerDeps = {},
): Promise<InterpretAnswerResult> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  if (projectId.trim() === "") throw new DiscoveryValidationError("projectId is required.");
  const answer = input.answer.trim();
  if (answer === "") throw new DiscoveryValidationError("answer is required.");
  if (answer.length > MAX_ANSWER_LENGTH) {
    throw new DiscoveryValidationError(`answer must be at most ${MAX_ANSWER_LENGTH} characters.`);
  }
  const nodeKey = input.nodeKey?.trim() || undefined;
  // Topic verification only: the interpreter extracts for the given topic
  // without judging or reordering discovery state (that is TASK-054's job).
  if (nodeKey !== undefined) await getDiscoveryNode(db, userId, projectId, nodeKey);

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId,
        capability: INTERPRETER_CAPABILITY,
        operationType: INTERPRETER_OPERATION_TYPE,
        promptKey: ANSWER_INTERPRETATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: JSON.stringify({ answer, nodeKey: nodeKey ?? null }),
        schema: ANSWER_INTERPRETATION_SCHEMA,
        contextOptions: {
          nodeKey,
          sessionId: input.sessionId,
        },
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new InterpreterError(error.code, error.operationId, error.message);
    }
    throw error;
  }

  try {
    assertInterpretationBusinessRules(orchestrated.data);
  } catch (error) {
    if (error instanceof InterpreterError) {
      throw new InterpreterError(error.code, orchestrated.operationId, error.message);
    }
    throw error;
  }

  return {
    interpretation: orchestrated.data as AnswerInterpretation,
    operationId: orchestrated.operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
  };
}
