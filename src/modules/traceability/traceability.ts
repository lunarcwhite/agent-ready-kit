// Traceability graph service (TASK-024, FR-050, database-schema.md §44).
//
// Directed links between canonical artifacts: DECISION → REQUIREMENT,
// REQUIREMENT → (future ENT/ARC/SCREEN/TASK/KNOWLEDGE). The node-type
// registry below is the controlled vocabulary §67 demands — extend it as
// new artifact tables land; the storage columns stay untouched.
//
// Entry rule (TASK-014): every function resolves ownership through
// requireProjectScope first, and both endpoints are resolved WITHIN that
// scope — a cross-project link is unrepresentable, not merely rejected.
//
// Deliberately NOT versioned (TASK-020): links are bookkeeping about
// canonical state, not product meaning. Bumping the project version per
// link would thrash numbering during bulk planning (dozens of links per
// task plan). Coverage/readiness DERIVE from these links instead.
//
// Deleted/superseded endpoints: rows are never hard-deleted anywhere, so
// reads cannot dangle. Creation to REMOVED (withdrawn) requirements is
// rejected; SUPERSEDED rows stay linkable — frozen history must remain
// traceable.
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import { traceabilityLinks } from "../../infrastructure/database/schema/traceability";
import { decisions } from "../../infrastructure/database/schema/decisions";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { requireProjectScope } from "../projects/repository";
import { TraceabilityNotFoundError, TraceabilityValidationError } from "./errors";

// Node kinds with existence checks TODAY. Append-only registry: adding a
// kind means adding one case to resolveNode — no migration, no backfill.
export const TRACEABILITY_NODE_TYPES = ["DECISION", "REQUIREMENT"] as const;
export type TraceabilityNodeType = (typeof TRACEABILITY_NODE_TYPES)[number];

export interface TraceabilityNodeRef {
  type: TraceabilityNodeType;
  id: string;
}

export interface TraceabilityLinkRow {
  id: string;
  projectId: string;
  source: TraceabilityNodeRef;
  target: TraceabilityNodeRef;
  relationship: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLinkInput {
  source: { type: string; id: string };
  target: { type: string; id: string };
  relationship: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Lowercase snake_case relationships (implemented_by, uses, executed_by…).
// Shape-validated, not closed-enum: future capabilities coin new verbs
// without a code change; prose and casing variants are rejected.
const RELATIONSHIP_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

function requireNodeType(raw: string, field: string): TraceabilityNodeType {
  if (!(TRACEABILITY_NODE_TYPES as readonly string[]).includes(raw)) {
    throw new TraceabilityValidationError(
      `${field} must be one of ${TRACEABILITY_NODE_TYPES.join(", ")}.`,
    );
  }
  return raw as TraceabilityNodeType;
}

function requireNodeId(raw: string, field: string): string {
  const id = raw.trim();
  if (!UUID_PATTERN.test(id)) {
    throw new TraceabilityValidationError(`${field} must be a valid node ID.`);
  }
  return id;
}

function requireNode(raw: { type: string; id: string }, field: string): TraceabilityNodeRef {
  return {
    type: requireNodeType(raw.type, `${field}.type`),
    id: requireNodeId(raw.id, `${field}.id`),
  };
}

function requireRelationship(raw: string): string {
  const relationship = raw.trim();
  if (!RELATIONSHIP_PATTERN.test(relationship)) {
    throw new TraceabilityValidationError(
      "relationship must be lowercase snake_case, 2-64 characters (e.g. implemented_by).",
    );
  }
  return relationship;
}

// Confirms the node exists inside the scoped project and is linkable.
// Throws NotFound for missing/foreign nodes, Validation for withdrawn ones.
async function resolveNode(
  db: AppDatabase,
  projectId: string,
  node: TraceabilityNodeRef,
  field: string,
): Promise<void> {
  if (node.type === "DECISION") {
    const found = await db.query.decisions.findFirst({
      columns: { id: true },
      where: and(eq(decisions.projectId, projectId), eq(decisions.id, node.id)),
    });
    if (!found) throw new TraceabilityNotFoundError(`${field} decision does not exist.`);
    return;
  }
  const found = await db.query.requirements.findFirst({
    columns: { id: true, status: true },
    where: and(eq(requirements.projectId, projectId), eq(requirements.id, node.id)),
  });
  if (!found) throw new TraceabilityNotFoundError(`${field} requirement does not exist.`);
  if (found.status === "REMOVED") {
    throw new TraceabilityValidationError(
      `${field} requirement is withdrawn and cannot be linked.`,
    );
  }
}

function toRow(raw: typeof traceabilityLinks.$inferSelect): TraceabilityLinkRow {
  return {
    id: raw.id,
    projectId: raw.projectId,
    source: { type: raw.sourceType as TraceabilityNodeType, id: raw.sourceId },
    target: { type: raw.targetType as TraceabilityNodeType, id: raw.targetId },
    relationship: raw.relationshipType,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function createLink(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: CreateLinkInput,
): Promise<TraceabilityLinkRow> {
  if (userId.trim() === "") throw new TraceabilityValidationError("Owner is required.");
  const source = requireNode(raw.source, "source");
  const target = requireNode(raw.target, "target");
  const relationship = requireRelationship(raw.relationship);

  const scope = await requireProjectScope(db, userId, projectId);
  await resolveNode(db, scope.projectId, source, "source");
  await resolveNode(db, scope.projectId, target, "target");

  let inserted: typeof traceabilityLinks.$inferSelect | undefined;
  try {
    [inserted] = await db
      .insert(traceabilityLinks)
      .values({
        projectId: scope.projectId,
        sourceType: source.type,
        sourceId: source.id,
        targetType: target.type,
        targetId: target.id,
        relationshipType: relationship,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolationError(error)) {
      throw new TraceabilityValidationError("This link is already registered.");
    }
    throw error;
  }
  if (!inserted) throw new TraceabilityNotFoundError("Link creation failed.");
  return toRow(inserted);
}

export async function removeLink(
  db: AppDatabase,
  userId: string,
  projectId: string,
  linkId: string,
): Promise<void> {
  if (userId.trim() === "") throw new TraceabilityValidationError("Owner is required.");
  const id = requireNodeId(linkId, "linkId");
  const scope = await requireProjectScope(db, userId, projectId);
  const [removed] = await db
    .delete(traceabilityLinks)
    .where(and(eq(traceabilityLinks.id, id), eq(traceabilityLinks.projectId, scope.projectId)))
    .returning({ id: traceabilityLinks.id });
  if (!removed) throw new TraceabilityNotFoundError();
}

async function listScoped(
  db: AppDatabase,
  userId: string,
  projectId: string,
  node: { type: string; id: string },
  direction: "outgoing" | "incoming",
): Promise<TraceabilityLinkRow[]> {
  if (userId.trim() === "") throw new TraceabilityValidationError("Owner is required.");
  const ref = requireNode(node, "node");
  const scope = await requireProjectScope(db, userId, projectId);
  const side =
    direction === "outgoing"
      ? and(
          eq(traceabilityLinks.projectId, scope.projectId),
          eq(traceabilityLinks.sourceType, ref.type),
          eq(traceabilityLinks.sourceId, ref.id),
        )
      : and(
          eq(traceabilityLinks.projectId, scope.projectId),
          eq(traceabilityLinks.targetType, ref.type),
          eq(traceabilityLinks.targetId, ref.id),
        );
  const rows = await db.query.traceabilityLinks.findMany({
    where: side,
    orderBy: [asc(traceabilityLinks.createdAt)],
  });
  return rows.map(toRow);
}

export async function listOutgoingLinks(
  db: AppDatabase,
  userId: string,
  projectId: string,
  node: { type: string; id: string },
): Promise<TraceabilityLinkRow[]> {
  return listScoped(db, userId, projectId, node, "outgoing");
}

export async function listIncomingLinks(
  db: AppDatabase,
  userId: string,
  projectId: string,
  node: { type: string; id: string },
): Promise<TraceabilityLinkRow[]> {
  return listScoped(db, userId, projectId, node, "incoming");
}

export async function listProjectLinks(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<TraceabilityLinkRow[]> {
  if (userId.trim() === "") throw new TraceabilityValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.traceabilityLinks.findMany({
    where: eq(traceabilityLinks.projectId, scope.projectId),
    orderBy: [asc(traceabilityLinks.createdAt)],
  });
  return rows.map(toRow);
}
