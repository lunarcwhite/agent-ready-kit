// Readiness engine (TASK-081, FR-080/FR-081/FR-082, AGENTS.md §42).
//
// Deterministic calculation over open validation issues (TASK-070/071/
// 072/076/094), semantic findings (TASK-073), and open assumptions
// (TASK-074/075), interpreted through the rule registry (TASK-080). No AI,
// no writes — same canonical state always yields the same report, so
// "why is this project not ready?" is answered by listing violated
// criteria, never by a model score.
//
// Scoring (MVP calibration, documented for tuning):
// - Per dimension, every violated criterion deducts weight × 10 points
//   from 100 (a criterion is violated when ≥1 OPEN finding matches it).
//   Scores floor at 0. The deduction list IS the explanation.
// - Overall score is the floored mean of the eight dimension scores.
// - IMPLEMENTATION_READY eligibility ("ready") requires zero blocking
//   violations (finding severity ∈ criterion.blockingSeverities) AND zero
//   open assumptions at the configured critical impacts (default HIGH,
//   FR-082 "critical assumptions are resolved").
//
// Finding→criterion matching: a finding matches an entry when its rule is
// listed and, for requirementType-scoped entries, at least one referenced
// REQUIREMENT has that type (resolved via the requirements table).
// Dimensions score independently, so one finding may degrade two
// dimensions — an arch gap in a business rule hurts both.
//
// The engine never persists: lifecycle transitions and score storage
// belong to TASK-082.
import type { AppDatabase } from "../../infrastructure/database/db";
import { listRequirements } from "../requirements/requirements";
import { listAssumptions, type AssumptionRow } from "../validation/assumptions";
import { listIssues, type IssueRow } from "../validation/issues";
import { requireProjectScope } from "../projects/repository";
import {
  assumptionSeverityForImpact,
  criteriaForDimension,
  READINESS_ASSUMPTION_GATE,
  READINESS_DIMENSIONS,
  type AssumptionImpact,
  type ReadinessDimension,
} from "./rules";
import { ReadinessValidationError } from "./errors";

export interface ReadinessDeduction {
  criterionKey: string;
  dimension: ReadinessDimension;
  rules: string[];
  openIssueCount: number;
  deduction: number;
  blocking: boolean;
}

export interface DimensionScore {
  dimension: ReadinessDimension;
  score: number;
  deductions: ReadinessDeduction[];
  blocking: boolean;
}

export interface ReadinessBlocker {
  kind: "criterion" | "assumption";
  dimension: ReadinessDimension | null;
  key: string;
  title: string;
  severity: string;
}

export interface ReadinessReport {
  dimensions: DimensionScore[];
  overallScore: number;
  ready: boolean;
  blockers: ReadinessBlocker[];
  openIssueCount: number;
  openAssumptionCount: number;
}

export interface CalculateReadinessOptions {
  /** Assumption impacts that gate readiness (default: HIGH). */
  criticalAssumptionImpacts?: AssumptionImpact[];
}

const DEDUCTION_PER_WEIGHT = 10;

function requireOwner(userId: string): void {
  if (userId.trim() === "") throw new ReadinessValidationError("Owner is required.");
}

function normalizeImpacts(raw: AssumptionImpact[] | undefined): AssumptionImpact[] {
  const impacts = raw ?? READINESS_ASSUMPTION_GATE.blockingImpacts;
  for (const impact of impacts) {
    assumptionSeverityForImpact(impact);
  }
  return [...impacts].sort();
}

// Requirement-type scope for scoped criteria: map referenced requirement
// ids to their types once, then test membership per finding.
async function loadRequirementTypes(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<Map<string, string>> {
  const requirements = await listRequirements(db, userId, projectId);
  return new Map(requirements.map((requirement) => [requirement.id, requirement.type]));
}

function findingRequirementTypes(finding: IssueRow, typesById: Map<string, string>): Set<string> {
  const types = new Set<string>();
  for (const reference of finding.references) {
    if (reference.referenceType !== "REQUIREMENT") continue;
    const type = typesById.get(reference.referenceId);
    if (type !== undefined) types.add(type);
  }
  return types;
}

// Validators key findings by stable (validator, rule, targetKey) in issue
// metadata (reconcile.ts). Manually created issues may carry no rule and
// stay untracked by dimensions — the documented fallback.
function findingRule(finding: IssueRow): string | null {
  const metadata = finding.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const rule = (metadata as Record<string, unknown>)["rule"];
  return typeof rule === "string" && rule !== "" ? rule : null;
}

export async function calculateReadiness(
  db: AppDatabase,
  userId: string,
  projectId: string,
  options: CalculateReadinessOptions = {},
): Promise<ReadinessReport> {
  requireOwner(userId);
  const scope = await requireProjectScope(db, userId, projectId);
  const pid = scope.projectId;
  const criticalImpacts = normalizeImpacts(options.criticalAssumptionImpacts);

  const [issues, assumptions, typesById] = await Promise.all([
    listIssues(db, userId, pid, { status: "OPEN" }),
    listAssumptions(db, userId, pid, { status: "OPEN" }),
    loadRequirementTypes(db, userId, pid),
  ]);

  const dimensions: DimensionScore[] = [];
  const blockers: ReadinessBlocker[] = [];

  for (const dimension of READINESS_DIMENSIONS) {
    const deductions: ReadinessDeduction[] = [];
    let blocking = false;
    for (const criterion of criteriaForDimension(dimension)) {
      const matching = issues.filter((finding) => {
        const rule = findingRule(finding);
        if (rule === null || !criterion.rules.includes(rule)) return false;
        if (criterion.requirementType === undefined) return true;
        return findingRequirementTypes(finding, typesById).has(criterion.requirementType);
      });
      if (matching.length === 0) continue;
      const isBlocking = matching.some((finding) =>
        (criterion.blockingSeverities as readonly string[]).includes(finding.severity),
      );
      if (isBlocking) blocking = true;
      deductions.push({
        criterionKey: criterion.key,
        dimension,
        rules: [...criterion.rules].sort(),
        openIssueCount: matching.length,
        deduction: criterion.weight * DEDUCTION_PER_WEIGHT,
        blocking: isBlocking,
      });
      if (isBlocking) {
        const first = matching
          .filter((finding) =>
            (criterion.blockingSeverities as readonly string[]).includes(finding.severity),
          )
          .sort((a, b) => a.issueCode.localeCompare(b.issueCode))[0]!;
        blockers.push({
          kind: "criterion",
          dimension,
          key: criterion.key,
          title: `${criterion.key}: ${first.issueCode} (${matching.length} open)`,
          severity: first.severity,
        });
      }
    }
    deductions.sort((a, b) => a.criterionKey.localeCompare(b.criterionKey));
    const score = Math.max(
      0,
      100 - deductions.reduce((total, deduction) => total + deduction.deduction, 0),
    );
    dimensions.push({ dimension, score, deductions, blocking });
  }

  const openAssumptions: AssumptionRow[] = assumptions.filter((assumption) =>
    (criticalImpacts as readonly string[]).includes(assumption.impact),
  );
  for (const assumption of openAssumptions
    .slice()
    .sort((a, b) => a.assumptionCode.localeCompare(b.assumptionCode))) {
    blockers.push({
      kind: "assumption",
      dimension: null,
      key: assumption.assumptionCode,
      title: `${assumption.assumptionCode}: ${assumption.title}`,
      severity: assumptionSeverityForImpact(assumption.impact),
    });
  }

  blockers.sort((a, b) => a.key.localeCompare(b.key) || a.title.localeCompare(b.title));
  const overallScore = Math.floor(
    dimensions.reduce((total, dimension) => total + dimension.score, 0) / dimensions.length,
  );
  return {
    dimensions,
    overallScore,
    ready: blockers.length === 0,
    blockers,
    openIssueCount: issues.length,
    openAssumptionCount: assumptions.length,
  };
}
