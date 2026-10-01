// TASK-115 acceptance: every known operation has a meaningful label, no
// percentages anywhere, unknown keys fall back neutrally. Pure unit
// tests — no database, no AI.
import { describe, expect, it } from "vitest";
import { FALLBACK_OPERATION_LABEL, operationLabel } from "./labels";

describe("ai operation labels", () => {
  it("names the actual operation for every known capability", () => {
    expect(operationLabel("SEMANTIC_VALIDATION")).toBe("Checking specification consistency…");
    expect(operationLabel("semantic-validation")).toBe("Checking specification consistency…");
    expect(operationLabel("TASK_GENERATION")).toBe("Planning implementation tasks…");
    expect(operationLabel("ANSWER_EXTRACTION")).toBe("Understanding your answer…");
    expect(operationLabel("INSTRUCTION_COMPILATION")).toBe("Writing coding-agent instructions…");
  });

  it("falls back neutrally without leaking internal keys or percentages", () => {
    expect(operationLabel("SOME_FUTURE_OP")).toBe(FALLBACK_OPERATION_LABEL);
    expect(operationLabel("  ")).toBe(FALLBACK_OPERATION_LABEL);
    expect(FALLBACK_OPERATION_LABEL).not.toMatch(/\d+%/);
    for (const label of [
      operationLabel("IDEA_ANALYSIS"),
      operationLabel("CONTEXT_COMPILATION"),
      operationLabel("ASSUMPTION_DETECTION"),
    ]) {
      expect(label).not.toMatch(/\d+%/);
      expect(label.endsWith("…")).toBe(true);
    }
  });
});
