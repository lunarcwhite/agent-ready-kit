// Discovery Map domain model (TASK-030, database-schema.md §10).
//
// Persists per-project Discovery Map state: nine seeded domain nodes with a
// canonical UNKNOWN → PARTIAL → RESOLVED lifecycle (or NOT_APPLICABLE for
// out-of-scope branches), plus explicit node↔decision links.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first — nested callers pass a project_id they never
// touch directly. Map initialization and node updates are canonical changes
// and bump the project state version once per accepted change (TASK-020);
// link/unlink rows are bookkeeping (like TASK-024 traceability links) and
// do not bump the version.
//
// NOT here: level calculation (TASK-031), topic prioritization (TASK-032),
// conversation persistence (TASK-033), AI question formulation (TASK-052),
// and decision-confirm side effects on nodes (later TASK-054 wiring).
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { decisions } from "../../infrastructure/database/schema/decisions";
import {
  discoveryNodeDecisions,
  discoveryNodes,
} from "../../infrastructure/database/schema/discovery";
import { requireProjectScope } from "../projects/repository";
import { incrementStateVersion } from "../projects/state-version";
import { DiscoveryNotFoundError, DiscoveryValidationError } from "./errors";

export const DISCOVERY_STATUSES = ["UNKNOWN", "PARTIAL", "RESOLVED", "NOT_APPLICABLE"] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];

export const DISCOVERY_IMPACTS = ["HIGH", "MEDIUM", "LOW"] as const;
export type DiscoveryImpact = (typeof DISCOVERY_IMPACTS)[number];

// Seeded domains (tasks.md TASK-030, architecture.md §9, PRD FR-011).
// node_key is the stable slug used in queries; category is the human label.
export const DISCOVERY_DOMAINS = [
  {
    nodeKey: "product",
    category: "Product",
    title: "Product",
    description: "Problem, users, goals, scope.",
  },
  {
    nodeKey: "features",
    category: "Features",
    title: "Features",
    description: "Core features, workflows, business rules.",
  },
  {
    nodeKey: "access",
    category: "Access",
    title: "Access",
    description: "Authentication, roles, permissions.",
  },
  {
    nodeKey: "data",
    category: "Data",
    title: "Data",
    description: "Entities, relationships, lifecycle.",
  },
  {
    nodeKey: "ux",
    category: "UX",
    title: "UX",
    description: "Screens, flows, experience expectations.",
  },
  {
    nodeKey: "technical",
    category: "Technical",
    title: "Technical",
    description: "Architecture and stack constraints.",
  },
  {
    nodeKey: "integrations",
    category: "Integrations",
    title: "Integrations",
    description: "External services and APIs.",
  },
  { nodeKey: "ai", category: "AI", title: "AI", description: "AI behavior and model usage." },
  {
    nodeKey: "non_functional",
    category: "Non-Functional",
    title: "Non-Functional",
    description: "Performance, security, reliability.",
  },
] as const;
export type DiscoveryDomainKey = (typeof DISCOVERY_DOMAINS)[number]["nodeKey"];

export interface DiscoveryNodeRow {
  id: string;
  projectId: string;
  nodeKey: string;
  category: string;
  title: string;
  description: string | null;
  status: DiscoveryStatus;
  priority: number;
  impact: DiscoveryImpact | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkedDecision {
  id: string;
  decisionKey: string;
  decisionCode: string;
  title: string;
  status: string;
}

export interface UpdateDiscoveryNodeInput {
  status?: DiscoveryStatus;
  priority?: number;
  impact?: DiscoveryImpact | null;
  title?: string;
  description?: string | null;
  metadata?: unknown;
}

const MAX_NODE_KEY_LENGTH = 64;
const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 20000;
const NODE_KEY_PATTERN = /^[a-z0-9_]+$/;

function requireNodeKey(raw: string): string {
  const key = raw.trim();
  if (key === "") throw new DiscoveryValidationError("nodeKey is required.");
  if (key.length > MAX_NODE_KEY_LENGTH) {
    throw new DiscoveryValidationError(
      `nodeKey must be at most ${MAX_NODE_KEY_LENGTH} characters.`,
    );
  }
  if (!NODE_KEY_PATTERN.test(key)) {
    throw new DiscoveryValidationError("nodeKey must be a lowercase slug (e.g. access).");
  }
  return key;
}

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DiscoveryValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requirePriority(raw: number): number {
  if (!Number.isInteger(raw) || raw < 0) {
    throw new DiscoveryValidationError("priority must be an integer >= 0.");
  }
  return raw;
}

function optionalText(raw: string | null | undefined, field: string, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  if (text.length > max) {
    throw new DiscoveryValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireJsonSafe(value: unknown, field: string): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new DiscoveryValidationError(`${field} must be JSON-serializable.`);
  }
}

function toRow(raw: typeof discoveryNodes.$inferSelect): DiscoveryNodeRow {
  return {
    ...raw,
    status: raw.status as DiscoveryStatus,
    impact: (raw.impact ?? null) as DiscoveryImpact | null,
  };
}

async function loadScopedNode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  nodeKey: string,
): Promise<DiscoveryNodeRow> {
  const scope = await requireProjectScope(db, userId, projectId);
  const found = await db.query.discoveryNodes.findFirst({
    where: and(eq(discoveryNodes.projectId, scope.projectId), eq(discoveryNodes.nodeKey, nodeKey)),
  });
  if (!found) throw new DiscoveryNotFoundError();
  return toRow(found);
}

// Idempotent map initialization: inserts the nine seeded domains as UNKNOWN
// and returns the full map. One version bump only when rows were actually
// created — repeat calls are free (TASK-020: no meaningless increments).
export async function ensureDiscoveryMap(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<DiscoveryNodeRow[]> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, projectId);
    const existing = await tx.query.discoveryNodes.findMany({
      where: eq(discoveryNodes.projectId, scope.projectId),
    });
    const known = new Set(existing.map((row) => row.nodeKey));
    const missing = DISCOVERY_DOMAINS.filter((domain) => !known.has(domain.nodeKey));
    if (missing.length > 0) {
      try {
        await tx.insert(discoveryNodes).values(
          missing.map((domain) => ({
            projectId: scope.projectId,
            nodeKey: domain.nodeKey,
            category: domain.category,
            title: domain.title,
            description: domain.description,
            status: "UNKNOWN" as const,
          })),
        );
      } catch (error) {
        if (!isUniqueViolationError(error)) throw error;
        // Concurrent initializer won the race; fall through to the read.
      }
      await incrementStateVersion(tx, userId, scope.projectId);
    }
    const rows = await tx.query.discoveryNodes.findMany({
      where: eq(discoveryNodes.projectId, scope.projectId),
      orderBy: [asc(discoveryNodes.nodeKey)],
    });
    return rows.map(toRow);
  });
}

export async function getDiscoveryMap(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<DiscoveryNodeRow[]> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.discoveryNodes.findMany({
    where: eq(discoveryNodes.projectId, scope.projectId),
    orderBy: [asc(discoveryNodes.nodeKey)],
  });
  return rows.map(toRow);
}

export async function getDiscoveryNode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  nodeKey: string,
): Promise<DiscoveryNodeRow> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  return loadScopedNode(db, userId, projectId, requireNodeKey(nodeKey));
}

export async function updateDiscoveryNode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  nodeKey: string,
  raw: UpdateDiscoveryNodeInput,
): Promise<DiscoveryNodeRow> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const key = requireNodeKey(nodeKey);
  if (raw.status !== undefined) requireEnum(raw.status, DISCOVERY_STATUSES, "status");
  if (raw.priority !== undefined) requirePriority(raw.priority);
  if (raw.impact !== undefined && raw.impact !== null) {
    requireEnum(raw.impact, DISCOVERY_IMPACTS, "impact");
  }
  let title: string | undefined;
  if (raw.title !== undefined) {
    title = raw.title.trim();
    if (title === "") throw new DiscoveryValidationError("title is required.");
    if (title.length > MAX_TITLE_LENGTH) {
      throw new DiscoveryValidationError(`title must be at most ${MAX_TITLE_LENGTH} characters.`);
    }
  }
  const description =
    raw.description === undefined
      ? undefined
      : optionalText(raw.description, "description", MAX_DESCRIPTION_LENGTH);
  if (raw.metadata !== undefined) requireJsonSafe(raw.metadata, "metadata");
  const touches =
    raw.status !== undefined ||
    raw.priority !== undefined ||
    raw.impact !== undefined ||
    title !== undefined ||
    description !== undefined ||
    raw.metadata !== undefined;

  const current = await loadScopedNode(db, userId, projectId, key);
  if (!touches) return current;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(discoveryNodes)
      .set({
        ...(raw.status !== undefined ? { status: raw.status } : {}),
        ...(raw.priority !== undefined ? { priority: raw.priority } : {}),
        ...(raw.impact !== undefined ? { impact: raw.impact } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(raw.metadata !== undefined
          ? { metadata: (raw.metadata ?? null) as object | null }
          : {}),
      })
      .where(eq(discoveryNodes.id, current.id))
      .returning();
    if (!updated) throw new DiscoveryNotFoundError();
    await incrementStateVersion(tx, userId, current.projectId);
    return toRow(updated);
  });
}

// Associates an in-scope decision with an in-scope node. Both ends resolve
// inside the same project scope, so a cross-project link is unrepresentable.
export async function linkDecisionToNode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  nodeKey: string,
  decisionKey: string,
): Promise<{ nodeId: string; decisionId: string }> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const key = requireNodeKey(nodeKey);
  const decision = decisionKey.trim();
  if (decision === "") throw new DiscoveryValidationError("decisionKey is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const node = await db.query.discoveryNodes.findFirst({
    columns: { id: true },
    where: and(eq(discoveryNodes.projectId, scope.projectId), eq(discoveryNodes.nodeKey, key)),
  });
  if (!node) throw new DiscoveryNotFoundError();
  const target = await db.query.decisions.findFirst({
    columns: { id: true },
    where: and(eq(decisions.projectId, scope.projectId), eq(decisions.decisionKey, decision)),
  });
  if (!target) throw new DiscoveryNotFoundError("Decision does not exist in this project.");
  try {
    await db.insert(discoveryNodeDecisions).values({ nodeId: node.id, decisionId: target.id });
  } catch (error) {
    if (isUniqueViolationError(error)) {
      throw new DiscoveryValidationError("This decision is already linked to the node.");
    }
    throw error;
  }
  return { nodeId: node.id, decisionId: target.id };
}

export async function unlinkDecisionFromNode(
  db: AppDatabase,
  userId: string,
  projectId: string,
  nodeKey: string,
  decisionKey: string,
): Promise<void> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const key = requireNodeKey(nodeKey);
  const decision = decisionKey.trim();
  if (decision === "") throw new DiscoveryValidationError("decisionKey is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const node = await db.query.discoveryNodes.findFirst({
    columns: { id: true },
    where: and(eq(discoveryNodes.projectId, scope.projectId), eq(discoveryNodes.nodeKey, key)),
  });
  if (!node) throw new DiscoveryNotFoundError();
  const target = await db.query.decisions.findFirst({
    columns: { id: true },
    where: and(eq(decisions.projectId, scope.projectId), eq(decisions.decisionKey, decision)),
  });
  if (!target) throw new DiscoveryNotFoundError("Decision does not exist in this project.");
  const [removed] = await db
    .delete(discoveryNodeDecisions)
    .where(
      and(
        eq(discoveryNodeDecisions.nodeId, node.id),
        eq(discoveryNodeDecisions.decisionId, target.id),
      ),
    )
    .returning({ id: discoveryNodeDecisions.id });
  if (!removed) throw new DiscoveryNotFoundError("Link does not exist.");
}

export async function listNodeDecisions(
  db: AppDatabase,
  userId: string,
  projectId: string,
  nodeKey: string,
): Promise<LinkedDecision[]> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const node = await loadScopedNode(db, userId, projectId, requireNodeKey(nodeKey));
  const links = await db.query.discoveryNodeDecisions.findMany({
    where: eq(discoveryNodeDecisions.nodeId, node.id),
  });
  const out: LinkedDecision[] = [];
  for (const link of links) {
    const found = await db.query.decisions.findFirst({
      where: and(eq(decisions.projectId, node.projectId), eq(decisions.id, link.decisionId)),
    });
    if (found) {
      out.push({
        id: found.id,
        decisionKey: found.decisionKey,
        decisionCode: found.decisionCode,
        title: found.title,
        status: found.status,
      });
    }
  }
  return out.sort((a, b) => a.decisionCode.localeCompare(b.decisionCode));
}

export async function listDecisionNodes(
  db: AppDatabase,
  userId: string,
  projectId: string,
  decisionKey: string,
): Promise<DiscoveryNodeRow[]> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const decision = decisionKey.trim();
  if (decision === "") throw new DiscoveryValidationError("decisionKey is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const target = await db.query.decisions.findFirst({
    columns: { id: true },
    where: and(eq(decisions.projectId, scope.projectId), eq(decisions.decisionKey, decision)),
  });
  if (!target) throw new DiscoveryNotFoundError("Decision does not exist in this project.");
  const links = await db.query.discoveryNodeDecisions.findMany({
    where: eq(discoveryNodeDecisions.decisionId, target.id),
  });
  const out: DiscoveryNodeRow[] = [];
  for (const link of links) {
    const found = await db.query.discoveryNodes.findFirst({
      where: and(eq(discoveryNodes.projectId, scope.projectId), eq(discoveryNodes.id, link.nodeId)),
    });
    if (found) out.push(toRow(found));
  }
  return out.sort((a, b) => a.nodeKey.localeCompare(b.nodeKey));
}
