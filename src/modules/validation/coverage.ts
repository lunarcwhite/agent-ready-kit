// Requirement coverage validator (TASK-076, TASK-094).
//
// Detects live requirements with no downstream mapping, reading the
// traceability graph (TASK-024): FR → ARC (architecture), FR → SCREEN
// (design), FR → DATA (entities). Task coverage (FR → TASK, TASK-094)
// reads the task domain instead: a requirement is task-covered when at
// least one user task references its stable code — tasks ride jsonb
// references, not traceability links (no TASK node type exists), so the
// TASK kind is counted from task rows, never from links.
//
// Deterministic only — no AI (AGENTS.md §40). Same canonical state always
// yields the same findings; reconciliation (shared with TASK-071/072)
// dedupes reruns, auto-resolves fixed gaps, and reopens regressions
// (including coverage lost when a task's requirement reference is
// removed — tasks are never hard-deleted, so reference removal is the
// operative "deletion" event).
//
// Deterministic only — no AI (AGENTS.md §40). Same canonical state always
// yields the same findings; reconciliation (shared with TASK-071/072)
// dedupes reruns, auto-resolves fixed gaps, and reopens regressions.
//
// Rule calibration (documented MVP defaults, configurable per
// requirement type via COVERAGE_RULES or the rules parameter):
// - FUNCTIONAL / BUSINESS_RULE mandate an ARCHITECTURE mapping: every
//   behavior and rule must live in some system component. UI (DESIGN)
//   and DATA mappings vary per requirement (backend jobs have no
//   screens; derivations touch no entities), so flagging their absence
//   would be false noise — they stay inspectable, not mandatory.
// - NON_FUNCTIONAL / CONSTRAINT mandate nothing: NFRs and project-level
//   constraints rarely map to single components, and forcing links
//   would manufacture coverage theater.
// - WONT and DEFERRED requirements are out of scope by definition;
//   SUPERSEDED/REMOVED rows are frozen history, never flagged.
// - Severity scales by priority (MUST → BLOCKER, SHOULD → HIGH,
//   COULD → MEDIUM): only MUST gaps gate readiness, never polish.
//
// A link counts only when its target resolves to a live
// (DRAFT/CONFIRMED/DEFERRED) row — mappings to REMOVED/SUPERSEDED rows
// are withdrawn history, not coverage. Dangling ids never count
// (same "does not resolve" posture as the dependency validator).
//
// Five scoped reads, no N+1 (AGENTS.md §90): requirements, project
// links, components, screens, entities.
import type { AppDatabase } from "../../infrastructure/database/db";
import { listRequirements, type RequirementRow } from "../requirements/requirements";
import { listProjectLinks } from "../traceability/traceability";
import { listComponents } from "../architecture/components";
import { listScreens } from "../architecture/screens";
import { listEntities } from "../entities/entities";
import { listUserTasks } from "../tasks/user-tasks";
import { requireProjectScope } from "../projects/repository";
import { type IssueReferenceInput, type IssueSeverity } from "./issues";
import { IssueValidationError } from "./errors";
import { reconcileFindings } from "./reconcile";

export const COVERAGE_VALIDATOR = "coverage-v1" as const;

export const COVERAGE_KINDS = ["ARCHITECTURE", "DESIGN", "DATA", "TASK"] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

const KIND_TARGET_TYPE: Record<CoverageKind, string> = {
  ARCHITECTURE: "ARC",
  DESIGN: "SCREEN",
  DATA: "ENT",
  // No traceability node type: TASK coverage is counted from user-task
  // requirement references, never from links. The link loop below skips
  // this kind explicitly.
  TASK: "TASK",
};

const KIND_LABEL: Record<CoverageKind, string> = {
  ARCHITECTURE: "architecture",
  DESIGN: "design",
  DATA: "data",
  TASK: "task",
};

export interface CoverageRule {
  mandatory: CoverageKind[];
}

// Mandatory downstream kinds per requirement type. Data, not code:
// callers (and future UI) tighten or loosen coverage by supplying rules.
export const COVERAGE_RULES: Record<string, CoverageRule> = {
  FUNCTIONAL: { mandatory: ["ARCHITECTURE", "TASK"] },
  BUSINESS_RULE: { mandatory: ["ARCHITECTURE", "TASK"] },
  NON_FUNCTIONAL: { mandatory: [] },
  CONSTRAINT: { mandatory: [] },
};

export interface CoverageFinding {
  rule: string;
  targetKey: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  references: IssueReferenceInput[];
}

export interface CoverageReport {
  findings: CoverageFinding[];
  created: string[];
  reopened: string[];
  resolved: string[];
  unchangedOpen: string[];
}

export interface RequirementCoverage {
  requirementCode: string;
  requirementId: string;
  kinds: Record<CoverageKind, { covered: boolean; linkCount: number; mandatory: boolean }>;
  missingMandatory: CoverageKind[];
  /** Tasks referencing this requirement's code, ordered by task code. */
  implementingTasks: ImplementingTask[];
}

export interface ImplementingTask {
  taskCode: string;
  title: string;
  status: string;
}

const COVERED_REQUIREMENT_STATUSES = ["DRAFT", "CONFIRMED"] as const;
const COVERED_PRIORITIES = ["MUST", "SHOULD", "COULD"] as const;
const LIVE_TARGET_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;

function severityForPriority(priority: string): IssueSeverity {
  if (priority === "MUST") return "BLOCKER";
  if (priority === "SHOULD") return "HIGH";
  return "MEDIUM";
}

function ruleForKind(kind: CoverageKind): string {
  return `coverage:fr:${KIND_LABEL[kind]}`;
}

interface CoverageGraph {
  requirements: RequirementRow[];
  linkCounts: Map<string, Map<CoverageKind, number>>;
  implementingTasks: Map<string, ImplementingTask[]>;
  rules: Record<string, CoverageRule>;
}

// Single pass over six scoped reads: index live downstream ids per
// link-based kind, then mark each requirement link whose target resolves.
// TASK coverage joins separately — task rows reference requirement codes,
// not row ids. Unknown target ids (dangling or foreign) never count.
async function loadCoverageGraph(
  db: AppDatabase,
  userId: string,
  projectId: string,
  rules: Record<string, CoverageRule>,
): Promise<CoverageGraph> {
  const scope = await requireProjectScope(db, userId, projectId);
  const pid = scope.projectId;
  const [requirements, links, components, screens, entities, tasks] = await Promise.all([
    listRequirements(db, userId, pid),
    listProjectLinks(db, userId, pid),
    listComponents(db, userId, pid),
    listScreens(db, userId, pid),
    listEntities(db, userId, pid),
    listUserTasks(db, userId, pid),
  ]);

  const liveIds = new Map<CoverageKind, Set<string>>([
    ["ARCHITECTURE", new Set()],
    ["DESIGN", new Set()],
    ["DATA", new Set()],
  ]);
  for (const component of components) {
    if ((LIVE_TARGET_STATUSES as readonly string[]).includes(component.status)) {
      liveIds.get("ARCHITECTURE")?.add(component.id);
    }
  }
  for (const screen of screens) {
    if ((LIVE_TARGET_STATUSES as readonly string[]).includes(screen.status)) {
      liveIds.get("DESIGN")?.add(screen.id);
    }
  }
  for (const entity of entities) {
    if ((LIVE_TARGET_STATUSES as readonly string[]).includes(entity.status)) {
      liveIds.get("DATA")?.add(entity.id);
    }
  }

  const linkCounts = new Map<string, Map<CoverageKind, number>>();
  for (const link of links) {
    if (link.source.type !== "REQUIREMENT") continue;
    for (const kind of COVERAGE_KINDS) {
      if (kind === "TASK") continue;
      if (link.target.type !== KIND_TARGET_TYPE[kind]) continue;
      if (!liveIds.get(kind)?.has(link.target.id)) continue;
      let counts = linkCounts.get(link.source.id);
      if (!counts) {
        counts = new Map();
        linkCounts.set(link.source.id, counts);
      }
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }

  // TASK join: code → requirement id, then every task citing the code.
  // Tasks are never hard-deleted, so every row counts; withdrawn
  // requirements never match because inScope filters them upstream.
  const idByCode = new Map(
    requirements.map((requirement) => [requirement.requirementCode, requirement.id]),
  );
  const implementingTasks = new Map<string, ImplementingTask[]>();
  const bumpTaskCount = (requirementId: string, task: ImplementingTask): void => {
    const list = implementingTasks.get(requirementId) ?? [];
    list.push(task);
    implementingTasks.set(requirementId, list);
    let counts = linkCounts.get(requirementId);
    if (!counts) {
      counts = new Map();
      linkCounts.set(requirementId, counts);
    }
    counts.set("TASK", (counts.get("TASK") ?? 0) + 1);
  };
  for (const task of tasks) {
    const entry: ImplementingTask = {
      taskCode: task.taskCode,
      title: task.title,
      status: task.status,
    };
    for (const code of task.references?.requirements ?? []) {
      const requirementId = idByCode.get(code);
      if (requirementId !== undefined) bumpTaskCount(requirementId, entry);
    }
  }
  for (const list of implementingTasks.values()) {
    list.sort((a, b) => a.taskCode.localeCompare(b.taskCode));
  }
  return { requirements, linkCounts, implementingTasks, rules };
}

function inScope(requirement: RequirementRow): boolean {
  return (
    (COVERED_REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status) &&
    (COVERED_PRIORITIES as readonly string[]).includes(requirement.priority)
  );
}

function collectFindings(graph: CoverageGraph): CoverageFinding[] {
  const findings: CoverageFinding[] = [];
  for (const requirement of graph.requirements) {
    if (!inScope(requirement)) continue;
    const mandatory = graph.rules[requirement.type]?.mandatory ?? [];
    const counts = graph.linkCounts.get(requirement.id);
    for (const kind of mandatory) {
      if ((counts?.get(kind) ?? 0) > 0) continue;
      const description =
        kind === "TASK"
          ? `"${requirement.title}" (${requirement.requirementCode}, ${requirement.priority} ` +
            `${requirement.type}) has no implementing task. ` +
            `Create a UTASK referencing ${requirement.requirementCode}, or narrow the requirement.`
          : `"${requirement.title}" (${requirement.requirementCode}, ${requirement.priority} ` +
            `${requirement.type}) has no linked live ${KIND_LABEL[kind]} artifact. ` +
            `Link it to the ${KIND_TARGET_TYPE[kind]} row that implements it, or narrow the requirement.`;
      findings.push({
        rule: ruleForKind(kind),
        targetKey: requirement.requirementCode,
        title: `${requirement.requirementCode} has no ${KIND_LABEL[kind]} mapping`,
        description,
        severity: severityForPriority(requirement.priority),
        references: [
          { referenceType: "REQUIREMENT", referenceId: requirement.id, relationship: "AFFECTED" },
        ],
      });
    }
  }
  findings.sort((a, b) =>
    a.rule === b.rule ? a.targetKey.localeCompare(b.targetKey) : a.rule.localeCompare(b.rule),
  );
  return findings;
}

// Per-requirement inspection (acceptance criterion): which downstream
// kinds cover this requirement, which mandatory kinds are missing.
// Pure read — never writes.
export async function getRequirementCoverage(
  db: AppDatabase,
  userId: string,
  projectId: string,
  requirementCode: string,
  rules: Record<string, CoverageRule> = COVERAGE_RULES,
): Promise<RequirementCoverage> {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
  const code = requirementCode.trim().toUpperCase();
  if (code === "") throw new IssueValidationError("requirementCode is required.");
  const graph = await loadCoverageGraph(db, userId, projectId, rules);
  const requirement = graph.requirements.find((row) => row.requirementCode === code);
  if (!requirement)
    throw new IssueValidationError(`Requirement ${code} not found in this project.`);
  const counts = graph.linkCounts.get(requirement.id);
  const mandatory = new Set(graph.rules[requirement.type]?.mandatory ?? []);
  const kinds = {} as RequirementCoverage["kinds"];
  const missingMandatory: CoverageKind[] = [];
  for (const kind of COVERAGE_KINDS) {
    const linkCount = counts?.get(kind) ?? 0;
    kinds[kind] = { covered: linkCount > 0, linkCount, mandatory: mandatory.has(kind) };
    if (mandatory.has(kind) && linkCount === 0) missingMandatory.push(kind);
  }
  return {
    requirementCode: requirement.requirementCode,
    requirementId: requirement.id,
    kinds,
    missingMandatory,
    implementingTasks: graph.implementingTasks.get(requirement.id) ?? [],
  };
}

export async function runCoverageValidation(
  db: AppDatabase,
  userId: string,
  projectId: string,
  rules: Record<string, CoverageRule> = COVERAGE_RULES,
): Promise<CoverageReport> {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const graph = await loadCoverageGraph(db, userId, scope.projectId, rules);
  const findings = collectFindings(graph);
  const reconciled = await reconcileFindings(
    db,
    userId,
    scope.projectId,
    COVERAGE_VALIDATOR,
    "IMPLEMENTATION_COVERAGE",
    findings,
  );
  return { findings, ...reconciled };
}
