// Decision Center label contract (TASK-058). Pure unit tests — no
// database, no provider.
import { describe, expect, it } from "vitest";
import { decisionStatusLabel, filterToStatus } from "./labels";

describe("decisionStatusLabel", () => {
  it("pairs every status with a text glyph (never color-only)", () => {
    for (const status of ["UNRESOLVED", "RECOMMENDED", "CONFIRMED", "DEFERRED", "NOT_APPLICABLE"]) {
      const badge = decisionStatusLabel(status);
      expect(badge.label.trim()).not.toBe("");
      expect(badge.glyph.trim()).not.toBe("");
    }
    expect(decisionStatusLabel("CONFIRMED")).toEqual({ label: "Confirmed", glyph: "✓" });
    expect(decisionStatusLabel("BOGUS")).toEqual({ label: "BOGUS", glyph: "?" });
  });
});

describe("filterToStatus", () => {
  it("maps filter tabs to statuses and defaults to all", () => {
    expect(filterToStatus(undefined)).toBeUndefined();
    expect(filterToStatus("All")).toBeUndefined();
    expect(filterToStatus("Recommended")).toBe("RECOMMENDED");
    expect(filterToStatus("confirmed")).toBe("CONFIRMED");
    expect(filterToStatus("bogus")).toBeUndefined();
  });
});
