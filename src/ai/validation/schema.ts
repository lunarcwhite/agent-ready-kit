// Validation schema DSL (TASK-042, agents.md §52).
//
// Minimal JSON-subset contract language — no new dependency (§72): objects,
// arrays, scalars, enums, and bounds cover AI output contracts without
// pulling a schema library for a handful of shapes.
export type FieldType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export interface FieldSchema {
  type: FieldType | FieldType[];
  required?: boolean;
  properties?: Record<string, FieldSchema>;
  items?: FieldSchema;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
