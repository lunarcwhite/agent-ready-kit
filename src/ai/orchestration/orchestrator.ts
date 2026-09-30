// AI orchestrator (TASK-045, agents.md §46–§47).
//
// Coordinates one bounded AI operation end to end:
//   capability → context → prompt → model → execute → validate → record.
//
// Architectural guarantees:
// - NEVER writes canonical business state. The only writes are the
//   operation ledger + payloads (observability). Persisting validated
//   results into decisions/knowledge is the caller's job (TASK-054 reviews).
// - Invalid model output is rejected before anything downstream sees it.
// - Provider failures leave approved state intact (nothing was written).
// - Recovery budget is exactly ONE extra provider call: either a retry of
//   a retryable provider error, or a repair of invalid output — never both,
//   never more. Total provider calls per operation: at most 2.
import type { AppDatabase } from "../../infrastructure/database/db";
import { getStateVersion } from "../../modules/projects/state-version";
import { resolveProviderConfig, type EnvLike } from "../providers/config";
import { ProviderError } from "../providers/errors";
import { getProvider } from "../providers/registry";
import type { AIProvider, CallOptions } from "../providers/types";
import { PromptRegistry, globalPrompts } from "../prompts/registry";
import { finishOperation, saveOperationPayloads, startOperation } from "../operations/ledger";
import { DEFAULT_LIMITS, enforceGuards, GuardrailError, type GuardrailLimits } from "./guardrails";
import { buildFingerprint, globalCache, type MemoryCache } from "./cache";
import { buildRepairPrompt, shouldAttemptRepair } from "../validation/repair";
import type { FieldSchema } from "../validation/schema";
import { validateStructuredOutput } from "../validation/validator";
import type { BuildContextOptions, Capability } from "../context/builder";
import { buildContext } from "../context/builder";
import { OrchestratorError } from "./errors";

export interface OrchestrateInput {
  userId: string;
  projectId: string;
  capability: Capability;
  operationType: string;
  promptKey: string;
  promptVersion?: string;
  model?: string;
  provider?: Parameters<typeof getProvider>[0];
  timeoutMs?: number;
  taskInput: string;
  schema: FieldSchema;
  contextOptions?: BuildContextOptions;
}

export interface OrchestrateResult {
  data: unknown;
  operationId: string;
  model: string;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
}

export interface OrchestratorDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  limits?: Partial<GuardrailLimits>;
  // Result cache (TASK-047). Defaults to the process-wide cache; pass null
  // to disable — deterministic tests always pass null or their own instance.
  cache?: MemoryCache | null;
}

function renderSystemText(parts: {
  role: string;
  objective: string;
  boundaries: string[];
  qualityCriteria: string[];
}): string {
  return [
    `ROLE\n${parts.role}`,
    `OBJECTIVE\n${parts.objective}`,
    `BOUNDARIES\n${parts.boundaries.map((item) => `- ${item}`).join("\n")}`,
    `OUTPUT\nReturn valid JSON only.`,
    `QUALITY CRITERIA\n${parts.qualityCriteria.map((item) => `- ${item}`).join("\n")}`,
  ].join("\n\n");
}

export async function orchestrate(
  db: AppDatabase,
  raw: OrchestrateInput,
  deps: OrchestratorDeps = {},
): Promise<OrchestrateResult> {
  if (raw.userId.trim() === "") {
    throw new OrchestratorError("INVALID_REQUEST", "pending", "Owner is required.");
  }
  const config = resolveProviderConfig(deps.env);
  const provider = deps.provider ?? getProvider(raw.provider ?? config.provider);
  const prompts = deps.prompts ?? globalPrompts;
  const prompt = prompts.resolve(raw.promptKey, raw.promptVersion);
  const model = raw.model ?? config.defaultModel;
  const timeoutMs = raw.timeoutMs ?? config.timeoutMs;

  const context = await buildContext(
    db,
    raw.userId,
    raw.projectId,
    raw.capability,
    raw.contextOptions,
  );
  const stateVersion = await getStateVersion(db, raw.userId, context.projectId);
  const systemText = renderSystemText(prompt);
  const userText = `PROJECT CONTEXT\n${JSON.stringify(context)}\n\nTASK\n${raw.taskInput}`;
  const contextJson = JSON.stringify(context);
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const cache = deps.cache === undefined ? globalCache : deps.cache;
  const fingerprint = cache
    ? buildFingerprint({
        capability: raw.capability,
        userId: raw.userId,
        projectId: context.projectId,
        stateVersion,
        promptKey: prompt.key,
        promptVersion: prompt.version,
        taskInput: raw.taskInput,
        contextJson,
      })
    : null;

  const openOperation = (providerName: string, modelName: string) =>
    startOperation(db, raw.userId, {
      projectId: context.projectId,
      capability: raw.capability,
      operationType: raw.operationType,
      provider: providerName,
      model: modelName,
      promptKey: prompt.key,
      promptVersion: prompt.version,
      projectStateVersion: stateVersion,
    });

  const failOperation = async (
    operationId: string,
    startedAt: number,
    code: string,
    message: string,
  ): Promise<never> => {
    await finishOperation(db, raw.userId, operationId, {
      status: "FAILED",
      errorCode: code,
      errorMessage: message,
      latencyMs: Date.now() - startedAt,
    });
    throw new OrchestratorError(code, operationId, message);
  };

  const runGuards = async (operationId: string, startedAt: number): Promise<void> => {
    try {
      await enforceGuards(
        db,
        raw.userId,
        context.projectId,
        { taskInput: raw.taskInput, contextJson },
        limits,
      );
    } catch (error) {
      if (error instanceof GuardrailError) {
        await saveOperationPayloads(db, raw.userId, operationId, {
          input: { capability: raw.capability, refused: error.code },
        }).catch(() => undefined);
        return failOperation(operationId, startedAt, error.code, error.message);
      }
      throw error;
    }
  };

  // TASK-047 cache fast path: equivalent requests skip provider spend.
  // The hit still opens a ledger row (provider "cache") and passes the
  // same guardrails, so usage stays observable and policy stays uniform.
  if (cache && fingerprint) {
    const hit = cache.get(fingerprint);
    if (hit) {
      const hitStartedAt = Date.now();
      const operation = await openOperation("cache", hit.model);
      await runGuards(operation.id, hitStartedAt);
      await saveOperationPayloads(db, raw.userId, operation.id, {
        input: { system: systemText, user: userText },
        output: { cached: true, fingerprint },
      }).catch(() => undefined);
      const finished = await finishOperation(db, raw.userId, operation.id, {
        status: "SUCCEEDED",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - hitStartedAt,
      });
      return {
        data: hit.data,
        operationId: operation.id,
        model: hit.model,
        promptKey: prompt.key,
        promptVersion: prompt.version,
        repaired: false,
        latencyMs: finished.latencyMs ?? Date.now() - hitStartedAt,
      };
    }
  }

  const operation = await openOperation(provider.name, model);

  const callOptions: CallOptions = { model, timeoutMs };
  const startedAt = Date.now();

  // TASK-046 preflight guardrails: fail-closed and ledger-recorded. The
  // operation row already exists so refusals stay observable; past this
  // point a violation means no provider spend and no canonical writes.
  await runGuards(operation.id, startedAt);

  const fail = async (code: string, message: string): Promise<never> =>
    failOperation(operation.id, startedAt, code, message);

  let recoveryUsed = false;
  let activeUserText = userText;
  for (;;) {
    let rawText: string;
    let usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const result = await provider.generateStructured(
        { system: systemText, user: activeUserText, responseFormat: "json" },
        callOptions,
      );
      rawText = result.rawText;
      usage = result.usage;
    } catch (error) {
      const normalized =
        error instanceof ProviderError ? error : new ProviderError("UNKNOWN", "Provider failure.");
      if (!recoveryUsed && normalized.retryable) {
        recoveryUsed = true;
        continue;
      }
      await saveOperationPayloads(db, raw.userId, operation.id, {
        input: { system: systemText, user: activeUserText },
      }).catch(() => undefined);
      return fail(normalized.code, normalized.message);
    }

    const parsed = safeParse(rawText);
    const validation = validateStructuredOutput(raw.schema, parsed);
    if (validation.ok) {
      // TASK-047: store validated success for equivalent future requests.
      // Keyed on the canonical inputs (not retry artifacts), so a repaired
      // success still serves the original equivalent request later.
      if (cache && fingerprint) cache.set(fingerprint, { data: parsed, model });
      await saveOperationPayloads(db, raw.userId, operation.id, {
        input: { system: systemText, user: userText },
        output: { rawText, repaired: recoveryUsed },
      }).catch(() => undefined);
      const finished = await finishOperation(db, raw.userId, operation.id, {
        status: "SUCCEEDED",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Date.now() - startedAt,
      });
      return {
        data: parsed,
        operationId: operation.id,
        model,
        promptKey: prompt.key,
        promptVersion: prompt.version,
        repaired: recoveryUsed,
        latencyMs: finished.latencyMs ?? Date.now() - startedAt,
      };
    }

    if (!recoveryUsed && shouldAttemptRepair(0, validation.issues)) {
      recoveryUsed = true;
      activeUserText = buildRepairPrompt(rawText, validation.issues);
      continue;
    }
    await saveOperationPayloads(db, raw.userId, operation.id, {
      input: { system: systemText, user: userText },
      output: { rawText, issues: validation.issues },
    }).catch(() => undefined);
    return fail(
      "VALIDATION",
      `Model output failed validation: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
    );
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
