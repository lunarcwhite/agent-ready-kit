// TASK-069 scope normalization: shared shape enforcement across compilers.
// Pure unit tests — no database, no AI.
import { describe, expect, it } from "vitest";
import { SpecificationValidationError } from "./errors";
import { assertSectionsInScope, normalizeSectionScope } from "./scope";

describe("normalizeSectionScope", () => {
  it("returns null when no scope is provided", () => {
    expect(normalizeSectionScope(undefined)).toBeNull();
  });

  it("normalizes keys to sorted lowercase dot-notation without duplicates", () => {
    expect(normalizeSectionScope(["Product.Scope", "product.users", "product.scope"])).toEqual([
      "product.scope",
      "product.users",
    ]);
  });

  it("rejects empty and malformed scopes without touching the database", () => {
    expect(() => normalizeSectionScope([])).toThrow(SpecificationValidationError);
    expect(() => normalizeSectionScope(["Has Spaces"])).toThrow(SpecificationValidationError);
    expect(() => normalizeSectionScope(["   "])).toThrow(SpecificationValidationError);
    expect(() => normalizeSectionScope(["x".repeat(129)])).toThrow(SpecificationValidationError);
  });
});

describe("assertSectionsInScope", () => {
  it("passes full runs and in-scope proposals", () => {
    const fail = (message: string): never => {
      throw new Error(message);
    };
    expect(() => assertSectionsInScope(["a.b", "c"], null, fail)).not.toThrow();
    expect(() => assertSectionsInScope(["a.b"], ["a.b", "c"], fail)).not.toThrow();
  });

  it("fails out-of-scope keys through the caller's error", () => {
    const fail = (message: string): never => {
      throw new Error(`scoped: ${message}`);
    };
    expect(() => assertSectionsInScope(["a.b", "zzz"], ["a.b"], fail)).toThrow("scoped:");
  });
});
