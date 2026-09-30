// Normalized AI provider errors (TASK-040, agents.md §57).
//
// Every failure crossing the provider boundary becomes a ProviderError with
// a stable machine-readable code and a retryable flag for the orchestrator's
// bounded retry policy (TASK-045). Messages are human-readable but never
// carry secrets: API keys are stripped before any error is constructed.
export const PROVIDER_ERROR_CODES = [
  "TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_REQUEST",
  "INVALID_RESPONSE",
  "AUTHENTICATION",
  "CONFIGURATION",
  "UNKNOWN",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const RETRYABLE_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  "TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
]);

function stripSecrets(message: string): string {
  // Belt-and-braces: provider SDKs occasionally echo credentials in error
  // text. Keys stay server-side (config.ts), and this pass ensures a leak
  // can never ride an error into logs or UI.
  return message.replace(/(sk-[A-Za-z0-9-_]{4})[A-Za-z0-9-_]+/g, "$1…redacted");
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: ProviderErrorCode, message: string) {
    super(stripSecrets(message));
    this.name = "ProviderError";
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new ProviderError("TIMEOUT", "The provider request timed out.");
    }
    return new ProviderError("UNKNOWN", `Provider failure: ${error.message}`);
  }
  return new ProviderError("UNKNOWN", "Provider failure with no details.");
}
