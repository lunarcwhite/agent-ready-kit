// Soul specification compiler output contract (TASK-067, agents.md A-015).
//
// Compiles confirmed project intent into PROPOSED SOUL sections — the target
// product's behavioral principles and personality, never its technical
// architecture. Structural guarantee: every section must declare at least
// one behavioral principle. The schema deliberately carries NO technical
// fields (no inputs, outputs, tools, endpoints), so the model cannot satisfy
// this contract by restating agents.md content in different words —
// technical duplication fails structurally, and the remaining semantic
// overlap is caught at human review (sections stay PROPOSED until approved).
import type { FieldSchema } from "../validation/schema";

export const SOUL_COMPILATION_SCHEMA_ID = "soul-compilation/v1";

export const SOUL_COMPILATION_SCHEMA: FieldSchema = {
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
          principles: {
            type: "array",
            required: true,
            items: { type: "string", required: true, minLength: 1, maxLength: 1000 },
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

export interface SoulSection {
  key: string;
  title: string;
  body: string;
  principles: string[];
  requirementCodes?: string[];
  knowledgeKeys?: string[];
}

export interface SoulUnknown {
  topic: string;
  detail: string;
}

export interface SoulCompilation {
  sections: SoulSection[];
  unknowns: SoulUnknown[];
}
