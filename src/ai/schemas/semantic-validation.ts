// Semantic Validator output contract (TASK-073, agents.md A-020, FR-061).
//
// One orchestrated call compares every selected specification pair and
// returns candidate contradictions. Candidates only: the service layer
// (validation/semantic.ts) validates, suppresses noise, and persists —
// model output never touches canonical state directly (AGENT-IMPL-INV-001).
//
// Noise discipline (agents.md §32) is structural: every finding must cite
// its sources (document + section) and carry a confidence. LOW-confidence
// findings are suppressed by the service, never persisted.
import type { FieldSchema } from "../validation/schema";

export const SEMANTIC_VALIDATION_SCHEMA_ID = "semantic-validation/v1";

export const SEMANTIC_VALIDATION_SEVERITIES = ["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type SemanticSeverity = (typeof SEMANTIC_VALIDATION_SEVERITIES)[number];

export const SEMANTIC_VALIDATION_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type SemanticConfidence = (typeof SEMANTIC_VALIDATION_CONFIDENCES)[number];

export const SEMANTIC_VALIDATION_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          title: { type: "string", required: true, minLength: 1, maxLength: 255 },
          description: { type: "string", required: true, minLength: 1, maxLength: 5000 },
          severity: { type: "string", required: true, enum: [...SEMANTIC_VALIDATION_SEVERITIES] },
          confidence: {
            type: "string",
            required: true,
            enum: [...SEMANTIC_VALIDATION_CONFIDENCES],
          },
          pair: { type: "string", required: true, minLength: 1, maxLength: 64 },
          sources: {
            type: "array",
            required: true,
            items: {
              type: "object",
              required: true,
              properties: {
                documentType: { type: "string", required: true, minLength: 1, maxLength: 32 },
                sectionKey: { type: "string", required: true, minLength: 1, maxLength: 256 },
              },
              additionalProperties: false,
            },
          },
          suggestedResolution: { type: "string", required: false, maxLength: 2000 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export interface SemanticSource {
  documentType: string;
  sectionKey: string;
}

export interface SemanticIssue {
  title: string;
  description: string;
  severity: SemanticSeverity;
  confidence: SemanticConfidence;
  pair: string;
  sources: SemanticSource[];
  suggestedResolution?: string;
}

export interface SemanticValidation {
  issues: SemanticIssue[];
}
