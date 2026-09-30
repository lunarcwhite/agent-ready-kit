// Product specification compiler output contract (TASK-062, agents.md A-010).
//
// Compiles canonical state into PROPOSED PRD sections — never applied
// documentation (review + createVersion approve). Two structural guarantees
// keep the compiler honest:
//
// - requirementCodes / knowledgeKeys are REFERENCES, not content: the
//   application resolves every code against its table and rejects unknown
//   ones, so the model can neither invent requirements nor silently drop
//   their priorities (structured content is rebuilt from the tables).
// - unknowns stay a first-class bucket: anything the canonical state does
//   not settle must appear there instead of being papered over in prose.
import type { FieldSchema } from "../validation/schema";

export const PRODUCT_COMPILATION_SCHEMA_ID = "product-compilation/v1";

export const PRODUCT_COMPILATION_SCHEMA: FieldSchema = {
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

export interface CompiledSection {
  key: string;
  title: string;
  body: string;
  requirementCodes?: string[];
  knowledgeKeys?: string[];
}

export interface CompiledUnknown {
  topic: string;
  detail: string;
}

export interface ProductCompilation {
  sections: CompiledSection[];
  unknowns: CompiledUnknown[];
}
