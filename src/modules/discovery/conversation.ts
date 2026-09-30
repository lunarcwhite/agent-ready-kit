// Discovery conversation persistence (TASK-033, database-schema.md §8–§9).
//
// Stores raw question/answer evidence: sessions group one run of discovery,
// messages carry role + text + validated metadata (topic node, AI operation
// reference, interpretation payload). History is evidence, never canonical
// state (AGENTS.md §33) — nothing here bumps the project state version.
//
// The AI operation reference stays a loose UUID: ai_operations lands in
// TASK-043, so no foreign key exists yet. It is format-validated only, never
// dereferenced. Interpretation output is validated as JSON-safe payload the
// interpreter (TASK-053) will own; this module only stores it.
import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { isUniqueViolationError } from "../../infrastructure/database/errors";
import {
  discoveryMessages,
  discoveryNodes,
  discoverySessions,
} from "../../infrastructure/database/schema/discovery";
import { requireProjectScope } from "../projects/repository";
import { DiscoveryNotFoundError, DiscoveryValidationError } from "./errors";

export const DISCOVERY_SESSION_STATUSES = ["ACTIVE", "COMPLETED", "ABANDONED"] as const;
export type DiscoverySessionStatus = (typeof DISCOVERY_SESSION_STATUSES)[number];

export const DISCOVERY_MESSAGE_ROLES = ["USER", "ASSISTANT", "SYSTEM"] as const;
export type DiscoveryMessageRole = (typeof DISCOVERY_MESSAGE_ROLES)[number];

export interface DiscoverySessionRow {
  id: string;
  projectId: string;
  status: DiscoverySessionStatus;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscoveryRecommendation {
  optionLabel: string;
  rationale: string;
}

export interface DiscoveryMessageMetadata {
  nodeKey?: string;
  aiOperationId?: string;
  options?: string[];
  recommendation?: DiscoveryRecommendation;
  interpretation?: unknown;
}

export interface DiscoveryMessageRow {
  id: string;
  sessionId: string;
  role: DiscoveryMessageRole;
  content: string;
  sequenceNumber: number;
  metadata: DiscoveryMessageMetadata | null;
  createdAt: Date;
}

export interface AppendMessageInput {
  role: DiscoveryMessageRole;
  content: string;
  nodeKey?: string;
  aiOperationId?: string;
  options?: string[];
  recommendation?: DiscoveryRecommendation;
  interpretation?: unknown;
}

const MAX_CONTENT_LENGTH = 20000;
const MAX_NODE_KEY_LENGTH = 64;
const NODE_KEY_PATTERN = /^[a-z0-9_]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DiscoveryValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireUuid(raw: string, field: string): string {
  const id = raw.trim();
  if (!UUID_PATTERN.test(id)) {
    throw new DiscoveryValidationError(`${field} must be a valid ID.`);
  }
  return id;
}

function requireContent(raw: string): string {
  const content = raw.trim();
  if (content === "") throw new DiscoveryValidationError("content is required.");
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new DiscoveryValidationError(`content must be at most ${MAX_CONTENT_LENGTH} characters.`);
  }
  return content;
}

function requireJsonSafe(value: unknown, field: string): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new DiscoveryValidationError(`${field} must be JSON-serializable.`);
  }
}

const MAX_OPTION_LABEL_LENGTH = 200;
const MAX_OPTIONS = 8;
const MAX_RATIONALE_LENGTH = 2000;

function requireOptions(raw: string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw.length === 0 || raw.length > MAX_OPTIONS) {
    throw new DiscoveryValidationError(`options must list 1 to ${MAX_OPTIONS} choices.`);
  }
  const cleaned = raw.map((item) => {
    if (typeof item !== "string") {
      throw new DiscoveryValidationError("options must be non-empty strings.");
    }
    const label = item.trim();
    if (label === "" || label.length > MAX_OPTION_LABEL_LENGTH) {
      throw new DiscoveryValidationError(
        `options must be non-empty strings of at most ${MAX_OPTION_LABEL_LENGTH} characters.`,
      );
    }
    return label;
  });
  if (new Set(cleaned).size !== cleaned.length) {
    throw new DiscoveryValidationError("options must not repeat the same choice.");
  }
  return cleaned;
}

function requireRecommendation(
  raw: DiscoveryRecommendation | undefined,
  options: string[] | undefined,
): DiscoveryRecommendation | undefined {
  if (raw === undefined) return undefined;
  const optionLabel = raw.optionLabel.trim();
  const rationale = raw.rationale.trim();
  if (optionLabel === "" || rationale === "") {
    throw new DiscoveryValidationError("recommendation needs an option and its rationale.");
  }
  if (optionLabel.length > MAX_OPTION_LABEL_LENGTH || rationale.length > MAX_RATIONALE_LENGTH) {
    throw new DiscoveryValidationError("recommendation fields are too long.");
  }
  // A recommendation the user can never select is a pre-decision, not help:
  // it must resolve to one of the offered options.
  if (options === undefined || !options.includes(optionLabel)) {
    throw new DiscoveryValidationError("recommendation must match one of the offered options.");
  }
  return { optionLabel, rationale };
}

function parseMetadata(raw: unknown): DiscoveryMessageMetadata | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  const out: DiscoveryMessageMetadata = {};
  if (typeof meta.node_key === "string") out.nodeKey = meta.node_key;
  if (typeof meta.ai_operation_id === "string") out.aiOperationId = meta.ai_operation_id;
  if (Array.isArray(meta.options)) {
    const options = meta.options.filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    );
    if (options.length > 0) out.options = options;
  }
  if (
    typeof meta.recommendation === "object" &&
    meta.recommendation !== null &&
    !Array.isArray(meta.recommendation)
  ) {
    const rec = meta.recommendation as Record<string, unknown>;
    if (typeof rec.option_label === "string" && typeof rec.rationale === "string") {
      out.recommendation = { optionLabel: rec.option_label, rationale: rec.rationale };
    }
  }
  if (meta.interpretation !== undefined) out.interpretation = meta.interpretation;
  return Object.keys(out).length > 0 ? out : null;
}

function toSessionRow(raw: typeof discoverySessions.$inferSelect): DiscoverySessionRow {
  return { ...raw, status: raw.status as DiscoverySessionStatus };
}

function toMessageRow(raw: typeof discoveryMessages.$inferSelect): DiscoveryMessageRow {
  return {
    ...raw,
    role: raw.role as DiscoveryMessageRole,
    metadata: parseMetadata(raw.metadata),
  };
}

// Resolves a session strictly inside the caller's project scope: a session
// id from another project (or user) is NotFound, never a leak.
async function loadScopedSession(
  db: AppDatabase,
  userId: string,
  projectId: string,
  sessionId: string,
): Promise<DiscoverySessionRow> {
  const scope = await requireProjectScope(db, userId, projectId);
  const found = await db.query.discoverySessions.findFirst({
    where: and(
      eq(discoverySessions.id, requireUuid(sessionId, "sessionId")),
      eq(discoverySessions.projectId, scope.projectId),
    ),
  });
  if (!found) throw new DiscoveryNotFoundError("Discovery session not found.");
  return toSessionRow(found);
}

export async function startDiscoverySession(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<DiscoverySessionRow> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const [inserted] = await db
    .insert(discoverySessions)
    .values({ projectId: scope.projectId })
    .returning();
  if (!inserted) throw new DiscoveryNotFoundError("Session creation failed.");
  return toSessionRow(inserted);
}

export async function listDiscoverySessions(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<DiscoverySessionRow[]> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.discoverySessions.findMany({
    where: eq(discoverySessions.projectId, scope.projectId),
    orderBy: [desc(discoverySessions.createdAt)],
  });
  return rows.map(toSessionRow);
}

export async function endDiscoverySession(
  db: AppDatabase,
  userId: string,
  projectId: string,
  sessionId: string,
  status: "COMPLETED" | "ABANDONED",
): Promise<DiscoverySessionRow> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  requireEnum(status, ["COMPLETED", "ABANDONED"] as const, "status");
  const session = await loadScopedSession(db, userId, projectId, sessionId);
  if (session.status !== "ACTIVE") {
    throw new DiscoveryValidationError(`A ${session.status} session cannot be ended again.`);
  }
  const [updated] = await db
    .update(discoverySessions)
    .set({ status, completedAt: new Date() })
    .where(eq(discoverySessions.id, session.id))
    .returning();
  if (!updated) throw new DiscoveryNotFoundError("Discovery session not found.");
  return toSessionRow(updated);
}

export async function appendDiscoveryMessage(
  db: AppDatabase,
  userId: string,
  projectId: string,
  sessionId: string,
  raw: AppendMessageInput,
): Promise<DiscoveryMessageRow> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const role = requireEnum(raw.role, DISCOVERY_MESSAGE_ROLES, "role");
  const content = requireContent(raw.content);
  let nodeKey: string | undefined;
  if (raw.nodeKey !== undefined) {
    nodeKey = raw.nodeKey.trim();
    if (nodeKey === "" || nodeKey.length > MAX_NODE_KEY_LENGTH || !NODE_KEY_PATTERN.test(nodeKey)) {
      throw new DiscoveryValidationError("nodeKey must be a lowercase slug (e.g. access).");
    }
  }
  let aiOperationId: string | undefined;
  if (raw.aiOperationId !== undefined) {
    aiOperationId = requireUuid(raw.aiOperationId, "aiOperationId");
  }
  if (raw.interpretation !== undefined) requireJsonSafe(raw.interpretation, "interpretation");
  const options = requireOptions(raw.options);
  const recommendation = requireRecommendation(raw.recommendation, options);

  return db.transaction(async (tx) => {
    const session = await loadScopedSession(tx, userId, projectId, sessionId);
    if (session.status !== "ACTIVE") {
      throw new DiscoveryValidationError(`Cannot append to a ${session.status} session.`);
    }
    if (nodeKey !== undefined) {
      const node = await tx.query.discoveryNodes.findFirst({
        columns: { id: true },
        where: and(
          eq(discoveryNodes.projectId, session.projectId),
          eq(discoveryNodes.nodeKey, nodeKey),
        ),
      });
      if (!node) throw new DiscoveryNotFoundError("Discovery node does not exist in this project.");
    }
    const [latest] = await tx.query.discoveryMessages.findMany({
      columns: { sequenceNumber: true },
      where: eq(discoveryMessages.sessionId, session.id),
      orderBy: [desc(discoveryMessages.sequenceNumber)],
      limit: 1,
    });
    const metadata: Record<string, unknown> = {};
    if (nodeKey !== undefined) metadata.node_key = nodeKey;
    if (aiOperationId !== undefined) metadata.ai_operation_id = aiOperationId;
    if (options !== undefined) metadata.options = options;
    if (recommendation !== undefined) {
      metadata.recommendation = {
        option_label: recommendation.optionLabel,
        rationale: recommendation.rationale,
      };
    }
    if (raw.interpretation !== undefined) metadata.interpretation = raw.interpretation;
    try {
      const [inserted] = await tx
        .insert(discoveryMessages)
        .values({
          sessionId: session.id,
          role,
          content,
          sequenceNumber: (latest?.sequenceNumber ?? 0) + 1,
          metadata: Object.keys(metadata).length > 0 ? metadata : null,
        })
        .returning();
      if (!inserted) throw new DiscoveryNotFoundError("Message persistence failed.");
      return toMessageRow(inserted);
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new DiscoveryValidationError("Message sequence clash, retry the operation.");
      }
      throw error;
    }
  });
}

export async function listDiscoveryMessages(
  db: AppDatabase,
  userId: string,
  projectId: string,
  sessionId: string,
): Promise<DiscoveryMessageRow[]> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const session = await loadScopedSession(db, userId, projectId, sessionId);
  const rows = await db.query.discoveryMessages.findMany({
    where: eq(discoveryMessages.sessionId, session.id),
    orderBy: [asc(discoveryMessages.sequenceNumber)],
  });
  return rows.map(toMessageRow);
}
