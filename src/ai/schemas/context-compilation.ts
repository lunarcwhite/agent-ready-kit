// Context compiler output contract (TASK-100, agents.md A-040, FR-110).
//
// Compiles approved project state into the PROPOSED CONTEXT sections that
// become the export `context.md` — a compact coding-agent bootstrap, never
// a second PRD. Structural guarantees for the "concise, no full-PRD-dupe"
// acceptance criteria: section bodies are capped at 2000 characters each,
// so even a maximal proposal stays a bootstrap (roughly one page per
// section at most). Anything the approved state does not settle belongs in
// unknowns, never in prose as if decided (AC "unknowns are not invented").
import type { FieldSchema } from "../validation/schema";

export const CONTEXT_COMPILATION_SCHEMA_ID = "context-compilation/v1";

export const MAX_CONTEXT_SECTION_BODY_LENGTH = 2000;

export const CONTEXT_COMPILATION_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1, maxLength: 128 },
          body: {
            type: "string",
            required: true,
            minLength: 1,
            maxLength: MAX_CONTEXT_SECTION_BODY_LENGTH,
          },
          knowledgeKeys: {
            type: "array",
            required: false,
            items: { type: "string", required: true, minLength: 1, maxLength: 128 },
          },
          requirementCodes: {
            type: "array",
            required: false,
            items: { type: "string", required: true, minLength: 1, maxLength: 16 },
          },
        },
        additionalProperties: false,
      },
    },
    unknowns: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          topic: { type: "string", required: true, minLength: 1, maxLength: 255 },
          detail: { type: "string", required: true, minLength: 1, maxLength: 2000 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export interface ContextSection {
  key: string;
  body: string;
  knowledgeKeys?: string[];
  requirementCodes?: string[];
}

export interface ContextUnknown {
  topic: string;
  detail: string;
}

export interface ContextCompilation {
  sections: ContextSection[];
  unknowns: ContextUnknown[];
}
