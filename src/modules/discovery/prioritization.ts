// Discovery topic prioritization (TASK-032, architecture.md §10).
//
// Pure deterministic selector over Discovery Map state: the application owns
// WHAT needs clarification next, the AI only formulates how to ask it
// (agents.md A-002). Same map state always yields the same topic; the LLM
// never reorders the map.
//
// Explicit scoring (fixed here, monotonic — a resolved topic never returns):
//   impact weight:      HIGH 30 / MEDIUM 20 / LOW 10 / unset 0
//   uncertainty weight: UNKNOWN 20 / PARTIAL 10
//   blocking bonus:     +25 when a linked decision is the source of a
//                       decision-dependency edge (resolving this topic
//                       unblocks downstream decisions, TASK-022)
//   MVP relevance:      +node.priority as-is (operator-set weight,
//                       default 0; breaks ties among otherwise equals)
// Ties break on nodeKey ascending, so output is fully deterministic.
// RESOLVED and NOT_APPLICABLE nodes are excluded before scoring.
import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { decisions } from "../../infrastructure/database/schema/decisions";
import { decisionDependencies } from "../../infrastructure/database/schema/decisions";
import {
  discoveryNodeDecisions,
  discoveryNodes,
} from "../../infrastructure/database/schema/discovery";
import { requireProjectScope } from "../projects/repository";
import type { DiscoveryImpact, DiscoveryStatus } from "./discovery";
import { DiscoveryValidationError } from "./errors";

const IMPACT_WEIGHT: Record<string, number> = { HIGH: 30, MEDIUM: 20, LOW: 10 };
// RESOLVED / NOT_APPLICABLE score 0 but never reach scoring — the ranker
// excludes them first. Full-record typing keeps indexing total.
const UNCERTAINTY_WEIGHT: Record<DiscoveryStatus, number> = {
  UNKNOWN: 20,
  PARTIAL: 10,
  RESOLVED: 0,
  NOT_APPLICABLE: 0,
};
const BLOCKING_BONUS = 25;

export interface TopicCandidate {
  nodeKey: string;
  status: DiscoveryStatus;
  priority: number;
  impact: DiscoveryImpact | null;
  blocksDownstream: boolean;
}

export interface RankedTopic extends TopicCandidate {
  score: number;
  reasons: string[];
}

export function rankDiscoveryTopics(candidates: TopicCandidate[]): RankedTopic[] {
  const open = candidates.filter(
    (candidate) => candidate.status === "UNKNOWN" || candidate.status === "PARTIAL",
  );
  const ranked = open.map((candidate) => {
    const reasons: string[] = [];
    let score = 0;
    const impactWeight = candidate.impact === null ? 0 : (IMPACT_WEIGHT[candidate.impact] ?? 0);
    score += impactWeight;
    if (candidate.impact !== null) reasons.push(`impact ${candidate.impact}`);
    const uncertainty = UNCERTAINTY_WEIGHT[candidate.status];
    score += uncertainty;
    reasons.push(candidate.status === "UNKNOWN" ? "unresolved" : "partially resolved");
    if (candidate.blocksDownstream) {
      score += BLOCKING_BONUS;
      reasons.push("unblocks downstream decisions");
    }
    if (candidate.priority > 0) {
      score += candidate.priority;
      reasons.push(`MVP priority +${candidate.priority}`);
    }
    return { ...candidate, score, reasons };
  });
  ranked.sort((a, b) => b.score - a.score || a.nodeKey.localeCompare(b.nodeKey));
  return ranked;
}

// Loads map + links + dependency edges inside one project scope and returns
// the ranked open topics. Read-only: selection never bumps the state version
// and never writes anything for the AI to reinterpret.
export async function selectNextDiscoveryTopic(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<RankedTopic[]> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const nodes = await db.query.discoveryNodes.findMany({
    where: eq(discoveryNodes.projectId, scope.projectId),
  });
  if (nodes.length === 0) return [];

  const links = await db.query.discoveryNodeDecisions.findMany({
    where: inArray(
      discoveryNodeDecisions.nodeId,
      nodes.map((node) => node.id),
    ),
  });
  const inScopeLinks = links;
  const decisionIds = [...new Set(inScopeLinks.map((link) => link.decisionId))];
  const keyByDecisionId = new Map<string, string>();
  for (const decisionId of decisionIds) {
    const found = await db.query.decisions.findFirst({
      columns: { id: true, decisionKey: true },
      where: and(eq(decisions.projectId, scope.projectId), eq(decisions.id, decisionId)),
    });
    if (found) keyByDecisionId.set(found.id, found.decisionKey);
  }
  const edges = await db.query.decisionDependencies.findMany({
    where: eq(decisionDependencies.projectId, scope.projectId),
  });
  const blockingKeys = new Set(edges.map((edge) => edge.sourceDecisionKey));

  const candidates: TopicCandidate[] = [];
  for (const node of nodes) {
    const linkedKeys = inScopeLinks
      .filter((link) => link.nodeId === node.id)
      .map((link) => keyByDecisionId.get(link.decisionId))
      .filter((key): key is string => key !== undefined);
    candidates.push({
      nodeKey: node.nodeKey,
      status: node.status as DiscoveryStatus,
      priority: node.priority,
      impact: (node.impact ?? null) as DiscoveryImpact | null,
      blocksDownstream: linkedKeys.some((key) => blockingKeys.has(key)),
    });
  }
  return rankDiscoveryTopics(candidates);
}
