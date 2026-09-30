// Data specification compiler output contract (TASK-064, agents.md A-012).
//
// Compiles canonical state into PROPOSED DATABASE_SCHEMA sections — never
// applied documentation (review + createVersion approve). Three structural
// guarantees keep the compiler honest:
//
// - requirementCodes / knowledgeKeys / entityCodes are REFERENCES, not
//   content: the application resolves every code against its table and
//   rejects unknown ones, so the model can neither invent requirements nor
//   fabricate ENT identifiers (structured content is rebuilt from tables).
// - unknowns stay a first-class bucket: unresolved persistence questions
//   and anything the canonical state does not settle must appear there
//   instead of being papered over in prose as if decided.
// - domain ≠ persistence (agents.md §23): sections map domain entities to
//   explicit persistence structures (tables, fields, relationships,
//   constraints, indexes, ownership, lifecycle) and prose stays PROPOSED
//   until human review approves it.
import type { FieldSchema } from "../validation/schema";

export const DATA_COMPILATION_SCHEMA_ID = "data-compilation/v1";

export const DATA_COMPILATION_SCHEMA: FieldSchema = {
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
          entityCodes: {
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

export interface CompiledDataSection {
  key: string;
  title: string;
  body: string;
  requirementCodes?: string[];
  knowledgeKeys?: string[];
  entityCodes?: string[];
}

export interface CompiledDataUnknown {
  topic: string;
  detail: string;
}

export interface DataCompilation {
  sections: CompiledDataSection[];
  unknowns: CompiledDataUnknown[];
}
