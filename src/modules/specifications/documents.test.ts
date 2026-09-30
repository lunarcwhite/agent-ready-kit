// TASK-060 acceptance: typed documents with versions, source state
// version on snapshots, individually addressable sections, current vs
// historical distinguishable, staleness representable.
//
// Unit tests pin validation without a database. Row-level proofs run as
// rolled-back integration tests — skipped, not failed, without
// TEST_DATABASE_URL/DATABASE_URL.
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
import { SpecificationNotFoundError, SpecificationValidationError } from "./errors";
import {
  createVersion,
  ensureDocument,
  getDocument,
  getSection,
  getVersion,
  listDocuments,
  listSections,
  listVersions,
  markSectionStale,
  updateDocumentStatus,
  upsertSection,
} from "./documents";

describe("specification input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(ensureDocument(db, "  ", "p-1", "PRD")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(getDocument(db, "", "p-1", "PRD")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(listDocuments(db, "", "p-1")).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(updateDocumentStatus(db, "", "p-1", "PRD", "CURRENT")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(
      upsertSection(db, "", "p-1", "PRD", { sectionKey: "a", title: "A" }),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(getSection(db, "", "p-1", "PRD", "a")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(listSections(db, "", "p-1", "PRD")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(markSectionStale(db, "", "p-1", "PRD", "a")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(createVersion(db, "", "p-1", "PRD")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(listVersions(db, "", "p-1", "PRD")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(getVersion(db, "", "p-1", "PRD", 1)).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
  });

  it("rejects malformed fields without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(ensureDocument(db, "u-1", "p-1", "MANIFESTO")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(
      upsertSection(db, "u-1", "p-1", "PRD", { sectionKey: "Has Spaces", title: "A" }),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(
      upsertSection(db, "u-1", "p-1", "PRD", { sectionKey: "a", title: "   " }),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(
      upsertSection(db, "u-1", "p-1", "PRD", {
        sectionKey: "a",
        title: "A",
        status: "DRAFT" as never,
      }),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(getVersion(db, "u-1", "p-1", "PRD", 0)).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("specification domain model (integration)", () => {
  it("creates documents idempotently and addresses sections individually", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `spec-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "S", idea: "specs" });
        const pid = project.project.id;
        const before = await getStateVersion(db, owner.id, pid);

        const doc = await ensureDocument(db, owner.id, pid, "PRD");
        expect(doc.documentType).toBe("PRD");
        expect(doc.status).toBe("DRAFT");
        expect(doc.currentVersion).toBe(1);
        // Idempotent: second ensure returns the same row, no duplicate.
        expect((await ensureDocument(db, owner.id, pid, "PRD")).id).toBe(doc.id);
        // Derived writes never bump the canonical version.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        const section = await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "product.vision",
          title: "Vision",
          sortOrder: 1,
          renderedContent: "Be the best tracker.",
          status: "PROPOSED",
        });
        expect(section.sectionKey).toBe("product.vision");
        expect(section.status).toBe("PROPOSED");
        const reread = await getSection(db, owner.id, pid, "PRD", "product.vision");
        expect(reread.id).toBe(section.id);

        const updated = await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "product.vision",
          title: "Vision",
          renderedContent: "Be the best tracker, really.",
          status: "CURRENT",
        });
        expect(updated.id).toBe(section.id);
        expect(updated.renderedContent).toContain("really");
        expect(await listSections(db, owner.id, pid, "PRD")).toHaveLength(1);
        expect(await listDocuments(db, owner.id, pid)).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("snapshots immutable versions bound to the state version", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `sver-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "V", idea: "versions" });
        const pid = project.project.id;
        await ensureDocument(db, owner.id, pid, "PRD");
        await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "a",
          title: "A",
          renderedContent: "v1 content",
        });

        const stateVersion = await getStateVersion(db, owner.id, pid);
        const snap = await createVersion(db, owner.id, pid, "PRD");
        expect(snap.version).toBe(1);
        expect(snap.projectStateVersion).toBe(stateVersion);
        expect(snap.content).toContain("v1 content");
        expect((await getDocument(db, owner.id, pid, "PRD")).currentVersion).toBe(2);
        expect((await getDocument(db, owner.id, pid, "PRD")).status).toBe("CURRENT");

        // History distinguishable; second snapshot advances.
        await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "a",
          title: "A",
          renderedContent: "v2 content",
        });
        const snap2 = await createVersion(db, owner.id, pid, "PRD");
        expect(snap2.version).toBe(2);
        expect((await getVersion(db, owner.id, pid, "PRD", 1)).content).toContain("v1 content");
        expect(await listVersions(db, owner.id, pid, "PRD")).toHaveLength(2);
        await expect(getVersion(db, owner.id, pid, "PRD", 9)).rejects.toBeInstanceOf(
          SpecificationNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("represents staleness without touching canonical state", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `stale-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "T", idea: "stale" });
        const pid = project.project.id;
        await upsertSection(db, owner.id, pid, "ARCHITECTURE", {
          sectionKey: "architecture.authentication",
          title: "Authentication",
          renderedContent: "Google only.",
        });
        const before = await getStateVersion(db, owner.id, pid);

        const stale = await markSectionStale(
          db,
          owner.id,
          pid,
          "ARCHITECTURE",
          "architecture.authentication",
        );
        expect(stale.status).toBe("STALE");
        // Idempotent + version untouched (derived state).
        await markSectionStale(db, owner.id, pid, "ARCHITECTURE", "architecture.authentication");
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        const moved = await updateDocumentStatus(
          db,
          owner.id,
          pid,
          "ARCHITECTURE",
          "REVIEW_REQUIRED",
        );
        expect(moved.status).toBe("REVIEW_REQUIRED");

        await expect(getSection(db, owner.id, pid, "PRD", "missing")).rejects.toBeInstanceOf(
          SpecificationNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates specifications between users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `si-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `si-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        const pid = project.project.id;
        await ensureDocument(db, a.id, pid, "PRD");

        await expect(getDocument(db, b.id, pid, "PRD")).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(listDocuments(db, b.id, pid)).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(ensureDocument(db, b.id, pid, "PRD")).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          upsertSection(db, b.id, pid, "PRD", { sectionKey: "a", title: "A" }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
