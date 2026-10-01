// Task Planner output contract (TASK-092, agents.md A-030, FR-100–104).
//
// One orchestrated call turns live specifications into a milestone/task
// plan. Candidates only: the service layer (tasks/planner.ts) grounds
// every reference, inherits missing acceptance criteria from source
// requirements, rejects cycles, and persists — model output never
// touches canonical state directly (AGENT-IMPL-INV-001).
//
// Dependency edges use batch-local temp keys (`key` / `dependsOn`):
// stable UTASK codes do not exist until persistence, so the service
// maps temp keys to created codes after all tasks persist.
import type { FieldSchema } from "../validation/schema";

export const TASK_GENERATION_SCHEMA_ID = "task-generation/v1";

const STRING_LIST = (maxItemLength: number) => ({
  type: "array" as const,
  required: false as const,
  items: { type: "string" as const, required: true, minLength: 1, maxLength: maxItemLength },
});

export const TASK_GENERATION_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    milestones: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          title: { type: "string", required: true, minLength: 1, maxLength: 255 },
          description: { type: "string", required: false, maxLength: 2000 },
          tasks: {
            type: "array",
            required: true,
            items: {
              type: "object",
              required: true,
              properties: {
                key: { type: "string", required: true, minLength: 1, maxLength: 64 },
                title: { type: "string", required: true, minLength: 1, maxLength: 255 },
                objective: { type: "string", required: true, minLength: 1, maxLength: 2000 },
                priority: { type: "string", required: true, enum: ["P0", "P1", "P2"] },
                requirementCodes: {
                  type: "array",
                  required: true,
                  items: { type: "string", required: true, minLength: 1, maxLength: 16 },
                },
                dependsOn: {
                  type: "array",
                  required: false,
                  items: { type: "string", required: true, minLength: 1, maxLength: 64 },
                },
                architectureRefs: STRING_LIST(128),
                entityRefs: STRING_LIST(128),
                screenRefs: STRING_LIST(128),
                implementationNotes: { type: "string", required: false, maxLength: 2000 },
                acceptanceCriteria: {
                  type: "array",
                  required: true,
                  items: { type: "string", required: true, minLength: 1, maxLength: 1000 },
                },
                definitionOfDone: {
                  type: "array",
                  required: true,
                  items: { type: "string", required: true, minLength: 1, maxLength: 1000 },
                },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export interface PlannedTask {
  key: string;
  title: string;
  objective: string;
  priority: "P0" | "P1" | "P2";
  requirementCodes: string[];
  dependsOn?: string[];
  architectureRefs?: string[];
  entityRefs?: string[];
  screenRefs?: string[];
  implementationNotes?: string;
  acceptanceCriteria: string[];
  definitionOfDone: string[];
}

export interface PlannedMilestone {
  title: string;
  description?: string;
  tasks: PlannedTask[];
}

export interface TaskGeneration {
  milestones: PlannedMilestone[];
}
