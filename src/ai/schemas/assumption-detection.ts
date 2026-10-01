// Assumption Analyzer output contract (TASK-075, agents.md A-021, FR-064).
//
// Surfaces hidden implementation-relevant unknowns as candidate
// assumptions. Candidates only: the service layer
// (validation/assumption-analyzer.ts) grounds references, drops cosmetic
// areas, normalizes duplicates, and persists — model output never touches
// canonical state directly (AGENT-IMPL-INV-001).
//
// Cosmetic discipline (agents.md §34) is structural: every finding names
// an `area`, and only implementation-relevant areas survive the service
// filter. Cosmetic unknowns arrive as area OTHER and are dropped, never
// persisted.
import type { FieldSchema } from "../validation/schema";

export const ASSUMPTION_DETECTION_SCHEMA_ID = "assumption-detection/v1";

export const ASSUMPTION_DETECTION_AREAS = [
  "ARCHITECTURE",
  "DATA_MODEL",
  "SECURITY",
  "BUSINESS_BEHAVIOR",
  "USER_FLOW",
  "IMPLEMENTATION_SCOPE",
  "EXTERNAL_INTEGRATION",
  "COST",
  "OTHER",
] as const;
export type AssumptionDetectionArea = (typeof ASSUMPTION_DETECTION_AREAS)[number];

export const ASSUMPTION_DETECTION_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    assumptions: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          statement: { type: "string", required: true, minLength: 1, maxLength: 1000 },
          impact: { type: "string", required: true, enum: ["HIGH", "MEDIUM", "LOW"] },
          confidence: { type: "string", required: true, enum: ["HIGH", "MEDIUM", "LOW"] },
          area: { type: "string", required: true, enum: [...ASSUMPTION_DETECTION_AREAS] },
          requirementCodes: {
            type: "array",
            required: false,
            items: { type: "string", required: true, minLength: 1, maxLength: 16 },
          },
          decisionKeys: {
            type: "array",
            required: false,
            items: { type: "string", required: true, minLength: 1, maxLength: 128 },
          },
          suggestedCheck: { type: "string", required: false, maxLength: 2000 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export interface DetectedAssumption {
  statement: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  area: AssumptionDetectionArea;
  requirementCodes?: string[];
  decisionKeys?: string[];
  suggestedCheck?: string;
}

export interface AssumptionDetection {
  assumptions: DetectedAssumption[];
}
