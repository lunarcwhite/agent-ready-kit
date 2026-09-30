// Recursive structured-output validator (TASK-042).
//
// Pure and side-effect free: invalid payloads are reported as issues, never
// written anywhere — the orchestrator (TASK-045) must pass validation BEFORE
// any canonical mutation, which is what keeps bad model output from touching
// approved state. Issues are plain data so the operation ledger (TASK-043)
// can persist them verbatim.
import type { FieldSchema, FieldType, ValidationIssue, ValidationResult } from "./schema";

function typeMatches(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function checkValue(
  schema: FieldSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.some((type) => typeMatches(value, type))) {
    issues.push({ path, message: `expected ${types.join("|")}` });
    return;
  }
  if (schema.enum !== undefined && !schema.enum.some((allowed) => deepEqual(allowed, value))) {
    issues.push({ path, message: `must be one of the allowed values` });
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({ path, message: `must be at least ${schema.minLength} characters` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({ path, message: `must be at most ${schema.maxLength} characters` });
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const [name, field] of Object.entries(schema.properties ?? {})) {
      const fieldPath = path === "$" ? `$.${name}` : `${path}.${name}`;
      if (record[name] === undefined) {
        if (field.required) issues.push({ path: fieldPath, message: "is required" });
        continue;
      }
      checkValue(field, record[name], fieldPath, issues);
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const name of Object.keys(record)) {
        if (!known.has(name)) {
          issues.push({ path: `${path}.${name}`, message: "is not an allowed property" });
        }
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) =>
      checkValue(schema.items as FieldSchema, item, `${path}[${index}]`, issues),
    );
  }
}

export function validateStructuredOutput(schema: FieldSchema, data: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (data === undefined) {
    return { ok: false, issues: [{ path: "$", message: "payload is missing" }] };
  }
  checkValue(schema, data, "$", issues);
  return { ok: issues.length === 0, issues };
}
