// TASK-020 acceptance: version reads, atomic bumps, fail-fast identity.
//
// Pure unit tests — no database. Bump/commit behavior lives in
// repository.test.ts as rolled-back integration tests.
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../infrastructure/database/db";
import { ProjectValidationError } from "./errors";
import { getStateVersion, incrementStateVersion } from "./state-version";

describe("state version guards", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(getStateVersion(db, "   ", "p-1")).rejects.toBeInstanceOf(ProjectValidationError);
    await expect(incrementStateVersion(db, "", "p-1")).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
  });
});
