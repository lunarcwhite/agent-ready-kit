// Discovery Interviewer output contract (TASK-052, agents.md A-002).
//
// The Interviewer formulates ONE question for the topic the application
// selected (TASK-032 prioritization) — it never reorders the Discovery Map.
// Output is proposal-only: a concise question, meaningful options, and an
// optional recommendation that is structurally distinct from the options
// themselves and always carries its rationale (design.md §27, soul §12).
// Custom answers stay possible because the UI always renders a free-text
// composer alongside options (TASK-034) — nothing here can close that path.
import type { FieldSchema } from "../validation/schema";

export const DISCOVERY_QUESTION_SCHEMA_ID = "discovery-question/v1";

export const DISCOVERY_QUESTION_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    question: { type: "string", required: true, minLength: 1, maxLength: 1000 },
    options: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          label: { type: "string", required: true, minLength: 1, maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
    // Optional but all-or-nothing: a recommendation without a rationale is
    // a pre-decision (soul §12), so both fields are required together.
    recommendation: {
      type: "object",
      required: false,
      properties: {
        optionLabel: { type: "string", required: true, minLength: 1, maxLength: 200 },
        rationale: { type: "string", required: true, minLength: 1, maxLength: 1000 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export interface DiscoveryQuestionOption {
  label: string;
}

export interface DiscoveryQuestionRecommendation {
  optionLabel: string;
  rationale: string;
}

export interface DiscoveryQuestion {
  question: string;
  options: DiscoveryQuestionOption[];
  recommendation?: DiscoveryQuestionRecommendation;
}
