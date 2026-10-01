// Candidate Change Review & Application (TASK-054, FR-020–022).
//
// Applies TASK-053 Answer Interpreter output to canonical decisions.
// Two-phase and conservative by design:
//
// 1. Validate ALL candidates before persisting ANY: a malformed batch
//    applies nothing, so one bad key cannot leave a half-applied answer.
// 2. Apply each decision in its own atomic transaction (createDecision /
//    updateDecision own their history, dependency cascade, and version
//    bump per TASK-021/022/020).
//
// Confirmation policy (human authority, soul §9):
// - EXPLICIT (user stated it) → CONFIRMED, origin USER/EXPLICIT.
// - INFERRED (strongly implied) → RECOMMENDED, origin
//   AI_RECOMMENDATION/INFERRED — a proposal awaiting confirmation, never
//   auto-confirmed, whatever its impact.
// - INFERRED never downgrades CONFIRMED, DEFERRED, or NOT_APPLICABLE: a
//   weaker inference cannot overwrite a stronger existing state.
// - EXPLICIT always confirms: an explicit user statement is authoritative,
//   including upgrades from RECOMMENDED with source correction.
//
// Assumptions and unresolved topics are deferred, not dropped:
// assumptions persist into the assumption inventory (TASK-074) as OPEN
// USER_IMPLIED rows, and this module still never launders one into a
// decision. Unresolved topics are counted for the caller to route.
import type { AppDatabase } from "../../infrastructure/database/db";
import type { AnswerInterpretation } from "../../ai/schemas/answer-interpretation";
import { assertInterpretationBusinessRules } from "./answer-interpreter";
import {
  createDecision,
  getDecisionByKey,
  updateDecision,
  type DecisionImpact,
  type DecisionRow,
} from "../decisions/decisions";
import { DecisionNotFoundError, DecisionValidationError } from "../decisions/errors";
import { requireProjectScope } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { assumptionDedupeKey, createAssumption, listAssumptions } from "../validation/assumptions";
import { withProvenance, type Provenance } from "../provenance/provenance";
import { DiscoveryValidationError } from "./errors";

export type CandidateAction = "created" | "updated" | "unchanged";

export interface AppliedCandidate {
  decisionKey: string;
  decisionCode: string;
  status: string;
  action: CandidateAction;
  provenance: Provenance;
}

export interface ApplyInterpretationResult {
  applied: AppliedCandidate[];
  assumptionsDeferred: number;
  assumptionsPersisted: string[];
  unresolvedDeferred: number;
  stateVersionBefore: number;
  stateVersionAfter: number;
}

// Category infix for stable DEC codes (TASK-004: 2–8 uppercase
// alphanumerics). Known decision-key prefixes map to established infixes;
// anything else falls back to the cleaned prefix truncated to 8 chars and
// padded to 2 — deterministic, never LLM-derived, covered by unit tests.
const CATEGORY_BY_PREFIX: Record<string, string> = {
  authentication: "AUTH",
  access: "ACCESS",
  user: "USER",
  users: "USER",
  multi_user: "USER",
  account: "USER",
  role: "ROLE",
  permission: "PERM",
  payment: "BILL",
  billing: "BILL",
  subscription: "BILL",
  invoice: "BILL",
  storage: "DATA",
  data: "DATA",
  collaboration: "COLLAB",
  product: "PRODUCT",
  feature: "FEATURE",
  technical: "TECH",
  integration: "INT",
  ux: "UX",
  ai: "AI",
};

export function deriveDecisionCategory(decisionKey: string): string {
  const prefix = decisionKey.split(".")[0] ?? "";
  const known = CATEGORY_BY_PREFIX[prefix];
  if (known !== undefined) return known;
  const cleaned = prefix
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return cleaned.padEnd(2, "X");
}

// Human-readable title derived deterministically from the key.
// MVP display text — owners can rename in the Decision Center (TASK-058).
export function humanizeDecisionTitle(decisionKey: string): string {
  const words = decisionKey.replace(/_/g, " ").split(".").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Impact triage grounded in soul.md §16 high-impact areas. Never LOW:
// machine-applied impact must not understate, and impact never gates
// readiness by itself (database-schema.md §13).
const HIGH_IMPACT_PREFIXES = new Set([
  "authentication",
  "payment",
  "billing",
  "subscription",
  "role",
  "permission",
  "multi_user",
  "collaboration",
  "storage",
  "account",
  "integration",
  "deployment",
]);

export function classifyDecisionImpact(decisionKey: string): DecisionImpact {
  const prefix = decisionKey.split(".")[0] ?? "";
  return HIGH_IMPACT_PREFIXES.has(prefix) ? "HIGH" : "MEDIUM";
}

function toApplied(row: DecisionRow, action: CandidateAction): AppliedCandidate {
  return {
    decisionKey: row.decisionKey,
    decisionCode: row.decisionCode,
    status: row.status,
    action,
    provenance: withProvenance({ sourceType: row.sourceType, confidence: row.confidence })
      .provenance,
  };
}

// Parses the `applied` query parameter back into decision codes (TASK-057).
// Pure: empty, blank, and malformed entries drop out, survivors are upper-
// trimmed codes the summary loader resolves against persisted decisions —
// so the UI can only ever show what is actually stored, never what was
// merely attempted.
export function parseAppliedCodes(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const code = part.trim().toUpperCase();
    if (code === "" || code.length > 32) continue;
    seen.add(code);
  }
  return [...seen];
}

export async function applyInterpretation(
  db: AppDatabase,
  userId: string,
  projectId: string,
  interpretation: AnswerInterpretation,
): Promise<ApplyInterpretationResult> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  if (projectId.trim() === "") throw new DiscoveryValidationError("projectId is required.");
  // Phase 1 — validate everything before persisting anything.
  assertInterpretationBusinessRules(interpretation);
  const scope = await requireProjectScope(db, userId, projectId);
  const stateVersionBefore = await getStateVersion(db, userId, scope.projectId);

  // Phase 2 — apply each candidate atomically via the Decision domain,
  // which owns history, dependency cascades, and version bumps.
  const applied: AppliedCandidate[] = [];
  for (const candidate of interpretation.decisions) {
    const value = candidate.value === undefined ? null : candidate.value;
    const rationale = candidate.rationale ?? null;
    const impact = classifyDecisionImpact(candidate.key);
    let existing: DecisionRow | null = null;
    try {
      existing = await getDecisionByKey(db, userId, scope.projectId, candidate.key);
    } catch (error) {
      if (!(error instanceof DecisionNotFoundError)) throw error;
    }
    if (existing === null) {
      const created = await createDecision(db, userId, scope.projectId, {
        decisionKey: candidate.key,
        category: deriveDecisionCategory(candidate.key),
        title: humanizeDecisionTitle(candidate.key),
        status: candidate.confidence === "EXPLICIT" ? "CONFIRMED" : "RECOMMENDED",
        impact,
        sourceType: candidate.confidence === "EXPLICIT" ? "USER" : "AI_RECOMMENDATION",
        confidence: candidate.confidence,
        value,
        rationale,
      });
      applied.push(toApplied(created, "created"));
      continue;
    }
    if (candidate.confidence === "EXPLICIT") {
      const updated = await updateDecision(db, userId, scope.projectId, candidate.key, {
        value,
        rationale,
        status: "CONFIRMED",
        impact,
        sourceType: "USER",
        confidence: "EXPLICIT",
        changeReason: "Discovery answer explicitly stated this decision.",
      });
      applied.push(toApplied(updated, "updated"));
      continue;
    }
    // INFERRED over an UNRESOLVED or RECOMMENDED decision becomes (or stays)
    // a recommendation; over anything stronger it is dropped to protect the
    // existing state from weaker inference.
    if (existing.status === "UNRESOLVED" || existing.status === "RECOMMENDED") {
      const updated = await updateDecision(db, userId, scope.projectId, candidate.key, {
        value,
        rationale,
        status: "RECOMMENDED",
        impact,
        sourceType: "AI_RECOMMENDATION",
        confidence: "INFERRED",
        changeReason: "Discovery answer implied this decision.",
      });
      applied.push(toApplied(updated, "updated"));
      continue;
    }
    applied.push(toApplied(existing, "unchanged"));
  }

  if (applied.length === 0 && interpretation.decisions.length > 0) {
    throw new DecisionValidationError("No candidate decisions could be applied.");
  }

  // Phase 3 — persist interpreted assumptions into the inventory
  // (TASK-074) instead of dropping them. Each assumption derives from the
  // user's own answer, so origin is USER_IMPLIED; the interpreter carries
  // no strength signal, so confidence defaults to MEDIUM (documented, not
  // model-derived). Dedupe by stable key against live rows so re-applying
  // the same answer never mints duplicates. Like decisions above, each
  // persists in its own transaction with its own version bump — a failure
  // propagates with earlier rows kept, never half-written.
  const assumptionsPersisted: string[] = [];
  if (interpretation.assumptions.length > 0) {
    const live = await listAssumptions(db, userId, scope.projectId);
    const liveKeys = new Set(
      live
        .filter((row) => row.status === "OPEN" || row.status === "DEFERRED")
        .map((row) => assumptionDedupeKey(row.title)),
    );
    for (const assumption of interpretation.assumptions) {
      const title =
        assumption.statement.length > 255
          ? assumption.statement.slice(0, 255)
          : assumption.statement;
      const key = assumptionDedupeKey(title);
      if (liveKeys.has(key)) continue;
      liveKeys.add(key);
      const row = await createAssumption(db, userId, scope.projectId, {
        title,
        description: assumption.statement,
        impact: assumption.impact,
        confidence: "MEDIUM",
        source: "USER_IMPLIED",
      });
      assumptionsPersisted.push(row.assumptionCode);
    }
  }

  return {
    applied,
    assumptionsDeferred: interpretation.assumptions.length,
    assumptionsPersisted,
    unresolvedDeferred: interpretation.unresolved.length,
    stateVersionBefore,
    stateVersionAfter: await getStateVersion(db, userId, scope.projectId),
  };
}
