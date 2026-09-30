// TASK-011 acceptance: ownership isolation, CRUD, and MVP update rules.
//
// Unit tests pin validation/slug logic without a database (AGENTS.md §74: CI
// stays deterministic). The cross-user ownership proofs need real row-level
// behavior, so they run as rolled-back integration tests — skipped, not
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
import { deriveSlug } from "./slugs";
import { ProjectNotFoundError, ProjectValidationError } from "./errors";
import {
  createProject,
  archiveProject,
  getProject,
  listProjects,
  updateProject,
} from "./repository";

describe("deriveSlug", () => {
  it("derives readable slugs and folds diacritics", () => {
    expect(deriveSlug("My Great App!")).toBe("my-great-app");
    expect(deriveSlug("  spaced   out  ")).toBe("spaced-out");
    expect(deriveSlug("café au lait")).toBe("cafe-au-lait");
  });

  it("falls back for names with no slug characters", () => {
    expect(deriveSlug("!!!")).toBe("project");
    expect(deriveSlug("   ")).toBe("project");
  });
});

describe("project input validation", () => {
  it("rejects blank name and idea without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(createProject(db, "u-1", { name: "  ", idea: "x" })).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
    await expect(createProject(db, "u-1", { name: "x", idea: "   " })).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
  });

  it("rejects overlong names and unsupported languages", async () => {
    const db = {} as AppDatabase;
    await expect(
      createProject(db, "u-1", { name: "n".repeat(256), idea: "ok" }),
    ).rejects.toBeInstanceOf(ProjectValidationError);
    await expect(
      createProject(db, "u-1", { name: "ok", idea: "ok", preferredLanguage: "fr" }),
    ).rejects.toBeInstanceOf(ProjectValidationError);
  });

  it("rejects structured reference objects", async () => {
    const db = {} as AppDatabase;
    await expect(
      createProject(db, "u-1", { name: "ok", idea: "ok", references: { url: "x" } }),
    ).rejects.toBeInstanceOf(ProjectValidationError);
  });

  it("rejects null name/idea on update", async () => {
    const db = {} as AppDatabase;
    await expect(updateProject(db, "u-1", "p-1", { name: null })).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
  });

  it("rejects blank owner on list without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(listProjects(db, "   ")).rejects.toBeInstanceOf(ProjectValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("project persistence (integration)", () => {
  it("creates and retrieves a project with defaults and idea capture", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `owner-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, {
          name: "Novel Helper",
          idea: "Help people write novels with AI.",
          targetUsers: "Writers",
          preferredStack: "Next.js",
        });
        expect(created.project.name).toBe("Novel Helper");
        expect(created.project.slug).toBe("novel-helper");
        expect(created.project.lifecycleState).toBe("DISCOVERY");
        expect(created.project.discoveryLevel).toBe("INITIAL");
        expect(created.project.readinessScore).toBe(0);
        expect(created.project.stateVersion).toBe(1);
        expect(created.input.idea).toContain("novels");
        expect(created.settings.settings).toMatchObject({
          preferred_stack: "Next.js",
          preferred_language: "en",
        });

        const reread = await getProject(db, owner.id, created.project.id);
        expect(reread.project.id).toBe(created.project.id);
        expect(reread.input.targetUsers).toBe("Writers");
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates projects between users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `b-${stamp}@example.com` })
          .returning();
        const created = await createProject(db, a.id, { name: "Private", idea: "Mine." });
        await expect(getProject(db, b.id, created.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          updateProject(db, b.id, created.project.id, { description: "hijack" }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });

  it("updates MVP fields, re-derives slug, and ignores canonical columns", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `upd-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "Old Name", idea: "v1" });
        const updated = await updateProject(db, owner.id, created.project.id, {
          name: "New Name",
          constraints: "offline-first",
          preferredLanguage: "id",
        });
        expect(updated.project.name).toBe("New Name");
        expect(updated.project.slug).toBe("new-name");
        expect(updated.input.constraints).toBe("offline-first");
        expect(updated.settings.settings).toMatchObject({ preferred_language: "id" });
        // Canonical columns stay server-owned: the update path has no input
        // for them, so lifecycle/stateVersion survive untouched.
        expect(updated.project.lifecycleState).toBe("DISCOVERY");
        expect(updated.project.stateVersion).toBe(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("archives a project and hides it from read and update afterwards", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `arc-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "Ephemeral", idea: "Gone." });
        await archiveProject(db, owner.id, created.project.id);
        await expect(getProject(db, owner.id, created.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          updateProject(db, owner.id, created.project.id, { description: "resurrect" }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        // Archiving twice is NotFound, not a silent no-op success.
        await expect(archiveProject(db, owner.id, created.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects cross-user archive attempts without touching the project", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `arc-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `arc-b-${stamp}@example.com` })
          .returning();
        const created = await createProject(db, a.id, { name: "Private", idea: "Mine." });
        await expect(archiveProject(db, b.id, created.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        // Owner's project survives the attempt untouched.
        const reread = await getProject(db, a.id, created.project.id);
        expect(reread.project.id).toBe(created.project.id);
      });
    } finally {
      await pool.end();
    }
  });

  it("lists owned projects most-recently-updated first, hiding foreign and archived ones", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `lst-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `lst-b-${stamp}@example.com` })
          .returning();
        const first = await createProject(db, a.id, { name: "First", idea: "one" });
        const second = await createProject(db, a.id, { name: "Second", idea: "two" });
        await createProject(db, b.id, { name: "Foreign", idea: "not mine" });
        // Touch the older project: updated_at bumps via $onUpdate, so it
        // must surface first regardless of creation order.
        await updateProject(db, a.id, first.project.id, { description: "touched" });
        await archiveProject(db, a.id, second.project.id);

        const listed = await listProjects(db, a.id);
        expect(listed.map((project) => project.name)).toEqual(["First"]);
        expect(listed[0].description).toBe("touched");

        const foreign = await listProjects(db, b.id);
        expect(foreign.map((project) => project.name)).toEqual(["Foreign"]);
      });
    } finally {
      await pool.end();
    }
  });

  it("orders the list by recency", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `ord-${Date.now()}@example.com` })
          .returning();
        const older = await createProject(db, owner.id, { name: "Older", idea: "one" });
        // Strictly later UPDATE: its updated_at is taken at a later
        // wall-clock time than both inserts, so ties are impossible.
        await updateProject(db, owner.id, older.project.id, { description: "bump" });
        await createProject(db, owner.id, { name: "Newer", idea: "two" });

        const listed = await listProjects(db, owner.id);
        expect(listed.map((project) => project.name)).toEqual(["Newer", "Older"]);
      });
    } finally {
      await pool.end();
    }
  });
});
