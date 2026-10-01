// Readiness rule registry (TASK-080, FR-080/FR-081/FR-082, AGENTS.md §42–§43).
//
// Data, not code (same posture as COVERAGE_RULES): which validator
// findings feed which readiness dimension, which severities block, and how
// much each criterion weighs. The engine (TASK-081) interprets this
// registry — the registry itself never touches a database and never calls
// AI, so readiness stays deterministic and explainable ("why not ready?"
// is answered by listing violated criteria, never by a model score).
//
// Entry granularity is the validator finding `rule` key, optionally scoped
// by requirement type. When several entries match one finding, the
// requirementType-scoped entry wins; unscoped entries are the default.
// Findings no entry matches are untracked by dimensions (the engine may
// surface them as unclassified — that fallback belongs to TASK-081).
//
// Weight scale (documented for the engine):
// - 3: FR-082 gating conditions — violated at a blocking severity, the
//   project cannot be IMPLEMENTATION_READY.
// - 2: structural soundness — degrades the dimension, never gates alone.
// - 1: hygiene — tracked, informational.
//
// Blocking rule: only severities listed in blockingSeverities gate. Today
// that is BLOCKER (FR-082 "no blocking validation issues remain"), plus
// HIGH for graph cycles and unresolved HIGH-impact decisions, which break
// derivation and product logic too fundamentally to degrade quietly.
//
// Assumption seam (anticipated by TASK-075): assumptions carry impact, not
// severity — READINESS_ASSUMPTION_GATE maps impact to severity and names
// the blocking impacts, so the engine gates on OPEN critical assumptions
// without re-deriving them.
//
// SECURITY has no automated producer in MVP (no validator emits SECURITY
// findings yet): its criterion is an explicit human-attested gate that
// never auto-blocks, rather than a fabricated rule.
import type { IssueSeverity } from "../validation/issues";
import { ReadinessValidationError } from "./errors";

export const READINESS_RULES_VERSION = "1.0";

export const READINESS_DIMENSIONS = [
  "PRODUCT",
  "FEATURES",
  "BUSINESS_RULES",
  "DATA",
  "UX",
  "ARCHITECTURE",
  "SECURITY",
  "EXECUTION",
] as const;
export type ReadinessDimension = (typeof READINESS_DIMENSIONS)[number];

export type ReadinessWeight = 1 | 2 | 3;

export interface DimensionCriterion {
  /** Stable key for tracking and explanation. */
  key: string;
  dimension: ReadinessDimension;
  /** Validator finding `rule` keys feeding this criterion. */
  rules: string[];
  /** Optional requirement-type scope; scoped entries win over unscoped. */
  requirementType?: string;
  /** Explicit criterion text (AC: every dimension has explicit criteria). */
  criteria: string;
  /** Severities that gate readiness when violated (AC: explicit blocking). */
  blockingSeverities: IssueSeverity[];
  /** Documented influence (see weight scale above). */
  weight: ReadinessWeight;
}

export type AssumptionImpact = "HIGH" | "MEDIUM" | "LOW";

export interface AssumptionGate {
  /** OPEN assumptions at these impacts block readiness (FR-082). */
  blockingImpacts: AssumptionImpact[];
  /** Impact → severity mapping owned by this registry (TASK-075 seam). */
  severityMap: Record<AssumptionImpact, IssueSeverity>;
}

export const READINESS_ASSUMPTION_GATE: AssumptionGate = {
  blockingImpacts: ["HIGH"],
  severityMap: { HIGH: "BLOCKER", MEDIUM: "HIGH", LOW: "MEDIUM" },
};

export const READINESS_CRITERIA: DimensionCriterion[] = [
  {
    key: "product.decisions-resolved",
    dimension: "PRODUCT",
    rules: ["decision-unresolved"],
    criteria: "No HIGH-impact decision stays UNRESOLVED.",
    blockingSeverities: ["HIGH", "BLOCKER"],
    weight: 3,
  },
  {
    key: "product.decision-hygiene",
    dimension: "PRODUCT",
    rules: ["decision-confirmed-without-value"],
    criteria: "CONFIRMED decisions carry a decided value.",
    blockingSeverities: [],
    weight: 1,
  },
  {
    key: "product.decision-graph",
    dimension: "PRODUCT",
    rules: [
      "decision-dep-self",
      "decision-dep-broken-endpoint",
      "decision-dep-invalid-condition",
      "decision-dep-duplicate",
    ],
    criteria: "Decision dependencies resolve to live decisions.",
    blockingSeverities: [],
    weight: 2,
  },
  {
    key: "product.decision-acyclic",
    dimension: "PRODUCT",
    rules: ["decision-dep-cycle"],
    criteria: "Decision dependencies contain no cycles.",
    blockingSeverities: ["HIGH"],
    weight: 2,
  },
  {
    key: "features.acceptance-defined",
    dimension: "FEATURES",
    rules: ["requirement-missing-acceptance"],
    criteria: "MUST/SHOULD requirements carry acceptance criteria a coding agent can verify.",
    blockingSeverities: ["BLOCKER"],
    weight: 3,
  },
  {
    key: "business-rules.covered",
    dimension: "BUSINESS_RULES",
    rules: ["coverage:fr:architecture"],
    requirementType: "BUSINESS_RULE",
    criteria: "Every live business rule maps to an architecture component.",
    blockingSeverities: ["BLOCKER"],
    weight: 3,
  },
  {
    key: "business-rules.acceptance-defined",
    dimension: "BUSINESS_RULES",
    rules: ["requirement-missing-acceptance"],
    requirementType: "BUSINESS_RULE",
    criteria: "Business rules carry acceptance criteria a coding agent can verify.",
    blockingSeverities: ["BLOCKER"],
    weight: 3,
  },
  {
    key: "data.entity-shape",
    dimension: "DATA",
    rules: ["entity-without-attributes"],
    criteria: "Live entities define attributes persistence can be generated from.",
    blockingSeverities: [],
    weight: 2,
  },
  {
    key: "data.covered",
    dimension: "DATA",
    rules: ["coverage:fr:data"],
    criteria: "Requirements touching data map to live entities.",
    blockingSeverities: ["BLOCKER"],
    weight: 2,
  },
  {
    key: "ux.covered",
    dimension: "UX",
    rules: ["coverage:fr:design"],
    criteria: "Requirements with UI surface map to live screens.",
    blockingSeverities: ["BLOCKER"],
    weight: 2,
  },
  {
    key: "architecture.covered",
    dimension: "ARCHITECTURE",
    rules: ["coverage:fr:architecture"],
    criteria: "Behavior and rules live in some system component.",
    blockingSeverities: ["BLOCKER"],
    weight: 2,
  },
  {
    key: "architecture.consistent",
    dimension: "ARCHITECTURE",
    rules: ["semantic-contradiction"],
    criteria: "Specifications do not contradict each other.",
    blockingSeverities: ["BLOCKER"],
    weight: 2,
  },
  {
    key: "architecture.references-intact",
    dimension: "ARCHITECTURE",
    rules: ["traceability-broken-endpoint", "section-dep-broken-source", "issue-ref-broken"],
    criteria: "Traceability, section dependencies, and issue references resolve.",
    blockingSeverities: [],
    weight: 2,
  },
  {
    key: "security.human-attested",
    dimension: "SECURITY",
    rules: [],
    criteria:
      "Security is human-attested: no automated producer feeds this dimension in MVP, so it never auto-blocks.",
    blockingSeverities: [],
    weight: 1,
  },
  {
    key: "execution.task-coverage",
    dimension: "EXECUTION",
    rules: ["coverage:fr:task"],
    criteria: "Core requirements have implementing tasks (FR-082).",
    blockingSeverities: ["BLOCKER"],
    weight: 3,
  },
  {
    key: "execution.task-graph",
    dimension: "EXECUTION",
    rules: ["task-dep-self", "task-dep-broken-endpoint"],
    criteria: "Task dependencies resolve to live tasks.",
    blockingSeverities: [],
    weight: 2,
  },
  {
    key: "execution.task-acyclic",
    dimension: "EXECUTION",
    rules: ["task-dep-cycle"],
    criteria: "Task dependencies contain no cycles.",
    blockingSeverities: ["HIGH"],
    weight: 2,
  },
];

const DIMENSIONS = new Set<string>(READINESS_DIMENSIONS);

export function criteriaForDimension(dimension: string): DimensionCriterion[] {
  if (!DIMENSIONS.has(dimension)) {
    throw new ReadinessValidationError(
      `dimension must be one of ${READINESS_DIMENSIONS.join(", ")}.`,
    );
  }
  return READINESS_CRITERIA.filter((criterion) => criterion.dimension === dimension);
}

export function assumptionSeverityForImpact(impact: string): IssueSeverity {
  const severity = READINESS_ASSUMPTION_GATE.severityMap[impact as AssumptionImpact];
  if (severity === undefined) {
    throw new ReadinessValidationError("assumption impact must be one of HIGH, MEDIUM, LOW.");
  }
  return severity;
}

export function isAssumptionBlocking(impact: string): boolean {
  return (READINESS_ASSUMPTION_GATE.blockingImpacts as readonly string[]).includes(impact);
}
