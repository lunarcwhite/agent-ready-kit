// Product agent specification compiler output contract (TASK-066, agents.md A-014).
//
// Compiles canonical state into PROPOSED PRODUCT_AGENTS sections — the
// target product's own AI agents, never Agent Ready Kit internals. Two
// structural guarantees keep the compiler honest:
//
// - requirementCodes / knowledgeKeys are REFERENCES, not content: the
//   application resolves every code against its table and rejects unknown
//   ones, so the model can neither invent requirements nor silently drop
//   their priorities (structured content is rebuilt from the tables).
// - agent roles carry explicit boundaries BY SCHEMA: every section must
//   declare its agent's name, objective, boundaries (non-empty), inputs,
//   and outputs. A role without stated boundaries fails validation instead
//   of shipping as vague prose.
import type { FieldSchema } from "../validation/schema";

export const PRODUCT_AGENTS_COMPILATION_SCHEMA_ID = "product-agents-compilation/v1";

const NON_EMPTY_STRING: FieldSchema = { type: "string", required: true, minLength: 1 };

export const PRODUCT_AGENTS_COMPILATION_SCHEMA: FieldSchema = {
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
          agent: {
            type: "object",
            required: true,
            properties: {
              name: { type: "string", required: true, minLength: 1, maxLength: 128 },
              objective: { type: "string", required: true, minLength: 1, maxLength: 2000 },
              boundaries: {
                type: "array",
                required: true,
                items: { ...NON_EMPTY_STRING, maxLength: 1000 },
              },
              inputs: {
                type: "array",
                required: true,
                items: { ...NON_EMPTY_STRING, maxLength: 1000 },
              },
              outputs: {
                type: "array",
                required: true,
                items: { ...NON_EMPTY_STRING, maxLength: 1000 },
              },
            },
            additionalProperties: false,
          },
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

export interface ProductAgentDefinition {
  name: string;
  objective: string;
  boundaries: string[];
  inputs: string[];
  outputs: string[];
}

export interface ProductAgentsSection {
  key: string;
  title: string;
  body: string;
  agent: ProductAgentDefinition;
  requirementCodes?: string[];
  knowledgeKeys?: string[];
}

export interface ProductAgentsUnknown {
  topic: string;
  detail: string;
}

export interface ProductAgentsCompilation {
  sections: ProductAgentsSection[];
  unknowns: ProductAgentsUnknown[];
}
