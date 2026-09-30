// Discovery level calculation (TASK-031, database-schema.md §5).
//
// Pure deterministic projection of node statuses onto the four canonical
// levels INITIAL → QUICK_DRAFT → DETAILED → AGENT_READY. No AI, no database
// inside the calculator: the same map always yields the same level, and the
// result explains what remains for the next level so UI can render it.
//
// Explicit criteria (no spec defines thresholds, so they are fixed here and
// kept monotonic — raising a level never requires un-handling a node):
//   AGENT_READY: all 9 nodes RESOLVED or NOT_APPLICABLE (zero open).
//   DETAILED:    core four (product, features, access, data) handled
//                AND at least 6 of 9 handled.
//   QUICK_DRAFT: product handled AND at least 3 of 9 handled.
//   INITIAL:     anything below QUICK_DRAFT (including an empty map).
// NOT_APPLICABLE counts as handled: an out-of-scope branch must not block
// progress. PARTIAL counts as open: it still needs work.
//
// refreshDiscoveryLevel syncs the derived value onto projects.discovery_level
// when it drifts. It performs NO state-version bump: the node writes that
// moved the level already bumped once each (TASK-020); the column is a
// derived cache of node state, not a second canonical change.
import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { projects } from "../../infrastructure/database/schema/projects";
import { getProject, requireProjectScope } from "../projects/repository";
import { ProjectNotFoundError } from "../projects/errors";
import { DISCOVERY_STATUSES, getDiscoveryMap, type DiscoveryStatus } from "./discovery";
import { DiscoveryValidationError } from "./errors";

export const DISCOVERY_LEVELS = ["INITIAL", "QUICK_DRAFT", "DETAILED", "AGENT_READY"] as const;
export type DiscoveryLevel = (typeof DISCOVERY_LEVELS)[number];

// Core four: a DETAILED map must have the product spine settled.
const DETAILED_CORE_KEYS = ["product", "features", "access", "data"] as const;
const QUICK_DRAFT_MIN_HANDLED = 3;
const DETAILED_MIN_HANDLED = 6;

export interface LevelNodeInput {
  nodeKey: string;
  status: string;
}

export interface DiscoveryLevelResult {
  level: DiscoveryLevel;
  handled: number;
  total: number;
  openNodeKeys: string[];
  nextLevel: DiscoveryLevel | null;
  missingForNext: string[];
}

function requireStatus(raw: string): DiscoveryStatus {
  if (!(DISCOVERY_STATUSES as readonly string[]).includes(raw)) {
    throw new DiscoveryValidationError(`status must be one of ${DISCOVERY_STATUSES.join(", ")}.`);
  }
  return raw as DiscoveryStatus;
}

function isHandled(status: DiscoveryStatus): boolean {
  return status === "RESOLVED" || status === "NOT_APPLICABLE";
}

export function calculateDiscoveryLevel(nodes: LevelNodeInput[]): DiscoveryLevelResult {
  const normalized = nodes.map((node) => ({
    nodeKey: node.nodeKey,
    status: requireStatus(node.status),
  }));
  const byKey = new Map(normalized.map((node) => [node.nodeKey, node.status]));
  const handled = normalized.filter((node) => isHandled(node.status)).length;
  const total = normalized.length;
  const openNodeKeys = normalized
    .filter((node) => !isHandled(node.status))
    .map((node) => node.nodeKey)
    .sort();
  const coreOpen = DETAILED_CORE_KEYS.filter((key) => {
    const status = byKey.get(key);
    return status === undefined || !isHandled(status);
  }).sort();
  const productOpen = (() => {
    const status = byKey.get("product");
    return status === undefined || !isHandled(status);
  })();

  let level: DiscoveryLevel = "INITIAL";
  if (total > 0 && openNodeKeys.length === 0) {
    level = "AGENT_READY";
  } else if (coreOpen.length === 0 && handled >= DETAILED_MIN_HANDLED) {
    level = "DETAILED";
  } else if (!productOpen && handled >= QUICK_DRAFT_MIN_HANDLED) {
    level = "QUICK_DRAFT";
  }

  // Explain the immediate next step only — UI shows one actionable gap.
  let nextLevel: DiscoveryLevel | null = null;
  const missingForNext: string[] = [];
  if (level === "INITIAL") {
    nextLevel = "QUICK_DRAFT";
    if (productOpen) missingForNext.push("resolve the product domain");
    const need = Math.max(0, QUICK_DRAFT_MIN_HANDLED - handled);
    if (need > 0) missingForNext.push(`handle ${need} more domain${need === 1 ? "" : "s"}`);
  } else if (level === "QUICK_DRAFT") {
    nextLevel = "DETAILED";
    for (const key of coreOpen) missingForNext.push(`resolve the ${key} domain`);
    const need = Math.max(0, DETAILED_MIN_HANDLED - handled);
    if (need > 0) missingForNext.push(`handle ${need} more domain${need === 1 ? "" : "s"}`);
  } else if (level === "DETAILED") {
    nextLevel = "AGENT_READY";
    for (const key of openNodeKeys) missingForNext.push(`resolve the ${key} domain`);
  }

  return { level, handled, total, openNodeKeys, nextLevel, missingForNext };
}

export interface RefreshDiscoveryLevelResult extends DiscoveryLevelResult {
  updated: boolean;
}

export async function refreshDiscoveryLevel(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<RefreshDiscoveryLevelResult> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const nodes = await getDiscoveryMap(db, userId, projectId);
  const result = calculateDiscoveryLevel(nodes);
  const { project } = await getProject(db, userId, projectId);
  if (project.discoveryLevel === result.level) return { ...result, updated: false };
  const [updated] = await db
    .update(projects)
    .set({ discoveryLevel: result.level })
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.userId, userId),
        isNull(projects.deletedAt),
      ),
    )
    .returning({ id: projects.id });
  if (!updated) throw new ProjectNotFoundError();
  return { ...result, updated: true };
}
