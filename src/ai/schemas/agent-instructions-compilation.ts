// Agent-instruction compiler output contract (TASK-101, agents.md A-041,
// FR-111).
//
// Compiles approved project state into the PROPOSED AGENT_INSTRUCTIONS
// sections that become the export root `AGENTS.md` — instructions for the
// EXTERNAL coding agent working on the project, never a description of the
// target product's own AI (that lives in docs/agents.md). Bodies are capped
// at 3000 characters each: instructions must stay skimmable working rules,
// not essays. Anything the approved state does not settle belongs in
// unknowns, never in prose as if decided.
import type { FieldSchema } from "../validation/schema";

export const AGENT_INSTRUCTIONS_COMPILATION_SCHEMA_ID = "agent-instructions-compilation/v1";

export const MAX_AGENT_INSTRUCTIONS_SECTION_BODY_LENGTH = 3000;

export const AGENT_INSTRUCTIONS_COMPILATION_SCHEMA: FieldSchema = {
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
            maxLength: MAX_AGENT_INSTRUCTIONS_SECTION_BODY_LENGTH,
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

export interface AgentInstructionsSection {
  key: string;
  body: string;
  knowledgeKeys?: string[];
  requirementCodes?: string[];
}

export interface AgentInstructionsUnknown {
  topic: string;
  detail: string;
}

export interface AgentInstructionsCompilation {
  sections: AgentInstructionsSection[];
  unknowns: AgentInstructionsUnknown[];
}
