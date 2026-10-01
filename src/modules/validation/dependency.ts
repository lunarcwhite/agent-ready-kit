// Deterministic dependency validator (TASK-072, FR-062).
//
// Re-checks every polymorphic graph edge with application rules only — no
// AI. Same canonical state always yields the same findings. Write paths
// already scope-check every edge (TASK-014), so anything flagged here is
// drift residue: a row whose endpoint no longer resolves inside its own
// project, a self-loop, a cycle, or a malformed condition.
//
// Privacy posture (§67, TASK-014): an unresolvable endpoint is reported as
// "does not resolve inside this project (missing or foreign)" — the
// validator never probes other projects to distinguish the two, so running
// it cannot become an existence oracle for foreign rows. Cross-project
// rejection therefore stays enforced at the write path (verified by the
// authorization tests of each owning module); this validator catches any
// residue uniformly as broken.
//
// Severity calibration: broken execution edges (decision cascades, task
// order) are HIGH because they silently misdirect automation; broken
// documentation links (traceability, section deps, issue refs) are MEDIUM
// or LOW because they degrade inspection, not execution.
//
// Implementation-task (TASK-*) dependencies arrive with TASK-093; the
// user-task (UTASK-*) graph below is the executable graph that exists today.
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { listDecisions } from "../decisions/decisions";
import { listDependencies, normalizeCondition } from "../decisions/dependencies";
import { listRequirements } from "../requirements/requirements";
import { listProjectLinks } from "../traceability/traceability";
import { requireProjectScope } from "../projects/repository";
import { decisions } from "../../infrastructure/database/schema/decisions";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { knowledgeItems } from "../../infrastructure/database/schema/knowledge";
import { domainEntities } from "../../infrastructure/database/schema/entities";
import { userTaskDependencies, userTasks } from "../../infrastructure/database/schema/user-tasks";
import { listDocuments, listSections } from "../specifications/documents";
import { listSectionDependencies } from "../specifications/dependencies";
import { SpecificationNotFoundError } from "../specifications/errors";
import { listIssues, type IssueReferenceInput, type IssueSeverity } from "./issues";
import { IssueValidationError } from "./errors";
import { reconcileFindings } from "./reconcile";

export const DEPENDENCY_VALIDATOR = "dependency-v1" as const;

export interface DependencyFinding {
  rule: string;
  targetKey: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  references: IssueReferenceInput[];
}

export interface DependencyReport {
  findings: DependencyFinding[];
  created: string[];
  reopened: string[];
  resolved: string[];
  unchangedOpen: string[];
}

// Pure cycle detection over string edges (no database): iterative DFS with
// colors; each elementary cycle normalizes to its sorted member set so the
// same loop always yields the same identity. Self-loops are excluded here —
// they are reported by the dedicated self-dependency rules.
export function findCycles(edges: { from: string; to: string }[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const cycles: string[][] = [];
  const visit = (node: string): void => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if ((color.get(next) ?? WHITE) === BLACK) continue;
      if ((color.get(next) ?? WHITE) === GRAY) {
        const members = [...stack.slice(stack.indexOf(next))].sort();
        const key = members.join("\u0000");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(members);
        }
        continue;
      }
      visit(next);
    }
    stack.pop();
    color.set(node, BLACK);
  };
  for (const node of [...adjacency.keys()].sort()) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node);
  }
  cycles.sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")));
  return cycles;
}

async function existsInProject(
  db: AppDatabase,
  projectId: string,
  kind: "DECISION" | "REQUIREMENT" | "KNOWLEDGE" | "ENTITY",
  id: string,
): Promise<boolean> {
  if (kind === "DECISION") {
    const rows = await db
      .select({ id: decisions.id })
      .from(decisions)
      .where(and(eq(decisions.projectId, projectId), eq(decisions.id, id)))
      .limit(1);
    return rows.length > 0;
  }
  if (kind === "REQUIREMENT") {
    const rows = await db
      .select({ id: requirements.id })
      .from(requirements)
      .where(and(eq(requirements.projectId, projectId), eq(requirements.id, id)))
      .limit(1);
    return rows.length > 0;
  }
  if (kind === "KNOWLEDGE") {
    const rows = await db
      .select({ id: knowledgeItems.id })
      .from(knowledgeItems)
      .where(and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.id, id)))
      .limit(1);
    return rows.length > 0;
  }
  const rows = await db
    .select({ id: domainEntities.id })
    .from(domainEntities)
    .where(and(eq(domainEntities.projectId, projectId), eq(domainEntities.id, id)))
    .limit(1);
  return rows.length > 0;
}

function decisionRef(id: string): IssueReferenceInput[] {
  return [{ referenceType: "DECISION", referenceId: id, relationship: "AFFECTED" }];
}

function requirementRef(id: string): IssueReferenceInput[] {
  return [{ referenceType: "REQUIREMENT", referenceId: id, relationship: "AFFECTED" }];
}

function taskRef(id: string): IssueReferenceInput[] {
  return [{ referenceType: "TASK", referenceId: id, relationship: "AFFECTED" }];
}

// Pure read pass across the five edge stores. Sorted for determinism.
export async function collectDependencyFindings(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<DependencyFinding[]> {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const pid = scope.projectId;
  const findings: DependencyFinding[] = [];
  const push = (finding: DependencyFinding): void => {
    findings.push(finding);
  };

  // --- Decision dependency graph (TASK-022) ---
  const decisionList = await listDecisions(db, userId, pid);
  const decisionByKey = new Map(decisionList.map((row) => [row.decisionKey, row]));
  const depEdges = await listDependencies(db, userId, pid);
  const seenEdge = new Map<string, string>();
  const cycleEdges: { from: string; to: string }[] = [];
  for (const edge of depEdges) {
    const source = decisionByKey.get(edge.sourceDecisionKey);
    const target = decisionByKey.get(edge.targetDecisionKey);
    const label = `${edge.sourceDecisionKey} → ${edge.targetDecisionKey}`;
    if (edge.sourceDecisionKey === edge.targetDecisionKey) {
      push({
        rule: "decision-dep-self",
        targetKey: `dep-self:${edge.sourceDecisionKey}`,
        title: `Decision depends on itself: ${edge.sourceDecisionKey}`,
        description: `Dependency edge ${label} is a self-loop and can never execute meaningfully. Remove it.`,
        severity: "HIGH",
        references: source ? decisionRef(source.id) : [],
      });
      continue;
    }
    if (!source || !target) {
      const missing = !source
        ? `source "${edge.sourceDecisionKey}"`
        : `target "${edge.targetDecisionKey}"`;
      push({
        rule: "decision-dep-broken-endpoint",
        targetKey: `dep-broken:${edge.sourceDecisionKey}->${edge.targetDecisionKey}`,
        title: `Dependency endpoint does not resolve: ${label}`,
        description: `Dependency edge ${label} references ${missing}, which does not resolve inside this project (missing or foreign). The cascade for this edge cannot execute.`,
        severity: "HIGH",
        references: source ? decisionRef(source.id) : target ? decisionRef(target.id) : [],
      });
      continue;
    }
    try {
      normalizeCondition(edge.condition);
    } catch {
      push({
        rule: "decision-dep-invalid-condition",
        targetKey: `dep-condition:${edge.sourceDecisionKey}->${edge.targetDecisionKey}`,
        title: `Dependency has an invalid condition: ${label}`,
        description: `Dependency edge ${label} carries a condition outside the { equals } language and can never match deterministically. Fix or clear it.`,
        severity: "MEDIUM",
        references: decisionRef(source.id),
      });
    }
    const sig = JSON.stringify([
      edge.sourceDecisionKey,
      edge.targetDecisionKey,
      edge.effect,
      edge.condition,
    ]);
    const first = seenEdge.get(sig);
    if (first !== undefined) {
      push({
        rule: "decision-dep-duplicate",
        targetKey: `dep-duplicate:${edge.id}`,
        title: `Duplicate dependency edge: ${label}`,
        description: `Dependency edge ${label} is registered twice with the same effect and condition. Remove the duplicate.`,
        severity: "MEDIUM",
        references: decisionRef(source.id),
      });
    } else {
      seenEdge.set(sig, edge.id);
    }
    cycleEdges.push({ from: edge.sourceDecisionKey, to: edge.targetDecisionKey });
  }
  for (const members of findCycles(cycleEdges)) {
    push({
      rule: "decision-dep-cycle",
      targetKey: `dep-cycle:${members.join(",")}`,
      title: `Dependency cycle: ${members.join(" → ")} → ${members[0]}`,
      description: `Decisions ${members.join(", ")} depend on each other in a loop, so the cascade can never settle. Break the cycle.`,
      severity: "HIGH",
      references: decisionByKey.get(members[0] as string)
        ? decisionRef((decisionByKey.get(members[0] as string) as { id: string }).id)
        : [],
    });
  }

  // --- Traceability graph (TASK-024) ---
  const links = await listProjectLinks(db, userId, pid);
  const requirementIds = new Set((await listRequirements(db, userId, pid)).map((row) => row.id));
  const decisionIds = new Set(decisionList.map((row) => row.id));
  for (const link of links) {
    for (const end of [
      { side: "source", node: link.source },
      { side: "target", node: link.target },
    ] as const) {
      const known =
        end.node.type === "DECISION"
          ? decisionIds.has(end.node.id)
          : end.node.type === "REQUIREMENT"
            ? requirementIds.has(end.node.id)
            : false;
      if (!known) {
        const other = end.side === "source" ? link.target : link.source;
        const otherKnown =
          other.type === "DECISION"
            ? decisionIds.has(other.id)
            : other.type === "REQUIREMENT"
              ? requirementIds.has(other.id)
              : false;
        push({
          rule: "traceability-broken-endpoint",
          targetKey: `link:${link.id}:${end.side}`,
          title: `Traceability ${end.side} does not resolve (${link.relationship})`,
          description: `Traceability link "${link.relationship}" points its ${end.side} at ${end.node.type} ${end.node.id}, which does not resolve inside this project (missing or foreign).`,
          severity: "MEDIUM",
          references:
            otherKnown && (other.type === "DECISION" || other.type === "REQUIREMENT")
              ? other.type === "DECISION"
                ? decisionRef(other.id)
                : requirementRef(other.id)
              : [],
        });
      }
    }
  }

  // --- Specification section dependencies (TASK-061) ---
  const documents = await listDocuments(db, userId, pid);
  for (const document of documents) {
    let sections: Awaited<ReturnType<typeof listSections>> = [];
    try {
      sections = await listSections(db, userId, pid, document.documentType);
    } catch (error) {
      if (error instanceof SpecificationNotFoundError) continue;
      throw error;
    }
    for (const section of sections) {
      const deps = await listSectionDependencies(
        db,
        userId,
        pid,
        document.documentType,
        section.sectionKey,
      );
      for (const dep of deps) {
        let known = false;
        if (
          dep.sourceType === "DECISION" ||
          dep.sourceType === "REQUIREMENT" ||
          dep.sourceType === "KNOWLEDGE" ||
          dep.sourceType === "ENTITY"
        ) {
          known = await existsInProject(db, pid, dep.sourceType, dep.sourceId);
        }
        if (!known) {
          push({
            rule: "section-dep-broken-source",
            targetKey: `section:${document.documentType}:${section.sectionKey}:${dep.sourceType}:${dep.sourceId}`,
            title: `Section dependency is blind: ${section.sectionKey}`,
            description: `Section "${section.sectionKey}" (${document.documentType}) depends on ${dep.sourceType} ${dep.sourceId}, which does not resolve inside this project (missing or foreign). Staleness propagation for this source is blind.`,
            severity: "MEDIUM",
            references: [],
          });
        }
      }
    }
  }

  // --- Issue references (TASK-070) ---
  for (const issue of await listIssues(db, userId, pid)) {
    for (const ref of issue.references) {
      if (ref.referenceType === "TASK") continue;
      let known = false;
      if (
        ref.referenceType === "DECISION" ||
        ref.referenceType === "REQUIREMENT" ||
        ref.referenceType === "KNOWLEDGE_ITEM"
      ) {
        known = await existsInProject(
          db,
          pid,
          ref.referenceType === "KNOWLEDGE_ITEM" ? "KNOWLEDGE" : ref.referenceType,
          ref.referenceId,
        );
      }
      if (!known) {
        push({
          rule: "issue-ref-broken",
          targetKey: `issue:${issue.issueCode}:${ref.referenceType}:${ref.referenceId}`,
          title: `Issue reference does not resolve: ${issue.issueCode}`,
          description: `Issue ${issue.issueCode} links ${ref.relationship} ${ref.referenceType} ${ref.referenceId}, which does not resolve inside this project (missing or foreign).`,
          severity: "LOW",
          references: [],
        });
      }
    }
  }

  // --- User-task dependency graph (UTASK-*) ---
  const taskRows = await db
    .select({ id: userTasks.id, taskCode: userTasks.taskCode })
    .from(userTasks)
    .where(eq(userTasks.projectId, pid));
  const taskById = new Map(taskRows.map((row) => [row.id, row.taskCode]));
  const taskIdByCode = new Map(taskRows.map((row) => [row.taskCode, row.id]));
  const rawDeps = await db.select().from(userTaskDependencies);
  const touching = rawDeps.filter(
    (row) => taskById.has(row.taskId) || taskById.has(row.dependsOnTaskId),
  );
  const taskCycleEdges: { from: string; to: string }[] = [];
  for (const row of touching) {
    const from = taskById.get(row.taskId);
    const to = taskById.get(row.dependsOnTaskId);
    const label = `${from ?? row.taskId} → ${to ?? row.dependsOnTaskId}`;
    if (row.taskId === row.dependsOnTaskId) {
      push({
        rule: "task-dep-self",
        targetKey: `task-self:${from ?? row.taskId}`,
        title: `Task depends on itself: ${from ?? row.taskId}`,
        description: `Task dependency ${label} is a self-loop and can never be satisfied. Remove it.`,
        severity: "HIGH",
        references: from ? taskRef(taskIdByCode.get(from) as string) : [],
      });
      continue;
    }
    if (!from || !to) {
      push({
        rule: "task-dep-broken-endpoint",
        targetKey: `task-broken:${row.taskId}->${row.dependsOnTaskId}`,
        title: `Task dependency endpoint does not resolve: ${label}`,
        description: `Task dependency ${label} references a task that does not resolve inside this project (missing or foreign). Execution order for this edge is undefined.`,
        severity: "HIGH",
        references: from
          ? taskRef(taskIdByCode.get(from) as string)
          : to
            ? taskRef(taskIdByCode.get(to) as string)
            : [],
      });
      continue;
    }
    taskCycleEdges.push({ from, to });
  }
  for (const members of findCycles(taskCycleEdges)) {
    const firstId = taskIdByCode.get(members[0] as string);
    push({
      rule: "task-dep-cycle",
      targetKey: `task-cycle:${members.join(",")}`,
      title: `Task dependency cycle: ${members.join(" → ")} → ${members[0]}`,
      description: `Tasks ${members.join(", ")} wait on each other in a loop, so none can become READY. Break the cycle.`,
      severity: "HIGH",
      references: firstId ? taskRef(firstId) : [],
    });
  }

  findings.sort((a, b) =>
    a.rule === b.rule ? a.targetKey.localeCompare(b.targetKey) : a.rule.localeCompare(b.rule),
  );
  return findings;
}

export interface DependencyReport {
  findings: DependencyFinding[];
  created: string[];
  reopened: string[];
  resolved: string[];
  unchangedOpen: string[];
}

export async function runDependencyValidation(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<DependencyReport> {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const findings = await collectDependencyFindings(db, userId, scope.projectId);
  const reconciled = await reconcileFindings(
    db,
    userId,
    scope.projectId,
    DEPENDENCY_VALIDATOR,
    "DEPENDENCY",
    findings,
  );
  return { findings, ...reconciled };
}
