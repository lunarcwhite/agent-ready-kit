// TASK-070 acceptance: issue type/severity stored, artifacts linkable,
// OPEN/RESOLVED/IGNORED policy, resolution metadata, auditable history.
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
import { IssueNotFoundError, IssueValidationError } from "./errors";
import {
  addIssueReferences,
  createIssue,
  getIssueByCode,
  listIssueReferences,
  listIssues,
  resolveIssue,
  updateIssue,
  type CreateIssueInput,
} from "./issues";

const BASE: CreateIssueInput = {
  type: "CONSISTENCY",
  severity: "HIGH",
  title: "Contradictory retention statements",
  description: "PRD requires deletion while architecture retains data indefinitely.",
};

describe("issue input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(createIssue(db, "  ", "p-1", BASE)).rejects.toBeInstanceOf(IssueValidationError);
    await expect(getIssueByCode(db, "", "p-1", "ISSUE-001")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
    await expect(listIssues(db, "", "p-1")).rejects.toBeInstanceOf(IssueValidationError);
    await expect(updateIssue(db, "", "p-1", "ISSUE-001", {})).rejects.toBeInstanceOf(
      IssueValidationError,
    );
    await expect(addIssueReferences(db, "", "p-1", "ISSUE-001", [])).rejects.toBeInstanceOf(
      IssueValidationError,
    );
    await expect(resolveIssue(db, "", "p-1", "ISSUE-001", "fixed")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
    await expect(listIssueReferences(db, "", "p-1", "ISSUE-001")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
  });

  it("rejects malformed fields without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(createIssue(db, "u-1", "p-1", { ...BASE, title: "   " })).rejects.toBeInstanceOf(
      IssueValidationError,
    );
    await expect(
      createIssue(db, "u-1", "p-1", { ...BASE, type: "TYPO" as never }),
    ).rejects.toBeInstanceOf(IssueValidationError);
    await expect(
      createIssue(db, "u-1", "p-1", { ...BASE, severity: "URGENT" as never }),
    ).rejects.toBeInstanceOf(IssueValidationError);
    await expect(
      createIssue(db, "u-1", "p-1", {
        ...BASE,
        references: [
          {
            referenceType: "DECISION",
            referenceId: "not-a-uuid",
            relationship: "AFFECTED",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(IssueValidationError);
    await expect(
      createIssue(db, "u-1", "p-1", {
        ...BASE,
        references: [
          {
            referenceType: "WIKI" as never,
            referenceId: "123e4567-e89b-12d3-a456-426614174000",
            relationship: "AFFECTED",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(IssueValidationError);
    await expect(
      updateIssue(db, "u-1", "p-1", "ISSUE-001", { status: "DONE" as never }),
    ).rejects.toBeInstanceOf(IssueValidationError);
    await expect(
      listIssues(db, "u-1", "p-1", { severity: "URGENT" as never }),
    ).rejects.toBeInstanceOf(IssueValidationError);
    await expect(resolveIssue(db, "u-1", "p-1", "ISSUE-001", "   ")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
    await expect(getIssueByCode(db, "u-1", "p-1", "   ")).rejects.toBeInstanceOf(
      IssueValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("validation issue domain model (integration)", () => {
  it("creates an issue with a stable code and bumps the version", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `iss-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "V", idea: "issues" });
        const pid = project.project.id;

        const created = await createIssue(db, owner.id, pid, BASE);
        expect(created.issueCode).toBe("ISSUE-001");
        expect(created.type).toBe("CONSISTENCY");
        expect(created.severity).toBe("HIGH");
        expect(created.status).toBe("OPEN");
        expect(created.resolvedAt).toBeNull();
        expect(created.references).toEqual([]);
        expect(await getStateVersion(db, owner.id, pid)).toBe(2);

        const reread = await getIssueByCode(db, owner.id, pid, "ISSUE-001");
        expect(reread.id).toBe(created.id);
        const second = await createIssue(db, owner.id, pid, {
          ...BASE,
          title: "Second",
          severity: "INFO",
        });
        expect(second.issueCode).toBe("ISSUE-002");
        expect(await listIssues(db, owner.id, pid)).toHaveLength(2);
        expect(await listIssues(db, owner.id, pid, { severity: "INFO" })).toHaveLength(1);
        expect(await listIssues(db, owner.id, pid, { type: "CONSISTENCY" })).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("enforces status policy and freezes resolved rows", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `isp-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "P", idea: "policy" });
        const pid = project.project.id;
        await createIssue(db, owner.id, pid, BASE);

        const ignored = await updateIssue(db, owner.id, pid, "ISSUE-001", { status: "IGNORED" });
        expect(ignored.status).toBe("IGNORED");
        // IGNORED cannot resolve directly — it reopens first.
        await expect(resolveIssue(db, owner.id, pid, "ISSUE-001", "fixed")).rejects.toBeInstanceOf(
          IssueValidationError,
        );
        const reopened = await updateIssue(db, owner.id, pid, "ISSUE-001", { status: "OPEN" });
        expect(reopened.status).toBe("OPEN");

        const before = await getStateVersion(db, owner.id, pid);
        const resolved = await resolveIssue(
          db,
          owner.id,
          pid,
          "ISSUE-001",
          "Kept the PRD wording.",
        );
        expect(resolved.status).toBe("RESOLVED");
        expect(resolved.resolvedAt).toBeInstanceOf(Date);
        expect(resolved.metadata?.resolution).toBe("Kept the PRD wording.");
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 1);

        // Frozen rows reject edits and links; double resolve is rejected.
        await expect(
          updateIssue(db, owner.id, pid, "ISSUE-001", { severity: "LOW" }),
        ).rejects.toBeInstanceOf(IssueValidationError);
        await expect(addIssueReferences(db, owner.id, pid, "ISSUE-001", [])).rejects.toBeInstanceOf(
          IssueValidationError,
        );
        await expect(resolveIssue(db, owner.id, pid, "ISSUE-001", "again")).rejects.toBeInstanceOf(
          IssueValidationError,
        );

        // Reopen clears the server-owned stamp; history stays queryable.
        const back = await updateIssue(db, owner.id, pid, "ISSUE-001", { status: "OPEN" });
        expect(back.status).toBe("OPEN");
        expect(back.resolvedAt).toBeNull();
        expect(back.metadata?.resolution).toBe("Kept the PRD wording.");
        expect(await getIssueByCode(db, owner.id, pid, "ISSUE-001")).toBeDefined();
      });
    } finally {
      await pool.end();
    }
  });

  it("links artifacts idempotently and rejects foreign refs", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `isr-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "R", idea: "refs" });
        const pid = project.project.id;
        const [decision] = await db
          .insert(schema.decisions)
          .values({
            projectId: pid,
            decisionKey: "authentication.required",
            decisionCode: "DEC-AUTH-001",
            category: "AUTH",
            title: "Require authentication",
            status: "CONFIRMED",
            impact: "HIGH",
            sourceType: "USER",
            confidence: "EXPLICIT",
          })
          .returning();

        const before = await getStateVersion(db, owner.id, pid);
        await createIssue(db, owner.id, pid, BASE);
        const linked = await addIssueReferences(db, owner.id, pid, "ISSUE-001", [
          { referenceType: "DECISION", referenceId: decision.id, relationship: "SOURCE" },
        ]);
        expect(linked.references).toHaveLength(1);
        expect(linked.references[0]?.relationship).toBe("SOURCE");
        // One create + one link append = two version bumps.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 2);

        // Exact-duplicate retry is idempotent: no new row, no version bump.
        const version = await getStateVersion(db, owner.id, pid);
        const deduped = await addIssueReferences(db, owner.id, pid, "ISSUE-001", [
          { referenceType: "DECISION", referenceId: decision.id, relationship: "SOURCE" },
        ]);
        expect(deduped.references).toHaveLength(1);
        expect(await getStateVersion(db, owner.id, pid)).toBe(version);
        expect(await listIssueReferences(db, owner.id, pid, "ISSUE-001")).toHaveLength(1);

        // TASK refs are structural-only until the user-task model lands.
        const tasky = await addIssueReferences(db, owner.id, pid, "ISSUE-001", [
          {
            referenceType: "TASK",
            referenceId: "123e4567-e89b-12d3-a456-426614174000",
            relationship: "AFFECTED",
          },
        ]);
        expect(tasky.references).toHaveLength(2);

        // Another user's decision never resolves — surfaced as validation,
        // never revealing the foreign row.
        const [stranger] = await db
          .insert(schema.users)
          .values({ email: `isx-${stamp}@example.com` })
          .returning();
        const foreign = await createProject(db, stranger.id, { name: "F", idea: "foreign" });
        const [foreignDecision] = await db
          .insert(schema.decisions)
          .values({
            projectId: foreign.project.id,
            decisionKey: "authentication.required",
            decisionCode: "DEC-AUTH-001",
            category: "AUTH",
            title: "Foreign",
            status: "CONFIRMED",
            impact: "HIGH",
            sourceType: "USER",
            confidence: "EXPLICIT",
          })
          .returning();
        await expect(
          addIssueReferences(db, owner.id, pid, "ISSUE-001", [
            {
              referenceType: "DECISION",
              referenceId: foreignDecision.id,
              relationship: "AFFECTED",
            },
          ]),
        ).rejects.toBeInstanceOf(IssueValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("isolates issues between users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `is-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `is-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        await createIssue(db, a.id, project.project.id, BASE);

        await expect(
          getIssueByCode(db, b.id, project.project.id, "ISSUE-001"),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(listIssues(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(createIssue(db, b.id, project.project.id, BASE)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          getIssueByCode(db, a.id, project.project.id, "ISSUE-999"),
        ).rejects.toBeInstanceOf(IssueNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
