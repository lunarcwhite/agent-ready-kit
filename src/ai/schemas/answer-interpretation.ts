// Answer Interpreter output contract (TASK-053, agents.md A-003).
//
// Translates one natural-language discovery answer into structured
// CANDIDATE changes — never applied state (application belongs to
// TASK-054). Three categories stay structurally separate so downstream
// code cannot confuse them:
//
// - decisions: supported extractions with confidence EXPLICIT (directly
//   stated) or INFERRED (strongly implied). ASSUMED belongs below.
// - assumptions: plausible but weakly supported — never silently confirmed.
// - unresolved: topics the answer did not settle, kept explicit instead of
//   fabricated (soul §6).
//
// One answer may yield many decisions (FR-014 multi-decision extraction);
// decision keys stay dot-notation so TASK-054 can match them against the
// Decision registry, and unsupported keys are rejected at the service
// boundary rather than trusted.
import type { FieldSchema } from "../validation/schema";

export const ANSWER_INTERPRETATION_SCHEMA_ID = "answer-interpretation/v1";

export const ANSWER_INTERPRETATION_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1, maxLength: 128 },
          value: {
            type: ["string", "number", "integer", "boolean", "array", "object", "null"],
            required: false,
          },
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
    assumptions: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          statement: { type: "string", required: true, minLength: 1, maxLength: 1000 },
          impact: { type: "string", required: true, enum: ["HIGH", "MEDIUM", "LOW"] },
        },
        additionalProperties: false,
      },
    },
    unresolved: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          topic: { type: "string", required: true, minLength: 1, maxLength: 128 },
          question: { type: "string", required: true, minLength: 1, maxLength: 1000 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export interface InterpretedDecision {
  key: string;
  value?: string | number | boolean | unknown[] | Record<string, unknown> | null;
  confidence: "EXPLICIT" | "INFERRED";
  rationale?: string;
}

export interface InterpretedAssumption {
  statement: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
}

export interface InterpretedUnresolved {
  topic: string;
  question: string;
}

export interface AnswerInterpretation {
  decisions: InterpretedDecision[];
  assumptions: InterpretedAssumption[];
  unresolved: InterpretedUnresolved[];
}
