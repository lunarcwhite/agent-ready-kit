// Idea Analyst structured output contract (TASK-050, agents.md A-001, FR-002).
//
// The Idea Analyst (A-001) transforms the initial project input into an
// initial structured understanding. Output is PROPOSAL-ONLY: candidate
// decisions carry confidence (EXPLICIT/INFERRED) but never a CONFIRMED
// status, assumptions stay in their own array, and unknowns stay explicit.
// The application — never the model — decides what becomes canonical state
// (TASK-054 reviews, TASK-051 confirmation). This schema is the enforcement
// point: the orchestrator (TASK-045) rejects anything that does not match
// before downstream code ever sees it.
import type { FieldSchema } from "../validation/schema";

export const IDEA_ANALYSIS_SCHEMA_ID = "idea-analysis/v1";

export const IDEA_ANALYSIS_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    summary: { type: "string", required: true, minLength: 1, maxLength: 5000 },
    productCategory: { type: "string", required: true, minLength: 1, maxLength: 200 },
    knownFacts: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          statement: { type: "string", required: true, minLength: 1, maxLength: 1000 },
          evidence: { type: "string", required: false, maxLength: 1000 },
        },
        additionalProperties: false,
      },
    },
    candidateKnowledge: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          domain: { type: "string", required: true, minLength: 1, maxLength: 64 },
          statement: { type: "string", required: true, minLength: 1, maxLength: 1000 },
        },
        additionalProperties: false,
      },
    },
    candidateDecisions: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1, maxLength: 128 },
          title: { type: "string", required: true, minLength: 1, maxLength: 255 },
          // Proposal-only: EXPLICIT = directly stated, INFERRED = strongly
          // implied. ASSUMED belongs in `assumptions`, CONFIRMED is never
          // emitted by the model — confirmation is a human/application act.
          confidence: {
            type: "string",
            required: true,
            enum: ["EXPLICIT", "INFERRED"],
          },
          rationale: { type: "string", required: false, maxLength: 2000 },
        },
        additionalProperties: false,
      },
    },
    unknownDomains: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          domain: { type: "string", required: true, minLength: 1, maxLength: 64 },
          question: { type: "string", required: true, minLength: 1, maxLength: 1000 },
        },
        additionalProperties: false,
      },
    },
    assumptions: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          statement: { type: "string", required: true, minLength: 1, maxLength: 1000 },
          impact: { type: "string", required: true, enum: ["HIGH", "MEDIUM", "LOW"] },
          rationale: { type: "string", required: false, maxLength: 2000 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export interface IdeaKnownFact {
  statement: string;
  evidence?: string;
}

export interface IdeaCandidateKnowledge {
  domain: string;
  statement: string;
}

export interface IdeaCandidateDecision {
  key: string;
  title: string;
  confidence: "EXPLICIT" | "INFERRED";
  rationale?: string;
}

export interface IdeaUnknownDomain {
  domain: string;
  question: string;
}

export interface IdeaAssumption {
  statement: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  rationale?: string;
}

export interface IdeaAnalysis {
  summary: string;
  productCategory: string;
  knownFacts: IdeaKnownFact[];
  candidateKnowledge: IdeaCandidateKnowledge[];
  candidateDecisions: IdeaCandidateDecision[];
  unknownDomains: IdeaUnknownDomain[];
  assumptions: IdeaAssumption[];
}
