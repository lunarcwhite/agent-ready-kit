// Basic change impact service (TASK-113, FR-090/FR-091, agents.md §36).
//
// When a confirmed decision changes, callers need the KNOWN downstream
// effects before anything is rewritten. This module is the deterministic
// half of agents.md §36 ("Dependency Graph + Semantic Impact Analyzer →
// Impact Report"): it reads only established dependency records —
// traceability links (TASK-024), section dependencies (TASK-061),
// knowledge sources, and task requirement references — and returns them as
// one sorted report. Semantic (AI) impact reasoning arrives with TASK-143
// (A-022) and complements this graph, never replaces it.
//
// Two operations, deliberately split (FR-091 "Impact Preview"):
//
// - previewDecisionChangeImpact: read-only. Never writes, never bumps the
//   project state version. Safe to call freely before any propagation.
// - propagateDecisionChangeImpact: marks exactly the dependent sections
//   STALE via markStaleDependents (TASK-061 semantics — affected sections
//   flip, the rest stay CURRENT). For HIGH-impact decisions it refuses to
//   run until the caller passes acknowledgeHighImpact: true, i.e. the
//   interface itself enforces "user sees impact before high-impact change
//   propagation" instead of trusting call order.
//
// Scope notes (documented interpretations of the brief):
// - "High-impact" maps to the decision's own impact level (HIGH), the only
//   deterministic impact vocabulary the model owns. MEDIUM/LOW decisions
//   propagate without acknowledgment.
// - Withdrawn history is not impact: SUPERSEDED/REMOVED requirements and
//   SUPERSEDED knowledge are excluded (same "frozen history" posture as
//   the TASK-076 coverage validator).
// - Second-hop expansion is deterministic: sections depending on affected
//   requirements count as affected, because a decision change reaches them
//   through the requirement it invalidates.
// - Knowledge appears in the preview (FR-090 names "project knowledge")
//   but propagation never auto-mutates it — knowledge staleness belongs to
//   the curator workflow, not to section propagation.
import type { AppDatabase } from "../../infrastructure/database/db";
import { getDecisionByKey, type DecisionRow } from "../decisions/decisions";
import { listKnowledge } from "../knowledge/knowledge";
import { listRequirements } from "../requirements/requirements";
import { getSection, type SpecificationSectionStatus } from "../specifications/documents";
import { listSectionsDependingOn, markStaleDependents } from "../specifications/dependencies";
import { listUserTasks } from "../tasks/user-tasks";
import { listProjectLinks } from "../traceability/traceability";
import { ChangeImpactValidationError } from "./errors";

export interface ImpactedDecision {
  id: string;
  decisionCode: string;
  decisionKey: string;
  title: string;
  status: string;
  impact: string;
  version: number;
}

export interface ImpactedRequirement {
  id: string;
  requirementCode: string;
  title: string;
  status: string;
}

export interface ImpactedSection {
  documentType: string;
  sectionKey: string;
  status: SpecificationSectionStatus;
}

export interface ImpactedTask {
  taskCode: string;
  title: string;
  status: string;
}

export interface ImpactedKnowledge {
  knowledgeKey: string;
  title: string;
  status: string;
}

export interface DecisionChangeImpact {
  decision: ImpactedDecision;
  /** Knowledge items whose DECISION sources cite this decision. Preview only. */
  affectedKnowledge: ImpactedKnowledge[];
  /** Live requirements linked to this decision in either link direction. */
  affectedRequirements: ImpactedRequirement[];
  /** Sections depending on the decision or on an affected requirement. */
  affectedSections: ImpactedSection[];
  /** Tasks whose requirement references intersect the affected set. */
  affectedTasks: ImpactedTask[];
  /** True when propagation requires acknowledgeHighImpact. */
  requiresAcknowledgment: boolean;
}

export interface PropagateImpactOptions {
  /** Required when the decision impact is HIGH — proves preview came first. */
  acknowledgeHighImpact?: boolean;
}

export interface PropagatedImpact {
  preview: DecisionChangeImpact;
  /** Affected section keys (decision + affected-requirement dependents). */
  staleSections: { documentType: string; sectionKey: string }[];
}

// Withdrawn rows are frozen history, never actionable impact (same posture
// as the TASK-076 coverage validator: SUPERSEDED/REMOVED never flag).
const WITHDRAWN_REQUIREMENT_STATUSES = new Set(["SUPERSEDED", "REMOVED"]);

function requireOwner(userId: string): void {
  if (userId.trim() === "") throw new ChangeImpactValidationError("Owner is required.");
}

function toDecisionSnapshot(decision: DecisionRow): ImpactedDecision {
  return {
    id: decision.id,
    decisionCode: decision.decisionCode,
    decisionKey: decision.decisionKey,
    title: decision.title,
    status: decision.status,
    impact: decision.impact,
    version: decision.version,
  };
}

// Read-only impact report (AC 1–4): known affected requirements, sections,
// and tasks for a decision change. Performs scoped reads only — no writes,
// no state-version bump — so the UI (TASK-112) can render it freely before
// any propagation.
export async function previewDecisionChangeImpact(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionKey: string,
): Promise<DecisionChangeImpact> {
  requireOwner(userId);
  const decision = await getDecisionByKey(db, userId, projectId, decisionKey);

  const knowledge = await listKnowledge(db, userId, projectId);
  const affectedKnowledge: ImpactedKnowledge[] = knowledge
    .filter(
      (item) =>
        item.status !== "SUPERSEDED" &&
        item.sources.some(
          (source) => source.sourceType === "DECISION" && source.sourceId === decision.id,
        ),
    )
    .map((item) => ({
      knowledgeKey: item.knowledgeKey,
      title: item.title,
      status: item.status,
    }))
    .sort((a, b) => a.knowledgeKey.localeCompare(b.knowledgeKey));

  // One project-wide link read, then filter to links incident on this
  // decision with a REQUIREMENT on the other end — either direction, since
  // DECISION → REQUIREMENT (derives) and REQUIREMENT → DECISION
  // (justified_by) are both legitimate registrations.
  const links = await listProjectLinks(db, userId, projectId);
  const requirementIds = new Set<string>();
  for (const link of links) {
    if (link.source.type === "DECISION" && link.source.id === decision.id) {
      if (link.target.type === "REQUIREMENT") requirementIds.add(link.target.id);
    } else if (link.target.type === "DECISION" && link.target.id === decision.id) {
      if (link.source.type === "REQUIREMENT") requirementIds.add(link.source.id);
    }
  }
  const requirements = await listRequirements(db, userId, projectId);
  const affectedRequirements: ImpactedRequirement[] = requirements
    .filter(
      (requirement) =>
        requirementIds.has(requirement.id) &&
        !WITHDRAWN_REQUIREMENT_STATUSES.has(requirement.status),
    )
    .map((requirement) => ({
      id: requirement.id,
      requirementCode: requirement.requirementCode,
      title: requirement.title,
      status: requirement.status,
    }))
    .sort((a, b) => a.requirementCode.localeCompare(b.requirementCode));

  // Direct dependents (sections citing the decision) plus second-hop
  // dependents (sections citing an affected requirement). Bounded fan-out:
  // one reverse-dependency read per affected canonical element.
  const sectionSigs = new Map<string, { documentType: string; sectionKey: string }>();
  const dependentsOfDecision = await listSectionsDependingOn(
    db,
    userId,
    projectId,
    "DECISION",
    decision.id,
  );
  for (const dependent of dependentsOfDecision) {
    sectionSigs.set(`${dependent.documentType}::${dependent.sectionKey}`, dependent);
  }
  for (const requirement of affectedRequirements) {
    const dependents = await listSectionsDependingOn(
      db,
      userId,
      projectId,
      "REQUIREMENT",
      requirement.id,
    );
    for (const dependent of dependents) {
      sectionSigs.set(`${dependent.documentType}::${dependent.sectionKey}`, dependent);
    }
  }
  const affectedSections: ImpactedSection[] = [];
  for (const dependent of [...sectionSigs.values()].sort(
    (a, b) =>
      a.documentType.localeCompare(b.documentType) || a.sectionKey.localeCompare(b.sectionKey),
  )) {
    const section = await getSection(
      db,
      userId,
      projectId,
      dependent.documentType,
      dependent.sectionKey,
    );
    affectedSections.push({
      documentType: dependent.documentType,
      sectionKey: dependent.sectionKey,
      status: section.status,
    });
  }

  // Tasks reference requirements by stable code (FR-001…) — any task citing
  // an affected requirement is affected. One task-list read, in-memory join.
  const affectedCodes = new Set(affectedRequirements.map((r) => r.requirementCode));
  const tasks = await listUserTasks(db, userId, projectId);
  const affectedTasks: ImpactedTask[] = tasks
    .filter((task) => (task.references?.requirements ?? []).some((code) => affectedCodes.has(code)))
    .map((task) => ({ taskCode: task.taskCode, title: task.title, status: task.status }))
    .sort((a, b) => a.taskCode.localeCompare(b.taskCode));

  return {
    decision: toDecisionSnapshot(decision),
    affectedKnowledge,
    affectedRequirements,
    affectedSections,
    affectedTasks,
    requiresAcknowledgment: decision.impact === "HIGH",
  };
}

// Controlled propagation (AC 4 + TASK-061 semantics): marks exactly the
// dependent sections STALE — unaffected sections stay CURRENT — and leaves
// knowledge/tasks untouched (they are listed, not auto-mutated). HIGH
// decisions require acknowledgeHighImpact, enforcing preview-before-
// propagate at the interface instead of trusting caller discipline.
export async function propagateDecisionChangeImpact(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionKey: string,
  options?: PropagateImpactOptions,
): Promise<PropagatedImpact> {
  requireOwner(userId);
  const preview = await previewDecisionChangeImpact(db, userId, projectId, decisionKey);
  if (preview.decision.impact === "HIGH" && options?.acknowledgeHighImpact !== true) {
    throw new ChangeImpactValidationError(
      "This is a HIGH-impact decision: review its impact preview before propagating, " +
        "then retry with acknowledgeHighImpact.",
    );
  }
  const seen = new Set<string>();
  const staleSections: { documentType: string; sectionKey: string }[] = [];
  const collect = (rows: { documentType: string; sectionKey: string }[]): void => {
    for (const row of rows) {
      const sig = `${row.documentType}::${row.sectionKey}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      staleSections.push(row);
    }
  };
  collect(await markStaleDependents(db, userId, projectId, "DECISION", preview.decision.id));
  for (const requirement of preview.affectedRequirements) {
    collect(await markStaleDependents(db, userId, projectId, "REQUIREMENT", requirement.id));
  }
  staleSections.sort(
    (a, b) =>
      a.documentType.localeCompare(b.documentType) || a.sectionKey.localeCompare(b.sectionKey),
  );
  return { preview, staleSections };
}
