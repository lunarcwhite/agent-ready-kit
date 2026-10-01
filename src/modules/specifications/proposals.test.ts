// TASK-132 acceptance: proposals store target/previous/proposed/reason;
// PENDING/ACCEPTED/REJECTED enforced; accept applies atomically while
// reject leaves approved state intact; stale proposals are detectable.
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
import { getStateVersion } from "../projects/state-version";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { getSection, upsertSection } from "./documents";
import { SpecificationNotFoundError, SpecificationValidationError } from "./errors";
import {
  acceptProposal,
  getProposal,
  isProposalStale,
  listProposals,
  proposeSectionChange,
  rejectProposal,
} from "./proposals";

describe("proposal input validation", () => {
  it("rejects blank owner, blank reason, and empty changes without touching the DB", async () => {
    const db = {} as AppDatabase;
    await expect(
      proposeSectionChange(db, "  ", "p-1", {
        documentType: "PRD",
        sectionKey: "product.scope",
        renderedContent: "New.",
        reason: "Why.",
      }),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(
      proposeSectionChange(db, "u-1", "p-1", {
        documentType: "PRD",
        sectionKey: "product.scope",
        renderedContent: "New.",
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(
      proposeSectionChange(db, "u-1", "p-1", {
        documentType: "PRD",
        sectionKey: "product.scope",
        reason: "Why.",
      }),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(listProposals(db, "  ", "p-1")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(acceptProposal(db, "u-1", "p-1", "  ")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("proposed-change lifecycle (integration)", () => {
  async function setupSection(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "C", idea: "changes" });
    const pid = project.project.id;
    await upsertSection(db, owner.id, pid, "PRD", {
      sectionKey: "product.scope",
      title: "Scope",
      renderedContent: "Old scope text.",
      status: "STALE",
    });
    return { owner, pid };
  }

  it("proposes with previous/proposed snapshots and accepts atomically", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupSection(db, `change-${Date.now()}@example.com`);
        const base = await getStateVersion(db, owner.id, pid);

        const proposal = await proposeSectionChange(db, owner.id, pid, {
          documentType: "PRD",
          sectionKey: "product.scope",
          renderedContent: "New scope text.",
          reason: "Scope narrowed after review.",
        });
        expect(proposal.status).toBe("PENDING");
        expect(proposal.baseStateVersion).toBe(base);
        expect(proposal.reason).toBe("Scope narrowed after review.");
        expect(proposal.previousContent).toMatchObject({
          title: "Scope",
          renderedContent: "Old scope text.",
        });
        expect(proposal.proposedContent).toMatchObject({
          title: "Scope",
          renderedContent: "New scope text.",
        });
        expect(await isProposalStale(db, owner.id, pid, proposal.id)).toBe(false);

        const accepted = await acceptProposal(db, owner.id, pid, proposal.id);
        expect(accepted.proposal.status).toBe("ACCEPTED");
        expect(accepted.proposal.reviewedAt).not.toBeNull();
        expect(accepted.section.renderedContent).toBe("New scope text.");
        expect(accepted.section.status).toBe("CURRENT");

        // Second accept is refused: terminal states are final.
        await expect(acceptProposal(db, owner.id, pid, proposal.id)).rejects.toBeInstanceOf(
          SpecificationValidationError,
        );
        await expect(rejectProposal(db, owner.id, pid, proposal.id)).rejects.toBeInstanceOf(
          SpecificationValidationError,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects without touching the approved section", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupSection(db, `reject-${Date.now()}@example.com`);
        const proposal = await proposeSectionChange(db, owner.id, pid, {
          documentType: "PRD",
          sectionKey: "product.scope",
          renderedContent: "Unwanted rewrite.",
          reason: "Testing rejection.",
        });
        const rejected = await rejectProposal(db, owner.id, pid, proposal.id);
        expect(rejected.status).toBe("REJECTED");
        expect(rejected.reviewedAt).not.toBeNull();
        expect((await getSection(db, owner.id, pid, "PRD", "product.scope")).renderedContent).toBe(
          "Old scope text.",
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("detects stale proposals when canonical state moves on", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupSection(db, `stale-${Date.now()}@example.com`);
        const proposal = await proposeSectionChange(db, owner.id, pid, {
          documentType: "PRD",
          sectionKey: "product.scope",
          renderedContent: "New scope text.",
          reason: "Testing staleness.",
        });
        // Canonical move unrelated to the section still retires the review basis.
        await createKnowledgeItem(db, owner.id, pid, {
          knowledgeKey: "vision.summary",
          domain: "Vision",
          title: "Tracker",
          content: { summary: "task tracker" },
          confidence: "EXPLICIT",
          sources: [{ type: "PROJECT_INPUT" }],
        });

        expect(await isProposalStale(db, owner.id, pid, proposal.id)).toBe(true);
        await expect(acceptProposal(db, owner.id, pid, proposal.id)).rejects.toBeInstanceOf(
          SpecificationValidationError,
        );
        // Refused accept leaves everything intact.
        expect((await getProposal(db, owner.id, pid, proposal.id)).status).toBe("PENDING");
        expect((await getSection(db, owner.id, pid, "PRD", "product.scope")).renderedContent).toBe(
          "Old scope text.",
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("keeps proposals invisible across projects", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupSection(db, `iso-${Date.now()}@example.com`);
        const proposal = await proposeSectionChange(db, owner.id, pid, {
          documentType: "PRD",
          sectionKey: "product.scope",
          renderedContent: "New scope text.",
          reason: "Testing isolation.",
        });
        const [other] = await db
          .insert(schema.users)
          .values({ email: `iso-other-${Date.now()}@example.com` })
          .returning();
        const otherProject = await createProject(db, other.id, { name: "O", idea: "other" });

        await expect(
          getProposal(db, other.id, otherProject.project.id, proposal.id),
        ).rejects.toBeInstanceOf(SpecificationNotFoundError);
        expect(await listProposals(db, other.id, otherProject.project.id)).toEqual([]);
        expect((await listProposals(db, owner.id, pid)).map((row) => row.id)).toEqual([
          proposal.id,
        ]);
      });
    } finally {
      await pool.end();
    }
  });
});
