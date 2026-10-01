// Deterministic completeness validator (TASK-071, FR-060).
//
// Finds missing required structured information with application rules
// only — no AI, no model intuition. Same canonical state always yields the
// same findings, so results are reproducible and cheap to re-run.
//
// Reconciliation (acceptance criteria) keys every finding by stable
// (rule, target) identity in issue metadata:
//
// - reruns never duplicate: an OPEN or IGNORED issue for a live finding is
//   left alone;
// - fixed findings auto-resolve: an OPEN issue with no live finding resolves
//   with resolution metadata (IGNORED issues are human decisions and are
//   never auto-touched; RESOLVED rows are frozen history);
// - regressions reopen: a live finding whose issue was RESOLVED moves back
//   to OPEN instead of minting a second issue.
//
// Severity calibration (documented, not tuned per project): an unverifiable
// MUST requirement is a BLOCKER because IMPLEMENTATION_READY requires
// verifiable requirements; SHOULD gaps and unresolved HIGH-impact decisions
// are HIGH; everything else here is MEDIUM or below. Ordinary polish is
// never a blocker.
//
// Known limit: findings on entities carry no issue reference row — the
// TASK-070 reference vocabulary has no ENTITY type. The ENT code rides in
// the title/description/metadata until the vocabulary grows.
import type { AppDatabase } from "../../infrastructure/database/db";
import { listDecisions } from "../decisions/decisions";
import { listEntityDetails } from "../entities/entities";
import { listRequirements } from "../requirements/requirements";
import { requireProjectScope } from "../projects/repository";
import { type IssueReferenceInput, type IssueSeverity } from "./issues";
import { IssueValidationError } from "./errors";
import { reconcileFindings } from "./reconcile";

export const COMPLETENESS_VALIDATOR = "completeness-v1" as const;

export type CompletenessTargetType = "DECISION" | "REQUIREMENT" | "ENTITY";

export interface CompletenessFinding {
  rule: string;
  targetType: CompletenessTargetType;
  targetId: string;
  targetKey: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  references: IssueReferenceInput[];
}

export interface CompletenessReport {
  findings: CompletenessFinding[];
  created: string[];
  reopened: string[];
  resolved: string[];
  unchangedOpen: string[];
}

const UNRESOLVED_SEVERITY: Record<string, IssueSeverity> = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

function affectedDecision(id: string): IssueReferenceInput[] {
  return [{ referenceType: "DECISION", referenceId: id, relationship: "AFFECTED" }];
}

function affectedRequirement(id: string): IssueReferenceInput[] {
  return [{ referenceType: "REQUIREMENT", referenceId: id, relationship: "AFFECTED" }];
}

// Pure read pass: evaluate every rule against current canonical rows.
// Sorted by (rule, target) so output order is deterministic.
export async function collectCompletenessFindings(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<CompletenessFinding[]> {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const pid = scope.projectId;
  const findings: CompletenessFinding[] = [];

  const decisions = await listDecisions(db, userId, pid);
  for (const decision of decisions) {
    if (decision.status === "UNRESOLVED") {
      findings.push({
        rule: "decision-unresolved",
        targetType: "DECISION",
        targetId: decision.id,
        targetKey: decision.decisionKey,
        title: `Unresolved decision: ${decision.decisionCode}`,
        description: `"${decision.title}" (${decision.decisionCode}) is UNRESOLVED with ${decision.impact} impact. Resolve, defer, or mark it not applicable.`,
        severity: UNRESOLVED_SEVERITY[decision.impact] ?? "MEDIUM",
        references: affectedDecision(decision.id),
      });
    } else if (decision.status === "CONFIRMED" && decision.value === null) {
      findings.push({
        rule: "decision-confirmed-without-value",
        targetType: "DECISION",
        targetId: decision.id,
        targetKey: decision.decisionKey,
        title: `Confirmed decision has no value: ${decision.decisionCode}`,
        description: `"${decision.title}" (${decision.decisionCode}) is CONFIRMED but stores no value. Set the decided value or move it out of CONFIRMED.`,
        severity: "MEDIUM",
        references: affectedDecision(decision.id),
      });
    }
  }

  const requirements = await listRequirements(db, userId, pid);
  for (const requirement of requirements) {
    if (
      (requirement.status === "DRAFT" || requirement.status === "CONFIRMED") &&
      (requirement.priority === "MUST" || requirement.priority === "SHOULD")
    ) {
      const criteria = requirement.acceptanceCriteria ?? [];
      if (criteria.filter((criterion) => criterion.trim() !== "").length === 0) {
        findings.push({
          rule: "requirement-missing-acceptance",
          targetType: "REQUIREMENT",
          targetId: requirement.id,
          targetKey: requirement.requirementCode,
          title: `${requirement.priority} requirement has no acceptance criteria: ${requirement.requirementCode}`,
          description: `"${requirement.title}" (${requirement.requirementCode}) is ${requirement.priority} with no acceptance criteria, so a coding agent cannot verify it. Add criteria or lower its priority.`,
          severity: requirement.priority === "MUST" ? "BLOCKER" : "HIGH",
          references: affectedRequirement(requirement.id),
        });
      }
    }
  }

  const { entities } = await listEntityDetails(db, userId, pid);
  for (const entity of entities) {
    if (
      (entity.status === "DRAFT" || entity.status === "CONFIRMED") &&
      entity.attributes.length === 0
    ) {
      findings.push({
        rule: "entity-without-attributes",
        targetType: "ENTITY",
        targetId: entity.id,
        targetKey: entity.entityCode,
        title: `Entity has no attributes: ${entity.entityCode}`,
        description: `"${entity.name}" (${entity.entityCode}) defines no attributes, so persistence cannot be generated from it. Add attributes or defer the entity.`,
        severity: "MEDIUM",
        references: [],
      });
    }
  }

  findings.sort((a, b) =>
    a.rule === b.rule ? a.targetKey.localeCompare(b.targetKey) : a.rule.localeCompare(b.rule),
  );
  return findings;
}

export async function runCompletenessValidation(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<CompletenessReport> {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const findings = await collectCompletenessFindings(db, userId, scope.projectId);
  const reconciled = await reconcileFindings(
    db,
    userId,
    scope.projectId,
    COMPLETENESS_VALIDATOR,
    "COMPLETENESS",
    findings,
  );
  return { findings, ...reconciled };
}
