// Design specification compiler output contract (TASK-065, agents.md A-013).
//
// Compiles canonical state into PROPOSED DESIGN sections — never applied
// documentation (review + createVersion approve). Three structural guarantees
// keep the compiler honest:
//
// - requirementCodes / knowledgeKeys / screenCodes are REFERENCES, not
//   content: the application resolves every code against its table and rejects
//   unknown ones, so the model can neither invent requirements nor silently
//   drop priorities nor fabricate SCREEN identifiers (structured content is
//   rebuilt from the tables).
// - unknowns stay a first-class bucket: unresolved design questions and
//   anything the canonical state does not settle must appear there instead of
//   being papered over in prose as if decided.
// - no invented behavior: the prompt forbids inventing product behavior, and
//   prose stays PROPOSED until human review approves it.
import type { FieldSchema } from "../validation/schema";

export const DESIGN_COMPILATION_SCHEMA_ID = "design-compilation/v1";

export const DESIGN_COMPILATION_SCHEMA: FieldSchema = {
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
          title: { type: "string", required: true, minLength: 1, maxLength: 255 },
          body: { type: "string", required: true, minLength: 1, maxLength: 50000 },
          requirementCodes: {
            type: "array",
            required: false,
            items: { type: "string", required: true, minLength: 1, maxLength: 16 },
          },
          knowledgeKeys: {
            type: "array",
            required: false,
            items: { type: "string", required: true, minLength: 1, maxLength: 128 },
          },
          screenCodes: {
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

export interface CompiledDesignSection {
  key: string;
  title: string;
  body: string;
  requirementCodes?: string[];
  knowledgeKeys?: string[];
  screenCodes?: string[];
}

export interface CompiledDesignUnknown {
  topic: string;
  detail: string;
}

export interface DesignCompilation {
  sections: CompiledDesignSection[];
  unknowns: CompiledDesignUnknown[];
}
