// TASK-130 acceptance: archive (read-only) vs soft-delete, restore, and
// project-update enforcement.
//
// Unit tests pin the pure predicate and owner validation without a database
// (AGENTS.md §74: CI stays deterministic). The lifecycle proofs need real
// row-level behavior, so they run as rolled-back integration tests — skipped,
// not failed, without TEST_DATABASE_URL/DATABASE_URL (same pattern as
// repository.test.ts). Integration runs require migration
// drizzle/0016_project_archive.sql applied (archived_at column).
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { ProjectNotFoundError, ProjectValidationError } from "./errors";
import {
  archiveProject,
  createProject,
  getProject,
  isProjectArchived,
  listProjects,
  restoreProject,
  setProjectArchived,
  updateProject,
} from "./repository";
import { getStateVersion } from "./state-version";

describe("isProjectArchived", () => {
  it("is true only when the archive marker is set", () => {
    expect(isProjectArchived({ archivedAt: null })).toBe(false);
    expect(isProjectArchived({ archivedAt: new Date() })).toBe(true);
  });
});

describe("archive input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(setProjectArchived(db, "   ", "p-1")).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
    await expect(restoreProject(db, "   ", "p-1")).rejects.toBeInstanceOf(ProjectValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("project archive lifecycle (integration)", () => {
  it("archives a project: flag set, version bumped, still visible in reads", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `arch-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "Keep", idea: "Visible." });
        expect(created.project.archivedAt).toBeNull();

        const archived = await setProjectArchived(db, owner.id, created.project.id);
        expect(archived.archivedAt).toBeInstanceOf(Date);
        expect(archived.stateVersion).toBe(2);

        // Archived stays VISIBLE (unlike soft-delete): get + list return it
        // with the flag, so the UI can gate editing off archivedAt.
        const reread = await getProject(db, owner.id, created.project.id);
        expect(reread.project.archivedAt).toBeInstanceOf(Date);
        const listed = await listProjects(db, owner.id);
        expect(listed.map((project) => project.name)).toEqual(["Keep"]);
        expect(listed[0].archivedAt).toBeInstanceOf(Date);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects updates on archived projects without changing the version", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `ro-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "Frozen", idea: "Locked." });
        await setProjectArchived(db, owner.id, created.project.id);

        await expect(
          updateProject(db, owner.id, created.project.id, { description: "thaw" }),
        ).rejects.toThrowError(/is archived and read-only/);
        // Settings-only writes are updates too: also rejected.
        await expect(
          updateProject(db, owner.id, created.project.id, { preferredLanguage: "id" }),
        ).rejects.toBeInstanceOf(ProjectValidationError);
        expect(await getStateVersion(db, owner.id, created.project.id)).toBe(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("restores an archived project: flags cleared, editable again", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `rst-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "Thaw", idea: "Back." });
        await setProjectArchived(db, owner.id, created.project.id);

        const restored = await restoreProject(db, owner.id, created.project.id);
        expect(restored.archivedAt).toBeNull();
        expect(restored.deletedAt).toBeNull();
        expect(restored.stateVersion).toBe(3);

        const updated = await updateProject(db, owner.id, created.project.id, {
          description: "editable again",
        });
        expect(updated.project.description).toBe("editable again");
        expect(updated.project.stateVersion).toBe(4);
      });
    } finally {
      await pool.end();
    }
  });

  it("restores a soft-deleted project; while deleted it stays hidden", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `undel-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "Gone", idea: "Back soon." });
        await archiveProject(db, owner.id, created.project.id);

        // Soft-delete hides from every read path (existing TASK-011 rule).
        await expect(getProject(db, owner.id, created.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        expect(await listProjects(db, owner.id)).toEqual([]);

        const restored = await restoreProject(db, owner.id, created.project.id);
        expect(restored.deletedAt).toBeNull();
        expect(restored.archivedAt).toBeNull();
        const reread = await getProject(db, owner.id, created.project.id);
        expect(reread.project.id).toBe(created.project.id);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects restore of a live project and cross-user archive/restore", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `xo-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `xo-b-${stamp}@example.com` })
          .returning();
        const created = await createProject(db, a.id, { name: "Private", idea: "Mine." });

        // Nothing to restore on a live project: NotFound, not a silent no-op.
        await expect(restoreProject(db, a.id, created.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        // Cross-user attempts reveal nothing and change nothing.
        await expect(setProjectArchived(db, b.id, created.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(restoreProject(db, b.id, created.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        const reread = await getProject(db, a.id, created.project.id);
        expect(reread.project.archivedAt).toBeNull();
        expect(reread.project.stateVersion).toBe(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("treats re-archive as an idempotent no-op without an extra version bump", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `idem-${Date.now()}@example.com` })
          .returning();
        const created = await createProject(db, owner.id, { name: "Once", idea: "one bump." });
        const first = await setProjectArchived(db, owner.id, created.project.id);
        expect(first.stateVersion).toBe(2);

        const second = await setProjectArchived(db, owner.id, created.project.id);
        expect(second.archivedAt).toEqual(first.archivedAt);
        expect(second.stateVersion).toBe(2);
        expect(await getStateVersion(db, owner.id, created.project.id)).toBe(2);

        // Raw read confirms a single canonical bump, not two.
        const retained = await db.query.projects.findFirst({
          where: eq(schema.projects.id, created.project.id),
        });
        expect(retained?.archivedAt).toBeInstanceOf(Date);
        expect(retained?.stateVersion).toBe(2);
      });
    } finally {
      await pool.end();
    }
  });
});
