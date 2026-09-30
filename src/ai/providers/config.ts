// Server-only provider configuration (TASK-040).
//
// Reads AI_PROVIDER / AI_API_KEY / AI_DEFAULT_MODEL / AI_TIMEOUT_MS from the
// server environment. This module must never be imported by client
// components: keys have no NEXT_PUBLIC_ prefix and config accessors never
// return the key itself — only whether one is configured. Future live
// adapters read the key through readApiKey() at call time so it never lands
// in logs, results, or AI context.
import { ProviderError } from "./errors";
import type { ProviderName } from "./types";

export interface ProviderConfig {
  provider: ProviderName;
  defaultModel: string;
  timeoutMs: number;
  hasApiKey: boolean;
}

const PROVIDERS: ReadonlySet<string> = new Set(["fake", "openai", "anthropic", "google"]);

const DEFAULT_MODELS: Record<ProviderName, string> = {
  fake: "fake-1",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  google: "gemini-2.0-flash",
};

const DEFAULT_TIMEOUT_MS = 30_000;

function parseTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ProviderError("CONFIGURATION", "AI_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
}

export type EnvLike = Record<string, string | undefined>;

export function resolveProviderConfig(env: EnvLike = process.env): ProviderConfig {
  const requested = (env.AI_PROVIDER ?? "fake").trim().toLowerCase();
  if (!PROVIDERS.has(requested)) {
    throw new ProviderError(
      "CONFIGURATION",
      `AI_PROVIDER must be one of ${[...PROVIDERS].join(", ")}.`,
    );
  }
  const provider = requested as ProviderName;
  const defaultModel = (env.AI_DEFAULT_MODEL ?? "").trim() || DEFAULT_MODELS[provider];
  return {
    provider,
    defaultModel,
    timeoutMs: parseTimeoutMs(env.AI_TIMEOUT_MS),
    hasApiKey: (env.AI_API_KEY ?? "").trim() !== "",
  };
}

// Server-only key access for future live adapters. Never log, return, or
// embed the result outside the outbound provider request.
export function readApiKey(env: EnvLike = process.env): string {
  const key = (env.AI_API_KEY ?? "").trim();
  if (key === "") {
    throw new ProviderError("CONFIGURATION", "AI_API_KEY is not configured.");
  }
  return key;
}
