// Initial Understanding Review domain (TASK-051, SCREEN-006, design.md §22).
//
// Deterministic projection of the TASK-050 Idea Analyst output into review
// sections, plus the confirmation that initializes canonical discovery
// state. No AI here: the analysis arrives as an argument, this module only
// shapes it for display and records the human's verdict.
//
// - buildUnderstandingView is pure: IdeaAnalysis in, labeled sections out.
//   Assumptions keep their impact rating and never merge into facts
//   (UX-INV-003, soul §8). Nothing the model produced is hidden: knowledge
//   that matches no known section lands in otherNotes instead of vanishing.
// - confirmUnderstanding initializes the Discovery Map idempotently
//   (ensureDiscoveryMap seeds once, later confirms are free reads with no
//   version bump). Correction reuses updateProject — the review page owns
//   the form, this module owns no writes beyond confirmation.
import type { AppDatabase } from "../../infrastructure/database/db";
import type { IdeaAnalysis } from "../../ai/schemas/idea-analysis";
import { ensureDiscoveryMap, type DiscoveryNodeRow } from "./discovery";
import { requireProjectScope } from "../projects/repository";
import { DiscoveryValidationError } from "./errors";

export interface UnderstandingNote {
  domain: string;
  statement: string;
}

export interface UnderstandingUnclear {
  domain: string;
  question: string;
}

export interface UnderstandingAssumption {
  statement: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  glyph: string;
}

export interface UnderstandingView {
  productSummary: string;
  productCategory: string;
  users: string[];
  capabilities: string[];
  constraints: string[];
  otherNotes: UnderstandingNote[];
  unclearAreas: UnderstandingUnclear[];
  assumptions: UnderstandingAssumption[];
}

const USER_PATTERN = /user|persona|customer|audience/i;
const CAPABILITY_PATTERN = /featur|capab|function|workflow|use.?case/i;
const CONSTRAINT_PATTERN = /constraint|non.?functional|limit|budget|cost|hosting|stack|technical/i;

export const ASSUMPTION_GLYPH: Record<UnderstandingAssumption["impact"], string> = {
  HIGH: "!",
  MEDIUM: "●",
  LOW: "○",
};

function statements(analysis: IdeaAnalysis): { domain: string; statement: string }[] {
  return analysis.candidateKnowledge.map((item) => ({
    domain: item.domain.trim() === "" ? "general" : item.domain,
    statement: item.statement,
  }));
}

export function buildUnderstandingView(analysis: IdeaAnalysis): UnderstandingView {
  const users: string[] = [];
  const capabilities: string[] = [];
  const constraints: string[] = [];
  const otherNotes: UnderstandingNote[] = [];
  for (const note of statements(analysis)) {
    if (USER_PATTERN.test(note.domain)) users.push(note.statement);
    else if (CAPABILITY_PATTERN.test(note.domain)) capabilities.push(note.statement);
    else if (CONSTRAINT_PATTERN.test(note.domain)) constraints.push(note.statement);
    else otherNotes.push(note);
  }
  return {
    productSummary: analysis.summary,
    productCategory: analysis.productCategory,
    users,
    capabilities,
    constraints,
    otherNotes,
    unclearAreas: analysis.unknownDomains.map((row) => ({
      domain: row.domain,
      question: row.question,
    })),
    assumptions: analysis.assumptions.map((row) => ({
      statement: row.statement,
      impact: row.impact,
      glyph: ASSUMPTION_GLYPH[row.impact],
    })),
  };
}

// Confirmation initializes canonical discovery state (TASK-051 acceptance):
// first confirm seeds the nine UNKNOWN nodes with one version bump, later
// confirms resolve to the existing map with no bump and no duplicates.
export async function confirmUnderstanding(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<DiscoveryNodeRow[]> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  if (projectId.trim() === "") throw new DiscoveryValidationError("projectId is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  return ensureDiscoveryMap(db, userId, scope.projectId);
}
