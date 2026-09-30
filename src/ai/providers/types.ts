// Provider-neutral AI interfaces (TASK-040, architecture.md §19).
//
// Domain and orchestration code program against THESE types — never against
// a provider SDK. Adding a vendor later means writing one adapter behind
// AIProvider, not rewriting product logic. No imports from provider SDKs
// may appear outside src/ai/providers adapters.
export type ProviderName = "fake" | "openai" | "anthropic" | "google";

export interface ModelSelection {
  provider: ProviderName;
  model: string;
}

export interface CallOptions {
  // Per-operation overrides (agents.md §54 model routing): cheap rewrites
  // take the small model, architecture reasoning takes the large one.
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface StructuredPrompt {
  system: string;
  user: string;
  // Transport-level contract only: the provider must return JSON text.
  // Semantic schema validation is TASK-042's job, not the wire's.
  responseFormat: "json";
  jsonSchemaName?: string;
}

export interface TextPrompt {
  system: string;
  user: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResult {
  data: unknown;
  rawText: string;
  model: ModelSelection;
  usage: TokenUsage;
  latencyMs: number;
}

export interface TextResult {
  text: string;
  model: ModelSelection;
  usage: TokenUsage;
  latencyMs: number;
}

export interface AIProvider {
  readonly name: ProviderName;
  generateStructured(prompt: StructuredPrompt, options?: CallOptions): Promise<StructuredResult>;
  generateText(prompt: TextPrompt, options?: CallOptions): Promise<TextResult>;
}
