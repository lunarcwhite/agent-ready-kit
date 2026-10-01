import { describe, expect, it } from "vitest";
import { discoveryLevelLabel, nodeStatusLabel } from "./labels";

describe("discovery workspace labels", () => {
  it("labels every canonical node status with text and glyph", () => {
    expect(nodeStatusLabel("UNKNOWN")).toEqual({ label: "Not started", glyph: "○" });
    expect(nodeStatusLabel("PARTIAL")).toEqual({ label: "In progress", glyph: "●" });
    expect(nodeStatusLabel("RESOLVED")).toEqual({ label: "Complete", glyph: "✓" });
    expect(nodeStatusLabel("NOT_APPLICABLE")).toEqual({ label: "Not applicable", glyph: "—" });
  });

  it("labels every discovery level", () => {
    expect(discoveryLevelLabel("INITIAL")).toBe("Initial");
    expect(discoveryLevelLabel("QUICK_DRAFT")).toBe("Quick Draft");
    expect(discoveryLevelLabel("DETAILED")).toBe("Detailed");
    expect(discoveryLevelLabel("AGENT_READY")).toBe("Agent Ready");
  });
});
