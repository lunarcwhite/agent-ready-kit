// Deterministic stable identifiers (TASK-004).
//
// Pure module: no database, no LLM, no I/O. Formatting and validation live
// here so every domain module produces identical codes; persistence-backed
// atomic allocation lives in `src/infrastructure/database/identifiers.ts`.
//
// Code contract (tasks.md TASK-004, database-schema.md §68-70):
// - unique inside the project namespace (counter is per project);
// - stable when ordering changes (codes are stored, never recomputed);
// - never array-index or LLM derived (monotonic per-counter sequences);
// - never reused after removal (counters only move forward).

export type IdentifierFamily = "DEC" | "FR" | "ENT" | "ARC" | "SCREEN" | "TASK" | "ISSUE" | "ASM" | "UTASK";

export class IdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentifierError";
  }
}

const FAMILIES: readonly IdentifierFamily[] = [
  "DEC",
  "FR",
  "ENT",
  "ARC",
  "SCREEN",
  "TASK",
  "ISSUE",
  "ASM",
  // TASK-090 (spec-decisions.md D-A10b): user-project tasks use UTASK-001…
  // so the implementation-plan TASK-xxx namespace stays unambiguous.
  // The generic FAMILY-NNN path in format/buildCounter/parse already covers
  // this family — no logic change needed beyond registration.
  "UTASK",
];

// Category infix for DEC codes (e.g. AUTH in DEC-AUTH-001). Caller-supplied —
// the mapping from decision_key to category (authentication.required → AUTH)
// belongs to the Decision domain (TASK-021); this module only normalizes and
// validates the shape.
const CATEGORY_PATTERN = /^[A-Z0-9]{2,8}$/;
const SEQUENCE_PATTERN = /^\d{3,}$/;

export function normalizeCategory(category: string): string {
  const normalized = category.trim().toUpperCase();
  if (!CATEGORY_PATTERN.test(normalized)) {
    throw new IdentifierError(
      `Invalid identifier category ${JSON.stringify(category)}: expected 2-8 uppercase alphanumerics.`,
    );
  }
  return normalized;
}

function assertFamily(family: string): asserts family is IdentifierFamily {
  if (!(FAMILIES as readonly string[]).includes(family)) {
    throw new IdentifierError(
      `Unknown identifier family ${JSON.stringify(family)}: expected one of ${FAMILIES.join(", ")}.`,
    );
  }
}

function assertSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new IdentifierError(
      `Invalid identifier sequence ${JSON.stringify(sequence)}: expected a positive integer.`,
    );
  }
}

// Counter scope in project_counters: one row per family, or per
// family+category for DEC (DEC-AUTH and DEC-USER advance independently).
export function buildCounterType(family: IdentifierFamily, category?: string): string {
  assertFamily(family);
  if (family === "DEC") {
    if (category === undefined) {
      throw new IdentifierError("DEC identifiers require a category (e.g. DEC-AUTH-001).");
    }
    return `DEC-${normalizeCategory(category)}`;
  }
  if (category !== undefined) {
    throw new IdentifierError(`Family ${family} does not use a category infix.`);
  }
  return family;
}

// Deterministic formatting: same (family, sequence[, category]) always yields
// the same code. Sequences pad to 3 digits and grow unbounded (TASK-1000),
// so sorting stays lexicographic and no code is ever truncated.
export function formatStableId(
  family: IdentifierFamily,
  sequence: number,
  category?: string,
): string {
  assertFamily(family);
  assertSequence(sequence);
  const padded = String(sequence).padStart(3, "0");
  if (family === "DEC") {
    if (category === undefined) {
      throw new IdentifierError("DEC identifiers require a category (e.g. DEC-AUTH-001).");
    }
    return `DEC-${normalizeCategory(category)}-${padded}`;
  }
  if (category !== undefined) {
    throw new IdentifierError(`Family ${family} does not use a category infix.`);
  }
  return `${family}-${padded}`;
}

export interface ParsedStableId {
  family: IdentifierFamily;
  category?: string;
  sequence: number;
  counterType: string;
}

// Strict validation for codes read back from storage or AI output.
// Returns null (instead of throwing) so callers can reject unknown input
// without try/catch; canonical codes are always uppercase and zero-padded.
export function parseStableId(code: string): ParsedStableId | null {
  const match = /^([A-Z]+)(?:-([A-Z0-9]+))?-(\d+)$/.exec(code);
  if (!match) return null;
  const [, familyPart = "", middle = "", sequencePart = ""] = match;
  if (!SEQUENCE_PATTERN.test(sequencePart)) return null;
  const sequence = Number(sequencePart);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;

  if (familyPart === "DEC") {
    if (!CATEGORY_PATTERN.test(middle)) return null;
    return { family: "DEC", category: middle, sequence, counterType: `DEC-${middle}` };
  }
  if (!(FAMILIES as readonly string[]).includes(familyPart) || middle !== "") return null;
  return { family: familyPart as IdentifierFamily, sequence, counterType: familyPart };
}

export function assertValidStableId(code: string): ParsedStableId {
  const parsed = parseStableId(code);
  if (!parsed) throw new IdentifierError(`Invalid stable identifier ${JSON.stringify(code)}.`);
  return parsed;
}
