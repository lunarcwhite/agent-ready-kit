import { describe, expect, it } from "vitest";
import {
  assertValidStableId,
  buildCounterType,
  formatStableId,
  IdentifierError,
  normalizeCategory,
  parseStableId,
} from "./identifiers";

// Deterministic in-memory stand-in for project_counters: proves the pure
// contract (uniqueness, stability, monotonicity) without a database.
// ponytail: live atomicity under concurrency is covered by
// src/infrastructure/database/identifiers.test.ts.
function createTestAllocator() {
  const counters = new Map<string, number>();
  return {
    allocate(projectId: string, family: "FR" | "DEC", category?: string): string {
      const counterType = buildCounterType(family, category);
      const next = (counters.get(`${projectId}:${counterType}`) ?? 0) + 1;
      counters.set(`${projectId}:${counterType}`, next);
      return formatStableId(family, next, category);
    },
  };
}

describe("stable identifier formatting", () => {
  it("zero-pads sequences to three digits", () => {
    expect(formatStableId("FR", 1)).toBe("FR-001");
    expect(formatStableId("FR", 23)).toBe("FR-023");
    expect(formatStableId("TASK", 31)).toBe("TASK-031");
    expect(formatStableId("ASM", 4)).toBe("ASM-004");
    expect(formatStableId("ISSUE", 12)).toBe("ISSUE-012");
    expect(formatStableId("ENT", 6)).toBe("ENT-006");
    expect(formatStableId("ARC", 8)).toBe("ARC-008");
    expect(formatStableId("SCREEN", 9)).toBe("SCREEN-009");
    expect(formatStableId("MS", 1)).toBe("MS-001");
    expect(formatStableId("UTASK", 7)).toBe("UTASK-007");
  });

  it("formats DEC codes with a category infix", () => {
    expect(formatStableId("DEC", 1, "AUTH")).toBe("DEC-AUTH-001");
    expect(formatStableId("DEC", 3, "USER")).toBe("DEC-USER-003");
  });

  it("grows past three digits without truncation", () => {
    expect(formatStableId("TASK", 1000)).toBe("TASK-1000");
  });

  it("is deterministic for the same input", () => {
    expect(formatStableId("FR", 14)).toBe(formatStableId("FR", 14));
    expect(formatStableId("DEC", 2, "AUTH")).toBe(formatStableId("DEC", 2, "AUTH"));
  });

  it("rejects non-positive or non-integer sequences", () => {
    for (const sequence of [0, -1, 1.5, Number.NaN]) {
      expect(() => formatStableId("FR", sequence)).toThrow(IdentifierError);
    }
  });

  it("rejects DEC without a category and categories on other families", () => {
    expect(() => formatStableId("DEC", 1)).toThrow(IdentifierError);
    expect(() => formatStableId("FR", 1, "AUTH")).toThrow(IdentifierError);
  });

  it("normalizes category casing and whitespace, rejects malformed ones", () => {
    expect(normalizeCategory(" auth ")).toBe("AUTH");
    for (const bad of ["", "A", "TOOLONGCAT", "A-B", "A B", "auth!"]) {
      expect(() => normalizeCategory(bad)).toThrow(IdentifierError);
    }
  });
});

describe("stable identifier parsing", () => {
  it("round-trips every family", () => {
    expect(parseStableId("FR-023")).toEqual({ family: "FR", sequence: 23, counterType: "FR" });
    expect(parseStableId("DEC-AUTH-001")).toEqual({
      family: "DEC",
      category: "AUTH",
      sequence: 1,
      counterType: "DEC-AUTH",
    });
    expect(parseStableId("TASK-1000")).toEqual({
      family: "TASK",
      sequence: 1000,
      counterType: "TASK",
    });
  });

  it("rejects non-canonical input instead of guessing", () => {
    for (const bad of [
      "",
      "FR-1",
      "FR-01",
      "fr-001",
      "dec-auth-001",
      "XYZ-001",
      "FR-001-extra",
      "DEC-001",
      "DEC-A-001",
      "FR-000",
    ]) {
      expect(parseStableId(bad), bad).toBeNull();
      expect(() => assertValidStableId(bad), bad).toThrow(IdentifierError);
    }
  });
});

describe("counter types", () => {
  it("scopes DEC counters per category and others per family", () => {
    expect(buildCounterType("FR")).toBe("FR");
    expect(buildCounterType("DEC", "AUTH")).toBe("DEC-AUTH");
    expect(buildCounterType("DEC", "USER")).toBe("DEC-USER");
  });
});

describe("allocation stability", () => {
  it("never duplicates codes across interleaved families", () => {
    const allocator = createTestAllocator();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add(allocator.allocate("project-a", "FR"));
      codes.add(allocator.allocate("project-a", "DEC", "AUTH"));
    }
    expect(codes.size).toBe(100);
  });

  it("keeps existing codes stable when ordering changes", () => {
    const allocator = createTestAllocator();
    const first = allocator.allocate("project-a", "FR");
    const second = allocator.allocate("project-a", "FR");
    allocator.allocate("project-a", "DEC", "AUTH");
    const third = allocator.allocate("project-a", "FR");
    // Earlier codes are plain strings: later allocations cannot shift them.
    expect([first, second, third]).toEqual(["FR-001", "FR-002", "FR-003"]);
  });

  it("isolates sequences per project namespace", () => {
    const allocator = createTestAllocator();
    expect(allocator.allocate("project-a", "FR")).toBe("FR-001");
    expect(allocator.allocate("project-b", "FR")).toBe("FR-001");
    expect(allocator.allocate("project-a", "FR")).toBe("FR-002");
  });

  it("advances DEC categories independently", () => {
    const allocator = createTestAllocator();
    expect(allocator.allocate("project-a", "DEC", "AUTH")).toBe("DEC-AUTH-001");
    expect(allocator.allocate("project-a", "DEC", "USER")).toBe("DEC-USER-001");
    expect(allocator.allocate("project-a", "DEC", "AUTH")).toBe("DEC-AUTH-002");
  });
});
