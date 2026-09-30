// TASK-014 acceptance: centralized ownership policy + repository backstop.
//
// Pure unit tests — no database (AGENTS.md §74: CI stays deterministic).
// Row-level cross-user proofs live in repository.test.ts as rolled-back
// integration tests, skipped without TEST_DATABASE_URL/DATABASE_URL.
import { describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "../../infrastructure/database/db";
import { assertProjectOwnership, isProjectOwner } from "./authorization";
import { ProjectNotFoundError, ProjectValidationError } from "./errors";
import { archiveProject, getProject, requireProjectScope } from "./repository";

describe("assertProjectOwnership", () => {
  it("allows the owner", () => {
    expect(() => assertProjectOwnership("u-1", "u-1")).not.toThrow();
  });

  it("hides existence from other users as NotFound, not Forbidden", () => {
    try {
      assertProjectOwnership("u-1", "u-2");
      expect.unreachable("cross-user access must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectNotFoundError);
      expect((error as Error).message).toBe("Project not found.");
    }
  });

  it("rejects blank session identity without touching the database", () => {
    expect(() => assertProjectOwnership("u-1", "   ")).toThrow(ProjectValidationError);
  });
});

describe("isProjectOwner", () => {
  it("mirrors the assert without throwing", () => {
    expect(isProjectOwner("u-1", "u-1")).toBe(true);
    expect(isProjectOwner("u-1", "u-2")).toBe(false);
    expect(isProjectOwner("u-1", "  ")).toBe(false);
  });
});

describe("repository ownership backstop", () => {
  it("denies a row whose owner differs even when SQL scoping is bypassed", async () => {
    const db = {
      query: {
        projects: {
          findFirst: async () => ({ id: "p-1", userId: "u-other" }),
        },
      },
    } as unknown as AppDatabase;
    await expect(getProject(db, "u-me", "p-1")).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("requireProjectScope fails closed for unknown projects", async () => {
    const db = {
      query: {
        projects: { findFirst: async () => undefined },
        projectInputs: { findFirst: async () => undefined },
        projectSettings: { findFirst: async () => undefined },
      },
    } as unknown as AppDatabase;
    await expect(requireProjectScope(db, "u-1", "p-missing")).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it("archiveProject rejects blank owner without touching the database", async () => {
    const update = vi.fn();
    const db = { update } as unknown as AppDatabase;
    await expect(archiveProject(db, "   ", "p-1")).rejects.toBeInstanceOf(ProjectValidationError);
    expect(update).not.toHaveBeenCalled();
  });
});
