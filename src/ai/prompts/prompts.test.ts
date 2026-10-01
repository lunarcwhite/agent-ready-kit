// TASK-041 acceptance: stable keys, recorded versions, history-safe
// updates. Pure unit tests — no database, no provider.
import { describe, expect, it } from "vitest";
import { PromptRegistry } from "./registry";
import { PromptNotFoundError, PromptValidationError, definePrompt } from "./types";

const BASE = {
  key: "discovery.extract-answer",
  version: "1.2",
  role: "You are the Answer Interpreter.",
  objective: "Extract supported project decisions.",
  boundaries: ["Do not invent unsupported decisions."],
  outputSchema: "answer-interpretation/v1",
  qualityCriteria: ["Every decision cites supporting text."],
};

describe("definePrompt", () => {
  it("accepts a complete definition and freezes it", () => {
    const definition = definePrompt(BASE);
    expect(definition.key).toBe("discovery.extract-answer");
    expect(definition.version).toBe("1.2");
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it("rejects malformed keys, versions, and empty sections", () => {
    expect(() => definePrompt({ ...BASE, key: "Has Spaces" })).toThrow(PromptValidationError);
    expect(() => definePrompt({ ...BASE, version: "v1" })).toThrow(PromptValidationError);
    expect(() => definePrompt({ ...BASE, role: "  " })).toThrow(PromptValidationError);
    expect(() => definePrompt({ ...BASE, boundaries: [] })).toThrow(PromptValidationError);
    expect(() => definePrompt({ ...BASE, qualityCriteria: [] })).toThrow(PromptValidationError);
  });
});

describe("PromptRegistry", () => {
  it("resolves the latest version and pins exact versions", () => {
    const registry = new PromptRegistry();
    registry.register(BASE);
    registry.register({ ...BASE, version: "1.3" });
    expect(registry.resolve("discovery.extract-answer").version).toBe("1.3");
    expect(registry.resolve("discovery.extract-answer", "1.2").version).toBe("1.2");
    expect(registry.listVersions("discovery.extract-answer")).toEqual(["1.2", "1.3"]);
  });

  it("rejects duplicate versions and unknown lookups", () => {
    const registry = new PromptRegistry();
    registry.register(BASE);
    expect(() => registry.register(BASE)).toThrow(PromptValidationError);
    expect(() => registry.resolve("missing.key")).toThrow(PromptNotFoundError);
    expect(() => registry.resolve("discovery.extract-answer", "9.9")).toThrow(PromptNotFoundError);
  });

  it("preserves historical definitions across updates", () => {
    const registry = new PromptRegistry();
    const first = registry.register(BASE);
    registry.register({ ...BASE, version: "2.0", objective: "New objective." });
    // The held v1 object is untouched by the v2 registration.
    expect(registry.resolve("discovery.extract-answer", "1.2")).toBe(first);
    expect(first.objective).toBe("Extract supported project decisions.");
  });
});
