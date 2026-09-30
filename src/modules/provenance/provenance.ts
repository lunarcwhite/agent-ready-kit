// Provenance model (TASK-025, spec-decisions.md D-A02, database-schema.md §11–§16).
//
// Provenance is DERIVED, not stored: decisions carry canonical
// (source_type, confidence) and this module projects them to the five
// user-visible origins. No migration, no new column — storing provenance
// would let derived state drift from its canonical inputs (AGENTS.md §16–17).
//
// Canonical mapping (tasks.md TASK-025):
//   USER × EXPLICIT            → USER_EXPLICIT
//   USER × INFERRED            → USER_IMPLIED
//   AI_RECOMMENDATION × any    → AI_RECOMMENDED
//   AI_INFERENCE × any         → AI_ASSUMED
//   SYSTEM × any               → SYSTEM_DERIVED
//
// The spec leaves one cell undefined: USER × ASSUMED. It maps to
// USER_IMPLIED — origin stays USER, but ASSUMED confidence can never yield
// USER_EXPLICIT, so an assumption cannot masquerade as an explicit user
// fact (acceptance criterion). Callers needing a strict user fact use
// requireUserExplicit, which rejects everything except USER_EXPLICIT.
//
// soul.md §8 vocabulary mapping:
//   CONFIRMED → USER_EXPLICIT, INFERRED → USER_IMPLIED,
//   ASSUMED → AI_ASSUMED, RECOMMENDED → AI_RECOMMENDED,
//   UNRESOLVED → null (no provenance; decision stays UNRESOLVED).
//
// No DB, no AI, no React — pure deterministic logic (AGENTS.md §23).
import { ProvenanceValidationError } from "./errors";

export const PROVENANCE_TYPES = [
  "USER_EXPLICIT",
  "USER_IMPLIED",
  "AI_RECOMMENDED",
  "AI_ASSUMED",
  "SYSTEM_DERIVED",
] as const;
export type Provenance = (typeof PROVENANCE_TYPES)[number];

// Mirrors decisions.ts enums without importing them: this module must stay
// dependency-light so future knowledge/requirement callers reuse it without
// pulling the decision persistence layer.
export const PROVENANCE_SOURCE_TYPES = [
  "USER",
  "AI_RECOMMENDATION",
  "AI_INFERENCE",
  "SYSTEM",
] as const;
export type ProvenanceSourceType = (typeof PROVENANCE_SOURCE_TYPES)[number];

export const PROVENANCE_CONFIDENCES = ["EXPLICIT", "INFERRED", "ASSUMED"] as const;
export type ProvenanceConfidence = (typeof PROVENANCE_CONFIDENCES)[number];

export const SOUL_VOCABULARY = [
  "CONFIRMED",
  "INFERRED",
  "ASSUMED",
  "RECOMMENDED",
  "UNRESOLVED",
] as const;
export type SoulVocabulary = (typeof SOUL_VOCABULARY)[number];

function requireSourceType(raw: string): ProvenanceSourceType {
  if (!(PROVENANCE_SOURCE_TYPES as readonly string[]).includes(raw)) {
    throw new ProvenanceValidationError(
      `sourceType must be one of ${PROVENANCE_SOURCE_TYPES.join(", ")}.`,
    );
  }
  return raw as ProvenanceSourceType;
}

function requireConfidence(raw: string): ProvenanceConfidence {
  if (!(PROVENANCE_CONFIDENCES as readonly string[]).includes(raw)) {
    throw new ProvenanceValidationError(
      `confidence must be one of ${PROVENANCE_CONFIDENCES.join(", ")}.`,
    );
  }
  return raw as ProvenanceConfidence;
}

// Canonical D-A02 projection. Confidence is decisive only for USER origin;
// AI/SYSTEM origins ignore it (their provenance is fixed by source).
export function resolveProvenance(sourceType: string, confidence: string): Provenance {
  const source = requireSourceType(sourceType);
  const conf = requireConfidence(confidence);
  switch (source) {
    case "USER":
      return conf === "EXPLICIT" ? "USER_EXPLICIT" : "USER_IMPLIED";
    case "AI_RECOMMENDATION":
      return "AI_RECOMMENDED";
    case "AI_INFERENCE":
      return "AI_ASSUMED";
    case "SYSTEM":
      return "SYSTEM_DERIVED";
  }
}

// soul.md §8 display vocabulary → provenance. UNRESOLVED carries no origin
// claim, so it resolves to null instead of a provenance value.
export function resolveSoulProvenance(vocabulary: string): Provenance | null {
  if (!(SOUL_VOCABULARY as readonly string[]).includes(vocabulary)) {
    throw new ProvenanceValidationError(
      `vocabulary must be one of ${SOUL_VOCABULARY.join(", ")}.`,
    );
  }
  switch (vocabulary as SoulVocabulary) {
    case "CONFIRMED":
      return "USER_EXPLICIT";
    case "INFERRED":
      return "USER_IMPLIED";
    case "ASSUMED":
      return "AI_ASSUMED";
    case "RECOMMENDED":
      return "AI_RECOMMENDED";
    case "UNRESOLVED":
      return null;
  }
}

// Attach derived provenance to any canonical object carrying the pair
// (decisions today; knowledge/requirement sources later). The input is
// never mutated — a new object is returned.
export function withProvenance<T extends { sourceType: string; confidence: string }>(
  obj: T,
): T & { provenance: Provenance } {
  return { ...obj, provenance: resolveProvenance(obj.sourceType, obj.confidence) };
}

// Strict user-confirmed state: the only provenance a UI may render as
// "Confirmed by you" (AGENTS.md §61, agents.md §73).
export function isUserExplicit(provenance: string): boolean {
  return provenance === "USER_EXPLICIT";
}

export function isUserOrigin(provenance: string): boolean {
  return provenance === "USER_EXPLICIT" || provenance === "USER_IMPLIED";
}

export function isAiOrigin(provenance: string): boolean {
  return provenance === "AI_RECOMMENDED" || provenance === "AI_ASSUMED";
}

// Guard for flows that must not treat inference as fact: throws unless the
// resolved provenance is USER_EXPLICIT.
export function requireUserExplicit(sourceType: string, confidence: string): void {
  const provenance = resolveProvenance(sourceType, confidence);
  if (provenance !== "USER_EXPLICIT") {
    throw new ProvenanceValidationError(
      `Not a user-explicit fact (resolved to ${provenance}); refusing to treat as confirmed.`,
    );
  }
}

export interface ProvenanceDisplay {
  label: string;
  description: string;
}

// UI-ready wording (TASK-025 acceptance: "Provenance can be displayed in
// the UI"). Labels follow agents.md §73 / AGENTS.md §61 vocabulary so every
// surface renders the same distinction.
const DISPLAY: Record<Provenance, ProvenanceDisplay> = {
  USER_EXPLICIT: {
    label: "Confirmed by you",
    description: "Explicitly stated by the user.",
  },
  USER_IMPLIED: {
    label: "Inferred from you",
    description: "Strongly implied by what the user said.",
  },
  AI_RECOMMENDED: {
    label: "Recommended by AI",
    description: "AI recommendation awaiting user confirmation.",
  },
  AI_ASSUMED: {
    label: "Assumed by AI",
    description: "AI assumption; needs review before it becomes fact.",
  },
  SYSTEM_DERIVED: {
    label: "Derived by system",
    description: "Computed deterministically from canonical state.",
  },
};

export function getProvenanceDisplay(provenance: string): ProvenanceDisplay {
  if (!(PROVENANCE_TYPES as readonly string[]).includes(provenance)) {
    throw new ProvenanceValidationError(
      `provenance must be one of ${PROVENANCE_TYPES.join(", ")}.`,
    );
  }
  return DISPLAY[provenance as Provenance];
}
