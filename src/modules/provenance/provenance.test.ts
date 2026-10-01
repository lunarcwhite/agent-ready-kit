// TASK-025 acceptance: canonical source_type × confidence mapping,
// soul.md §8 vocabulary, user/AI distinguishability, no masquerade,
// UI displayability. Pure unit tests — no database, no AI.
import { describe, expect, it } from "vitest";
import { ProvenanceValidationError } from "./errors";
import {
  getProvenanceDisplay,
  isAiOrigin,
  isUserExplicit,
  isUserOrigin,
  requireUserExplicit,
  resolveProvenance,
  resolveSoulProvenance,
  withProvenance,
} from "./provenance";

describe("resolveProvenance (D-A02 canonical mapping)", () => {
  it("maps USER × EXPLICIT to USER_EXPLICIT", () => {
    expect(resolveProvenance("USER", "EXPLICIT")).toBe("USER_EXPLICIT");
  });

  it("maps USER × INFERRED to USER_IMPLIED", () => {
    expect(resolveProvenance("USER", "INFERRED")).toBe("USER_IMPLIED");
  });

  it("maps the unspecified USER × ASSUMED cell to USER_IMPLIED (never explicit)", () => {
    expect(resolveProvenance("USER", "ASSUMED")).toBe("USER_IMPLIED");
  });

  it("maps AI_RECOMMENDATION × any confidence to AI_RECOMMENDED", () => {
    for (const confidence of ["EXPLICIT", "INFERRED", "ASSUMED"]) {
      expect(resolveProvenance("AI_RECOMMENDATION", confidence)).toBe("AI_RECOMMENDED");
    }
  });

  it("maps AI_INFERENCE × any confidence to AI_ASSUMED", () => {
    for (const confidence of ["EXPLICIT", "INFERRED", "ASSUMED"]) {
      expect(resolveProvenance("AI_INFERENCE", confidence)).toBe("AI_ASSUMED");
    }
  });

  it("maps SYSTEM × any confidence to SYSTEM_DERIVED", () => {
    for (const confidence of ["EXPLICIT", "INFERRED", "ASSUMED"]) {
      expect(resolveProvenance("SYSTEM", confidence)).toBe("SYSTEM_DERIVED");
    }
  });

  it("rejects unknown source or confidence without a database", () => {
    expect(() => resolveProvenance("HUMAN", "EXPLICIT")).toThrow(ProvenanceValidationError);
    expect(() => resolveProvenance("USER", "CERTAIN")).toThrow(ProvenanceValidationError);
  });

  it("never lets an assumption masquerade as an explicit user fact", () => {
    const sources = ["USER", "AI_RECOMMENDATION", "AI_INFERENCE", "SYSTEM"];
    const confidences = ["EXPLICIT", "INFERRED", "ASSUMED"];
    for (const source of sources) {
      for (const confidence of confidences) {
        const provenance = resolveProvenance(source, confidence);
        if (confidence === "ASSUMED" || source !== "USER") {
          expect(provenance).not.toBe("USER_EXPLICIT");
        }
      }
    }
    expect(resolveProvenance("AI_INFERENCE", "EXPLICIT")).not.toBe("USER_EXPLICIT");
  });
});

describe("resolveSoulProvenance (§8 vocabulary)", () => {
  it("maps CONFIRMED/INFERRED/ASSUMED/RECOMMENDED to provenance", () => {
    expect(resolveSoulProvenance("CONFIRMED")).toBe("USER_EXPLICIT");
    expect(resolveSoulProvenance("INFERRED")).toBe("USER_IMPLIED");
    expect(resolveSoulProvenance("ASSUMED")).toBe("AI_ASSUMED");
    expect(resolveSoulProvenance("RECOMMENDED")).toBe("AI_RECOMMENDED");
  });

  it("maps UNRESOLVED to no provenance", () => {
    expect(resolveSoulProvenance("UNRESOLVED")).toBeNull();
  });

  it("rejects unknown vocabulary", () => {
    expect(() => resolveSoulProvenance("MAYBE")).toThrow(ProvenanceValidationError);
  });
});

describe("provenance attachment and guards", () => {
  it("attaches derived provenance without mutating the input", () => {
    const decision = { sourceType: "USER", confidence: "EXPLICIT", title: "Auth" };
    const attached = withProvenance(decision);
    expect(attached.provenance).toBe("USER_EXPLICIT");
    expect(decision).not.toHaveProperty("provenance");
  });

  it("distinguishes user-confirmed state from AI proposals", () => {
    expect(isUserExplicit("USER_EXPLICIT")).toBe(true);
    expect(isUserExplicit("AI_RECOMMENDED")).toBe(false);
    expect(isUserExplicit("AI_ASSUMED")).toBe(false);
    expect(isUserOrigin("USER_IMPLIED")).toBe(true);
    expect(isUserOrigin("AI_ASSUMED")).toBe(false);
    expect(isAiOrigin("AI_ASSUMED")).toBe(true);
    expect(isAiOrigin("USER_EXPLICIT")).toBe(false);
  });

  it("requireUserExplicit accepts only USER × EXPLICIT", () => {
    expect(() => requireUserExplicit("USER", "EXPLICIT")).not.toThrow();
    expect(() => requireUserExplicit("USER", "INFERRED")).toThrow(ProvenanceValidationError);
    expect(() => requireUserExplicit("AI_INFERENCE", "ASSUMED")).toThrow(
      ProvenanceValidationError,
    );
  });
});

describe("provenance display (UI)", () => {
  it("provides a label for every provenance type", () => {
    expect(getProvenanceDisplay("USER_EXPLICIT").label).toContain("you");
    expect(getProvenanceDisplay("AI_ASSUMED").label).toContain("Assumed");
    expect(getProvenanceDisplay("AI_RECOMMENDED").label).toContain("Recommended");
    expect(getProvenanceDisplay("USER_IMPLIED").label).toBeTruthy();
    expect(getProvenanceDisplay("SYSTEM_DERIVED").label).toBeTruthy();
  });

  it("rejects unknown provenance", () => {
    expect(() => getProvenanceDisplay("USER_GUESSED")).toThrow(ProvenanceValidationError);
  });
});
