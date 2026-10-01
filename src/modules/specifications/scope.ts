// Incremental regeneration scope (TASK-069, architecture.md §25–§26, §46).
//
// A scope is the set of section keys one incremental run may rewrite.
// null means full regeneration (initial compile); a list means only those
// keys. The doc-global unknowns bucket is always writable — it collects
// open questions, not versioned content. Normalization is shared so every
// compiler enforces the same shape; compilers map violations to their own
// error type at their entry point.
import { SpecificationValidationError } from "./errors";

const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const MAX_KEY_LENGTH = 128;

export function normalizeSectionScope(raw: string[] | undefined): string[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SpecificationValidationError(
      "onlySectionKeys must be a non-empty array when provided.",
    );
  }
  const seen = new Set<string>();
  for (const entry of raw) {
    const key = String(entry ?? "")
      .trim()
      .toLowerCase();
    if (key.length === 0 || key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) {
      throw new SpecificationValidationError(
        `onlySectionKeys: "${entry}" is not a valid section key.`,
      );
    }
    seen.add(key);
  }
  return [...seen].sort();
}

// Post-validation gate: the model proposal may only contain in-scope keys.
// Runs after full reference validation but before any section write, so an
// out-of-scope proposal aborts the batch with canonical state untouched.
export function assertSectionsInScope(
  keys: string[],
  scope: string[] | null,
  fail: (message: string) => never,
): void {
  if (scope === null) return;
  for (const key of keys) {
    if (!scope.includes(key)) {
      fail(`"${key}" is outside the regeneration scope and must not be rewritten.`);
    }
  }
}
