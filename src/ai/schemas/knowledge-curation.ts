// Knowledge Curator output contract (TASK-056, agents.md A-004).
//
// Transforms validated decisions and statements into PROPOSED knowledge
// changes — never applied state (application belongs to the curator service,
// which validates every proposal before the knowledge domain persists it).
// Four operation buckets stay structurally separate so the service can route
// each to the matching knowledge-domain function:
//
// - create: brand-new knowledge keys. Must not collide with existing keys.
// - update: in-place revision of a CURRENT/STALE item (same key).
// - supersede: replace an item under a FRESH successor key; the old row
//   freezes as SUPERSEDED and carries its provenance forward. When the
//   successor key names an EXISTING current item, the service consolidates
//   via merge instead of duplicating content.
// - sources: attach provenance to an existing item without changing it.
//
// Confidence uses the decision scale (EXPLICIT/INFERRED/ASSUMED) so the
// strength rules in the service ("weaker inference never overwrites
// confirmed knowledge") have something deterministic to check.
import type { FieldSchema } from "../validation/schema";

export const KNOWLEDGE_CURATION_SCHEMA_ID = "knowledge-curation/v1";

const SOURCE_SCHEMA: FieldSchema = {
  type: "object",
  required: true,
  properties: {
    type: {
      type: "string",
      required: true,
      enum: ["DECISION", "USER_MESSAGE", "PROJECT_INPUT", "AI_INFERENCE", "REQUIREMENT"],
    },
    sourceId: { type: "string", required: false, minLength: 1, maxLength: 64 },
  },
  additionalProperties: false,
};

const CONFIDENCE_SCHEMA: FieldSchema = {
  type: "string",
  required: true,
  enum: ["EXPLICIT", "INFERRED", "ASSUMED"],
};

export const KNOWLEDGE_CURATION_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    create: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1, maxLength: 128 },
          domain: { type: "string", required: true, minLength: 1, maxLength: 32 },
          title: { type: "string", required: true, minLength: 1, maxLength: 255 },
          content: {
            type: ["string", "number", "integer", "boolean", "array", "object", "null"],
            required: true,
          },
          confidence: CONFIDENCE_SCHEMA,
          sources: { type: "array", required: false, items: SOURCE_SCHEMA },
        },
        additionalProperties: false,
      },
    },
    update: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1, maxLength: 128 },
          title: { type: "string", required: false, minLength: 1, maxLength: 255 },
          content: {
            type: ["string", "number", "integer", "boolean", "array", "object", "null"],
            required: false,
          },
          confidence: { ...CONFIDENCE_SCHEMA, required: false },
        },
        additionalProperties: false,
      },
    },
    supersede: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1, maxLength: 128 },
          successorKey: { type: "string", required: true, minLength: 1, maxLength: 128 },
          domain: { type: "string", required: false, minLength: 1, maxLength: 32 },
          title: { type: "string", required: false, minLength: 1, maxLength: 255 },
          content: {
            type: ["string", "number", "integer", "boolean", "array", "object", "null"],
            required: false,
          },
          confidence: { ...CONFIDENCE_SCHEMA, required: false },
        },
        additionalProperties: false,
      },
    },
    sources: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1, maxLength: 128 },
          sources: { type: "array", required: true, items: SOURCE_SCHEMA },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export type CuratorConfidence = "EXPLICIT" | "INFERRED" | "ASSUMED";

export interface CuratorSource {
  type: "DECISION" | "USER_MESSAGE" | "PROJECT_INPUT" | "AI_INFERENCE" | "REQUIREMENT";
  sourceId?: string;
}

export interface CuratorCreate {
  key: string;
  domain: string;
  title: string;
  content: unknown;
  confidence: CuratorConfidence;
  sources?: CuratorSource[];
}

export interface CuratorUpdate {
  key: string;
  title?: string;
  content?: unknown;
  confidence?: CuratorConfidence;
}

export interface CuratorSupersede {
  key: string;
  successorKey: string;
  domain?: string;
  title?: string;
  content?: unknown;
  confidence?: CuratorConfidence;
}

export interface CuratorSources {
  key: string;
  sources: CuratorSource[];
}

export interface KnowledgeCuration {
  create: CuratorCreate[];
  update: CuratorUpdate[];
  supersede: CuratorSupersede[];
  sources: CuratorSources[];
}
