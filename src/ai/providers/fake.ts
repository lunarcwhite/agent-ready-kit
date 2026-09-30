// Deterministic fake provider (TASK-040).
//
// Scripted responses with zero network: tests, local development, and CI
// exercise orchestration boundaries without live vendors, credentials, or
// cost (AGENTS.md §74). Supports scripted delays (timeout tests), scripted
// failures (retry tests), and call recording (assertion tests).
import { ProviderError, toProviderError } from "./errors";
import type {
  AIProvider,
  CallOptions,
  ProviderName,
  StructuredPrompt,
  StructuredResult,
  TextPrompt,
  TextResult,
  TokenUsage,
} from "./types";

export type FakeScript =
  | { kind: "structured"; json: string; usage?: Partial<TokenUsage> }
  | { kind: "text"; text: string; usage?: Partial<TokenUsage> }
  | { kind: "fail"; code: "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "UNKNOWN"; message?: string }
  | { kind: "delay"; delayMs: number; then: FakeScript };

export interface FakeCall {
  method: "generateStructured" | "generateText";
  model: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeProvider implements AIProvider {
  readonly name: ProviderName = "fake";
  readonly calls: FakeCall[] = [];
  private readonly scripts: FakeScript[];

  constructor(scripts: FakeScript[] = []) {
    this.scripts = [...scripts];
  }

  private nextScript(): FakeScript {
    return (
      this.scripts.shift() ?? {
        kind: "text" as const,
        text: "",
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    );
  }

  private async runScript(
    script: FakeScript,
    method: FakeCall["method"],
    model: string,
    timeoutMs: number,
  ): Promise<{ text: string; usage: TokenUsage; latencyMs: number }> {
    this.calls.push({ method, model, timeoutMs });
    const startedAt = Date.now();
    const work = (async () => {
      let current = script;
      for (;;) {
        if (current.kind === "delay") {
          await delay(current.delayMs);
          current = current.then;
          continue;
        }
        if (current.kind === "fail") {
          throw new ProviderError(current.code, current.message ?? `Fake ${current.code}.`);
        }
        const usage: TokenUsage = {
          inputTokens: current.usage?.inputTokens ?? 0,
          outputTokens: current.usage?.outputTokens ?? 0,
        };
        const text = current.kind === "structured" ? current.json : current.text;
        return { text, usage, latencyMs: Date.now() - startedAt };
      }
    })();
    try {
      return await withTimeout(work, timeoutMs);
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async generateStructured(
    prompt: StructuredPrompt,
    options: CallOptions = {},
  ): Promise<StructuredResult> {
    void prompt;
    const model = options.model ?? "fake-1";
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { text, usage, latencyMs } = await this.runScript(
      this.nextScript(),
      "generateStructured",
      model,
      timeoutMs,
    );
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // Retrying an identical call cannot fix malformed output — the repair
      // path (TASK-042) owns recovery, so this is not retryable.
      throw new ProviderError("INVALID_RESPONSE", "Provider did not return valid JSON.");
    }
    return { data, rawText: text, model: { provider: "fake", model }, usage, latencyMs };
  }

  async generateText(prompt: TextPrompt, options: CallOptions = {}): Promise<TextResult> {
    void prompt;
    const model = options.model ?? "fake-1";
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { text, usage, latencyMs } = await this.runScript(
      this.nextScript(),
      "generateText",
      model,
      timeoutMs,
    );
    return { text, model: { provider: "fake", model }, usage, latencyMs };
  }
}
