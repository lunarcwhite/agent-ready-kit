// TASK-022 acceptance, part 1: deterministic dependency logic as pure
// functions — no database (AGENTS.md §73–74: unit-test product invariants,
// keep CI deterministic). Stateful cascade proofs live in decisions.test.ts
// as rolled-back integration tests.
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../infrastructure/database/db";
import { DecisionValidationError } from "./errors";
import {
  listDependencies,
  matchesCondition,
  normalizeCondition,
  registerDependency,
  resolveEffect,
  wouldCreateCycle,
} from "./dependencies";

describe("normalizeCondition", () => {
  it("accepts null/undefined as always-fire", () => {
    expect(normalizeCondition(null)).toBeNull();
    expect(normalizeCondition(undefined)).toBeNull();
  });

  it("accepts equals shapes and preserves the expected value", () => {
    expect(normalizeCondition({ equals: false })).toEqual({ equals: false });
    expect(normalizeCondition({ equals: ["GOOGLE"] })).toEqual({ equals: ["GOOGLE"] });
    expect(normalizeCondition({ equals: null })).toEqual({ equals: null });
  });

  it("rejects shapes outside the language instead of guessing", () => {
    for (const bad of ["false", 42, [false], { eq: false }, { equals: 1, op: "eq" }, {}]) {
      expect(() => normalizeCondition(bad), JSON.stringify(bad)).toThrow(DecisionValidationError);
    }
  });
});

describe("matchesCondition", () => {
  it("fires unconditionally on null conditions", () => {
    expect(matchesCondition(null, false)).toBe(true);
    expect(matchesCondition(null, undefined)).toBe(true);
  });

  it("deep-matches equals conditions structurally, not by reference", () => {
    expect(matchesCondition({ equals: false }, false)).toBe(true);
    expect(matchesCondition({ equals: false }, true)).toBe(false);
    expect(matchesCondition({ equals: ["A"] }, ["A"])).toBe(true);
    expect(matchesCondition({ equals: ["A"] }, ["A", "B"])).toBe(false);
    expect(matchesCondition({ equals: { a: 1 } }, { a: 1 })).toBe(true);
    expect(matchesCondition({ equals: null }, null)).toBe(true);
    expect(matchesCondition({ equals: null }, undefined)).toBe(false);
  });
});

describe("wouldCreateCycle", () => {
  it("rejects self-edges", () => {
    expect(wouldCreateCycle([], "a.x", "a.x")).toBe(true);
  });

  it("detects direct and indirect cycles", () => {
    expect(wouldCreateCycle([{ sourceKey: "b.y", targetKey: "a.x" }], "a.x", "b.y")).toBe(true);
    const chain = [
      { sourceKey: "b.y", targetKey: "c.z" },
      { sourceKey: "c.z", targetKey: "a.x" },
    ];
    expect(wouldCreateCycle(chain, "a.x", "b.y")).toBe(true);
  });

  it("allows diamonds and independent edges", () => {
    const diamond = [
      { sourceKey: "a.x", targetKey: "b.y" },
      { sourceKey: "a.x", targetKey: "c.z" },
      { sourceKey: "b.y", targetKey: "d.w" },
    ];
    expect(wouldCreateCycle(diamond, "c.z", "d.w")).toBe(false);
    expect(wouldCreateCycle([], "a.x", "b.y")).toBe(false);
  });
});

describe("resolveEffect", () => {
  it("maps MARK_NOT_APPLICABLE to NA unless already there", () => {
    expect(resolveEffect("MARK_NOT_APPLICABLE", "CONFIRMED")).toEqual({
      status: "NOT_APPLICABLE",
      clearValue: false,
    });
    expect(resolveEffect("MARK_NOT_APPLICABLE", "NOT_APPLICABLE")).toBeNull();
  });

  it("activates shelved targets only", () => {
    expect(resolveEffect("ACTIVATE", "NOT_APPLICABLE")).toEqual({
      status: "UNRESOLVED",
      clearValue: false,
    });
    expect(resolveEffect("ACTIVATE", "DEFERRED")).toEqual({
      status: "UNRESOLVED",
      clearValue: false,
    });
    expect(resolveEffect("ACTIVATE", "CONFIRMED")).toBeNull();
  });

  it("requires decidability: NA targets reopen, decided ones stand", () => {
    expect(resolveEffect("REQUIRE", "NOT_APPLICABLE")).toEqual({
      status: "UNRESOLVED",
      clearValue: false,
    });
    expect(resolveEffect("REQUIRE", "CONFIRMED")).toBeNull();
  });

  it("invalidates decided targets by voiding the recorded answer", () => {
    expect(resolveEffect("INVALIDATE", "CONFIRMED")).toEqual({
      status: "UNRESOLVED",
      clearValue: true,
    });
    expect(resolveEffect("INVALIDATE", "UNRESOLVED")).toBeNull();
  });
});

describe("registerDependency validation", () => {
  it("rejects malformed registrations without touching the database", async () => {
    const db = {} as AppDatabase;
    const base = { sourceKey: "a.x", targetKey: "b.y", effect: "MARK_NOT_APPLICABLE" as const };
    await expect(registerDependency(db, "  ", "p-1", base)).rejects.toBeInstanceOf(
      DecisionValidationError,
    );
    await expect(
      registerDependency(db, "u-1", "p-1", { ...base, sourceKey: "BAD KEY" }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(
      registerDependency(db, "u-1", "p-1", { ...base, sourceKey: "a.x", targetKey: "a.x" }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(
      registerDependency(db, "u-1", "p-1", { ...base, effect: "SOMETIMES" as never }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(
      registerDependency(db, "u-1", "p-1", { ...base, condition: { eq: 1 } }),
    ).rejects.toBeInstanceOf(DecisionValidationError);
    await expect(listDependencies(db, "", "p-1")).rejects.toBeInstanceOf(DecisionValidationError);
  });
});
