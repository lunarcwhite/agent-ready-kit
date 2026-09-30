// TASK-059 acceptance: stable ARC-*/SCREEN-* codes unique per project,
// DRAFT/CONFIRMED/DEFERRED/SUPERSEDED/REMOVED lifecycle, codes survive
// regeneration and are never reused, export README with reading order +
// source-of-truth locations, unit tests for code generation.
//
// Unit tests pin validation + README rendering without a database.
// Row-level proofs run as rolled-back integration tests — skipped, not
// failed, without TEST_DATABASE_URL/DATABASE_URL.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { createProject } from "../projects/repository";
import { ProjectNotFoundError } from "../projects/errors";
import { getStateVersion } from "../projects/state-version";
import { ArchitectureNotFoundError, ArchitectureValidationError } from "./errors";
import {
  createComponent,
  getComponentByCode,
  listComponents,
  removeComponent,
  supersedeComponent,
  updateComponent,
} from "./components";
import {
  createScreen,
  getScreenByCode,
  listScreens,
  removeScreen,
  supersedeScreen,
} from "./screens";
import { renderAgentReadme } from "./readme";

describe("agent readme rendering", () => {
  const BASE = {
    projectName: "Demo",
    lifecycleState: "DRAFT",
    stateVersion: 3,
    documents: [
      { name: "Context", path: "context.md", sourceOfTruth: "Project state" },
      { name: "PRD", path: "docs/PRD.md", sourceOfTruth: "Requirements" },
    ],
  };

  it("renders reading order and source-of-truth locations", () => {
    const out = renderAgentReadme({
      ...BASE,
      components: [{ code: "ARC-001", name: "Web app", status: "CONFIRMED" }],
      screens: [{ code: "SCREEN-001", name: "Login", status: "DRAFT" }],
    });
    expect(out).toContain("# Demo — Agent Kit README");
    expect(out).toContain("1. `context.md` — Context (source of truth: Project state)");
    expect(out).toContain("2. `docs/PRD.md` — PRD (source of truth: Requirements)");
    expect(out).toContain("- Requirements → `docs/PRD.md`");
    expect(out).toContain("`ARC-001` — Web app (CONFIRMED)");
    expect(out).toContain("`SCREEN-001` — Login (DRAFT)");
    expect(out).toContain("Do not mark incomplete work DONE.");
  });

  it("rejects malformed input without rendering", () => {
    expect(() => renderAgentReadme({ ...BASE, documents: [] })).toThrow(
      ArchitectureValidationError,
    );
    expect(() =>
      renderAgentReadme({ ...BASE, projectName: "  ", documents: BASE.documents }),
    ).toThrow(ArchitectureValidationError);
    expect(() => renderAgentReadme({ ...BASE, stateVersion: -1 })).toThrow(
      ArchitectureValidationError,
    );
    expect(() => renderAgentReadme(null as never)).toThrow(ArchitectureValidationError);
  });
});

describe("architecture input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(
      createComponent(db, "  ", "p-1", { name: "Web", status: "DRAFT" }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(
      createScreen(db, "", "p-1", { name: "Login", status: "DRAFT" }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(getComponentByCode(db, "", "p-1", "ARC-001")).rejects.toBeInstanceOf(
      ArchitectureValidationError,
    );
    await expect(listComponents(db, "", "p-1")).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(updateComponent(db, "", "p-1", "ARC-001", {})).rejects.toBeInstanceOf(
      ArchitectureValidationError,
    );
    await expect(removeComponent(db, "", "p-1", "ARC-001")).rejects.toBeInstanceOf(
      ArchitectureValidationError,
    );
    await expect(
      supersedeComponent(db, "", "p-1", "ARC-001", { name: "v2", status: "DRAFT" }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(listScreens(db, "", "p-1")).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(removeScreen(db, "", "p-1", "SCREEN-001")).rejects.toBeInstanceOf(
      ArchitectureValidationError,
    );
  });

  it("rejects malformed fields without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(
      createComponent(db, "u-1", "p-1", { name: "   ", status: "DRAFT" }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(
      createComponent(db, "u-1", "p-1", { name: "Web", status: "SUPERSEDED" }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(
      createComponent(db, "u-1", "p-1", { name: "Web", status: "NOPE" as never }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(
      createScreen(db, "u-1", "p-1", { name: "Login", status: "REMOVED" }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(
      updateComponent(db, "u-1", "p-1", "ARC-001", { status: "SUPERSEDED" }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
    await expect(
      supersedeScreen(db, "u-1", "p-1", "SCREEN-001", { name: "v2", status: "REMOVED" }),
    ).rejects.toBeInstanceOf(ArchitectureValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("architecture domain model (integration)", () => {
  it("allocates stable codes and bumps the version", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `arc-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "A", idea: "arch" });
        const pid = project.project.id;

        const first = await createComponent(db, owner.id, pid, {
          name: "Web app",
          status: "DRAFT",
        });
        expect(first.componentCode).toBe("ARC-001");
        expect(await getStateVersion(db, owner.id, pid)).toBe(2);

        const second = await createComponent(db, owner.id, pid, {
          name: "Worker",
          status: "CONFIRMED",
        });
        expect(second.componentCode).toBe("ARC-002");

        const screen = await createScreen(db, owner.id, pid, {
          name: "Login",
          routeHint: "/login",
          status: "DRAFT",
        });
        expect(screen.screenCode).toBe("SCREEN-001");
        expect(screen.routeHint).toBe("/login");

        expect(await listComponents(db, owner.id, pid)).toHaveLength(2);
        expect(await listScreens(db, owner.id, pid)).toHaveLength(1);
        expect((await getComponentByCode(db, owner.id, pid, "ARC-001")).id).toBe(first.id);
        expect((await getScreenByCode(db, owner.id, pid, "SCREEN-001")).id).toBe(screen.id);
      });
    } finally {
      await pool.end();
    }
  });

  it("supersedes with fresh codes and never reuses them", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `asup-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "S", idea: "sup" });
        const pid = project.project.id;
        await createComponent(db, owner.id, pid, { name: "Web v1", status: "CONFIRMED" });

        const before = await getStateVersion(db, owner.id, pid);
        const { old, next } = await supersedeComponent(
          db,
          owner.id,
          pid,
          "ARC-001",
          { name: "Web v2", status: "DRAFT" },
          "Split frontend.",
        );
        expect(next.componentCode).toBe("ARC-002");
        expect(next.metadata?.supersedes).toBe("ARC-001");
        expect(old.status).toBe("SUPERSEDED");
        expect(old.metadata?.supersededBy).toBe("ARC-002");
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 1);

        // Frozen rows reject further writes; codes advance past removals.
        await expect(
          updateComponent(db, owner.id, pid, "ARC-001", { name: "x" }),
        ).rejects.toBeInstanceOf(ArchitectureValidationError);
        await removeComponent(db, owner.id, pid, "ARC-002");
        expect((await getComponentByCode(db, owner.id, pid, "ARC-002")).status).toBe("REMOVED");
        const third = await createComponent(db, owner.id, pid, { name: "Web v3", status: "DRAFT" });
        expect(third.componentCode).toBe("ARC-003");
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates components and screens between users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `ai-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `ai-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        const pid = project.project.id;
        await createComponent(db, a.id, pid, { name: "Web", status: "DRAFT" });
        await createScreen(db, a.id, pid, { name: "Login", status: "DRAFT" });

        await expect(getComponentByCode(db, b.id, pid, "ARC-001")).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(listComponents(db, b.id, pid)).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(
          createScreen(db, b.id, pid, { name: "Login", status: "DRAFT" }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(getScreenByCode(db, a.id, pid, "SCREEN-999")).rejects.toBeInstanceOf(
          ArchitectureNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
