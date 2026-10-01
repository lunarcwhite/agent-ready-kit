// Proposed-change lifecycle (TASK-132, database-schema.md §35).
//
// AI-generated modifications wait here as PENDING rows before they may
// replace approved content: target, previous/proposed snapshots, and the
// human-readable reason. Accept applies the change and marks the proposal
// ACCEPTED inside one transaction; reject marks REJECTED and leaves the
// approved section byte-identical. A proposal created at state N whose
// project has since moved on is stale — accept refuses it instead of
// writing over newer state (non-destructive updates, AGENTS.md §39).
//
// MVP targets SPECIFICATION_SECTION rows only; the polymorphic shape
// reserves room for future targets. Every function resolves ownership
// through requireProjectScope first (TASK-014); proposals are derived
// review state, so no write here bumps the project state version.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import {
  proposedChanges,
  specificationDocuments,
  specificationSections,
} from "../../infrastructure/database/schema/specifications";
import { requireProjectScope } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { getSection, type SpecificationSectionRow } from "./documents";
import { SpecificationNotFoundError, SpecificationValidationError } from "./errors";

export const PROPOSAL_TARGET_TYPES = ["SPECIFICATION_SECTION"] as const;
export type ProposalTargetType = (typeof PROPOSAL_TARGET_TYPES)[number];

export const PROPOSAL_CHANGE_TYPES = ["UPDATE_CONTENT"] as const;
export type ProposalChangeType = (typeof PROPOSAL_CHANGE_TYPES)[number];

export const PROPOSAL_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ProposedChangeRow {
  id: string;
  projectId: string;
  targetType: ProposalTargetType;
  targetId: string;
  changeType: ProposalChangeType;
  previousContent: unknown;
  proposedContent: unknown;
  reason: string | null;
  baseStateVersion: number;
  status: ProposalStatus;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProposeSectionChangeInput {
  documentType: string;
  sectionKey: string;
  title?: string;
  renderedContent?: string;
  structuredContent?: unknown;
  reason: string;
}

const MAX_TITLE_LENGTH = 255;
const MAX_REASON_LENGTH = 2000;

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new SpecificationValidationError(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function requireJsonSafe(value: unknown, field: string): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new SpecificationValidationError(`${field} must be JSON-serializable.`);
  }
}

function toRow(raw: typeof proposedChanges.$inferSelect): ProposedChangeRow {
  return {
    ...raw,
    targetType: raw.targetType as ProposalTargetType,
    changeType: raw.changeType as ProposalChangeType,
    status: raw.status as ProposalStatus,
  };
}

async function loadScopedProposal(
  db: AppDatabase,
  userId: string,
  projectId: string,
  proposalId: string,
): Promise<ProposedChangeRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const rawId = proposalId.trim();
  if (rawId === "") throw new SpecificationValidationError("proposalId is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const [found] = await db
    .select()
    .from(proposedChanges)
    .where(and(eq(proposedChanges.projectId, scope.projectId), eq(proposedChanges.id, rawId)))
    .limit(1);
  if (!found) throw new SpecificationNotFoundError("Proposal not found.");
  return toRow(found);
}

export async function proposeSectionChange(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: ProposeSectionChangeInput,
): Promise<ProposedChangeRow> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const reason = raw.reason.trim();
  if (reason === "") throw new SpecificationValidationError("reason is required.");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new SpecificationValidationError(
      `reason must be at most ${MAX_REASON_LENGTH} characters.`,
    );
  }
  let title: string | undefined;
  if (raw.title !== undefined) {
    title = raw.title.trim();
    if (title === "") throw new SpecificationValidationError("title must not be blank.");
    if (title.length > MAX_TITLE_LENGTH) {
      throw new SpecificationValidationError(
        `title must be at most ${MAX_TITLE_LENGTH} characters.`,
      );
    }
  }
  const renderedContent = raw.renderedContent === undefined ? undefined : raw.renderedContent;
  if (renderedContent !== undefined && typeof renderedContent !== "string") {
    throw new SpecificationValidationError("renderedContent must be a string.");
  }
  if (raw.structuredContent !== undefined)
    requireJsonSafe(raw.structuredContent, "structuredContent");
  if (title === undefined && renderedContent === undefined && raw.structuredContent === undefined) {
    throw new SpecificationValidationError("Proposal must change at least one field.");
  }

  const scope = await requireProjectScope(db, userId, projectId);
  const section = await getSection(db, userId, scope.projectId, raw.documentType, raw.sectionKey);
  const baseStateVersion = await getStateVersion(db, userId, scope.projectId);

  const [inserted] = await db
    .insert(proposedChanges)
    .values({
      projectId: scope.projectId,
      targetType: "SPECIFICATION_SECTION",
      targetId: section.id,
      changeType: "UPDATE_CONTENT",
      previousContent: {
        title: section.title,
        renderedContent: section.renderedContent,
        structuredContent: section.structuredContent,
        status: section.status,
      },
      proposedContent: {
        title: title ?? section.title,
        renderedContent: renderedContent ?? section.renderedContent,
        structuredContent:
          raw.structuredContent === undefined ? section.structuredContent : raw.structuredContent,
      },
      reason,
      baseStateVersion,
    })
    .returning();
  if (!inserted) throw new SpecificationNotFoundError("Proposal creation failed.");
  return toRow(inserted);
}

export async function listProposals(
  db: AppDatabase,
  userId: string,
  projectId: string,
  status?: string,
): Promise<ProposedChangeRow[]> {
  if (userId.trim() === "") throw new SpecificationValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.proposedChanges.findMany({
    where:
      status === undefined
        ? eq(proposedChanges.projectId, scope.projectId)
        : and(
            eq(proposedChanges.projectId, scope.projectId),
            eq(proposedChanges.status, requireEnum(status, PROPOSAL_STATUSES, "status")),
          ),
    orderBy: [desc(proposedChanges.createdAt)],
  });
  return rows.map(toRow);
}

export async function getProposal(
  db: AppDatabase,
  userId: string,
  projectId: string,
  proposalId: string,
): Promise<ProposedChangeRow> {
  return loadScopedProposal(db, userId, projectId, proposalId);
}

// Stale when the canonical clock moved past the proposal's base version.
// Conservative by design: any canonical change after the proposal means the
// review happened against older state, so accept must refuse.
export async function isProposalStale(
  db: AppDatabase,
  userId: string,
  projectId: string,
  proposalId: string,
): Promise<boolean> {
  const proposal = await loadScopedProposal(db, userId, projectId, proposalId);
  const current = await getStateVersion(db, userId, proposal.projectId);
  return current !== proposal.baseStateVersion;
}

export async function acceptProposal(
  db: AppDatabase,
  userId: string,
  projectId: string,
  proposalId: string,
): Promise<{ proposal: ProposedChangeRow; section: SpecificationSectionRow }> {
  const proposal = await loadScopedProposal(db, userId, projectId, proposalId);
  if (proposal.status !== "PENDING") {
    throw new SpecificationValidationError(
      `Only PENDING proposals can be accepted (current: ${proposal.status}).`,
    );
  }
  if (proposal.targetType !== "SPECIFICATION_SECTION") {
    throw new SpecificationValidationError(`Unsupported proposal target "${proposal.targetType}".`);
  }
  const current = await getStateVersion(db, userId, proposal.projectId);
  if (current !== proposal.baseStateVersion) {
    throw new SpecificationValidationError(
      `Proposal is stale (base state v${proposal.baseStateVersion}, current v${current}); create a fresh proposal.`,
    );
  }
  const proposed = proposal.proposedContent as {
    title?: unknown;
    renderedContent?: unknown;
    structuredContent?: unknown;
  };
  const title = String(proposed.title ?? "").trim();
  const renderedContent =
    typeof proposed.renderedContent === "string" ? proposed.renderedContent : "";
  if (title === "") throw new SpecificationValidationError("Proposed title is invalid.");
  if (proposed.structuredContent !== undefined) {
    requireJsonSafe(proposed.structuredContent, "proposedContent.structuredContent");
  }

  // Atomic: the section update and the ACCEPTED marking commit together,
  // so a crash can never leave an applied change marked PENDING or a
  // marked proposal without its change. Reviewed content becomes CURRENT.
  return db.transaction(async (tx) => {
    const scope = await requireProjectScope(tx, userId, proposal.projectId);
    const docs = await tx.query.specificationDocuments.findMany({
      columns: { id: true },
      where: eq(specificationDocuments.projectId, scope.projectId),
    });
    if (docs.length === 0)
      throw new SpecificationNotFoundError("Proposal target no longer exists.");
    const [section] = await tx
      .select()
      .from(specificationSections)
      .where(
        and(
          eq(specificationSections.id, proposal.targetId),
          inArray(
            specificationSections.documentId,
            docs.map((doc) => doc.id),
          ),
        ),
      )
      .limit(1);
    if (!section) throw new SpecificationNotFoundError("Proposal target no longer exists.");
    const [updatedSection] = await tx
      .update(specificationSections)
      .set({
        title,
        renderedContent,
        structuredContent:
          proposed.structuredContent === undefined
            ? section.structuredContent
            : (proposed.structuredContent as object | null),
        status: "CURRENT",
      })
      .where(eq(specificationSections.id, section.id))
      .returning();
    if (!updatedSection) throw new SpecificationNotFoundError("Section update failed.");
    const [updatedProposal] = await tx
      .update(proposedChanges)
      .set({ status: "ACCEPTED", reviewedAt: new Date() })
      .where(eq(proposedChanges.id, proposal.id))
      .returning();
    if (!updatedProposal) throw new SpecificationNotFoundError("Proposal update failed.");
    return {
      proposal: toRow(updatedProposal),
      section: {
        ...updatedSection,
        status: updatedSection.status as SpecificationSectionRow["status"],
      },
    };
  });
}

export async function rejectProposal(
  db: AppDatabase,
  userId: string,
  projectId: string,
  proposalId: string,
): Promise<ProposedChangeRow> {
  const proposal = await loadScopedProposal(db, userId, projectId, proposalId);
  if (proposal.status !== "PENDING") {
    throw new SpecificationValidationError(
      `Only PENDING proposals can be rejected (current: ${proposal.status}).`,
    );
  }
  const [updated] = await db
    .update(proposedChanges)
    .set({ status: "REJECTED", reviewedAt: new Date() })
    .where(eq(proposedChanges.id, proposal.id))
    .returning();
  if (!updated) throw new SpecificationNotFoundError("Proposal update failed.");
  return toRow(updated);
}
