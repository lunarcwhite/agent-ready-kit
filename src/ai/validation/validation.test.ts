// TASK-042 acceptance: malformed payloads rejected with recordable
// issues, bounded repair policy. Pure unit tests — no database, no provider.
import { describe, expect, it } from "vitest";
import { buildRepairPrompt, MAX_REPAIR_ATTEMPTS, shouldAttemptRepair } from "./repair";
import type { FieldSchema } from "./schema";
import { validateStructuredOutput } from "./validator";

const ANSWER_SCHEMA: FieldSchema = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      required: true,
      items: {
        type: "object",
        required: true,
        properties: {
          key: { type: "string", required: true, minLength: 1 },
          value: { type: "boolean", required: true },
          confidence: { type: "string", required: true, enum: ["EXPLICIT", "INFERRED", "ASSUMED"] },
        },
        additionalProperties: false,
      },
    },
    assumptions: { type: "array", required: false },
  },
  additionalProperties: false,
};

describe("validateStructuredOutput", () => {
  it("accepts a well-formed payload", () => {
    const result = validateStructuredOutput(ANSWER_SCHEMA, {
      decisions: [{ key: "authentication.required", value: true, confidence: "EXPLICIT" }],
    });
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("rejects missing payloads and wrong root types", () => {
    expect(validateStructuredOutput(ANSWER_SCHEMA, undefined).ok).toBe(false);
    expect(validateStructuredOutput(ANSWER_SCHEMA, "just text").ok).toBe(false);
    expect(validateStructuredOutput(ANSWER_SCHEMA, null).ok).toBe(false);
  });

  it("reports missing required fields with paths", () => {
    const result = validateStructuredOutput(ANSWER_SCHEMA, { decisions: [{}] });
    expect(result.ok).toBe(false);
    const paths = result.issues.map((issue) => issue.path);
    expect(paths).toContain("$.decisions[0].key");
    expect(paths).toContain("$.decisions[0].value");
    expect(paths).toContain("$.decisions[0].confidence");
  });

  it("rejects bad enums, wrong scalar types, and extra properties", () => {
    const result = validateStructuredOutput(ANSWER_SCHEMA, {
      decisions: [{ key: "a.b", value: "yes", confidence: "CERTAIN", extra: 1 }],
      assumptions: "none",
      hacked: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("enforces string bounds", () => {
    const schema: FieldSchema = {
      type: "object",
      properties: { name: { type: "string", required: true, minLength: 2, maxLength: 4 } },
    };
    expect(validateStructuredOutput(schema, { name: "x" }).ok).toBe(false);
    expect(validateStructuredOutput(schema, { name: "toolong" }).ok).toBe(false);
    expect(validateStructuredOutput(schema, { name: "ok" }).ok).toBe(true);
  });

  it("returns plain-data issues suitable for ledger persistence", () => {
    const result = validateStructuredOutput(ANSWER_SCHEMA, {});
    expect(() => JSON.stringify(result.issues)).not.toThrow();
    expect(result.issues[0]).toHaveProperty("path");
    expect(result.issues[0]).toHaveProperty("message");
  });
});

describe("bounded repair", () => {
  it("allows exactly one repair attempt", () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(1);
    const issues = [{ path: "$.a", message: "is required" }];
    expect(shouldAttemptRepair(0, issues)).toBe(true);
    expect(shouldAttemptRepair(1, issues)).toBe(false);
    expect(shouldAttemptRepair(0, [])).toBe(false);
  });

  it("builds a repair prompt naming every problem", () => {
    const prompt = buildRepairPrompt('{"a":1}', [
      { path: "$.b", message: "is required" },
      { path: "$.a", message: "expected string" },
    ]);
    expect(prompt).toContain("$.b: is required");
    expect(prompt).toContain('{"a":1}');
  });
});
