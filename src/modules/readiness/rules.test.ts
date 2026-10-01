// TASK-080 acceptance: every dimension has explicit criteria,
// severity/weight documented, rules deterministic, blocking explicit,
// versions trackable. Pure data tests — no database, no AI.
import { describe, expect, it } from "vitest";
import { ISSUE_SEVERITIES } from "../validation/issues";
import { ReadinessValidationError } from "./errors";
import {
  assumptionSeverityForImpact,
  criteriaForDimension,
  isAssumptionBlocking,
  READINESS_ASSUMPTION_GATE,
  READINESS_CRITERIA,
  READINESS_DIMENSIONS,
  READINESS_RULES_VERSION,
} from "./rules";

const SEVERITIES = new Set<string>(ISSUE_SEVERITIES);

describe("readiness rule registry", () => {
  it("versions the registry for tracking", () => {
    expect(READINESS_RULES_VERSION).toMatch(/^\d+\.\d+(\.\d+)?$/);
  });

  it("covers every dimension with explicit criteria", () => {
    expect(READINESS_DIMENSIONS).toHaveLength(8);
    for (const dimension of READINESS_DIMENSIONS) {
      const criteria = criteriaForDimension(dimension);
      expect(criteria.length).toBeGreaterThan(0);
      for (const criterion of criteria) {
        expect(criterion.key.trim()).not.toBe("");
        expect(criterion.criteria.trim()).not.toBe("");
        expect(criterion.rules.every((rule) => rule.trim() !== "")).toBe(true);
      }
    }
    expect(() => criteriaForDimension("VIBES")).toThrow(ReadinessValidationError);
  });

  it("keeps weights and blocking severities in documented vocabularies", () => {
    for (const criterion of READINESS_CRITERIA) {
      expect([1, 2, 3]).toContain(criterion.weight);
      for (const severity of criterion.blockingSeverities) {
        expect(SEVERITIES.has(severity)).toBe(true);
      }
    }
    // FR-082 gating conditions carry weight 3 with explicit blockers.
    const blocking = READINESS_CRITERIA.filter((criterion) => criterion.weight === 3);
    expect(blocking.length).toBeGreaterThan(0);
    for (const criterion of blocking) {
      expect(criterion.blockingSeverities.length).toBeGreaterThan(0);
    }
  });

  it("gates readiness on critical assumptions with a documented mapping", () => {
    expect(READINESS_ASSUMPTION_GATE.blockingImpacts).toEqual(["HIGH"]);
    expect(assumptionSeverityForImpact("HIGH")).toBe("BLOCKER");
    expect(assumptionSeverityForImpact("MEDIUM")).toBe("HIGH");
    expect(assumptionSeverityForImpact("LOW")).toBe("MEDIUM");
    expect(isAssumptionBlocking("HIGH")).toBe(true);
    expect(isAssumptionBlocking("MEDIUM")).toBe(false);
    expect(() => assumptionSeverityForImpact("COSMIC")).toThrow(ReadinessValidationError);
  });

  it("is deterministic data: repeated reads are identical", () => {
    expect(criteriaForDimension("PRODUCT")).toEqual(criteriaForDimension("PRODUCT"));
    expect(JSON.stringify(READINESS_CRITERIA)).toBe(JSON.stringify(READINESS_CRITERIA));
  });
});
