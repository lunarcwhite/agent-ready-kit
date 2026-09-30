// TASK-056 acceptance: structured proposals, application validation,
// duplicate consolidation, provenance preservation, historical supersede,
// no weaker-inference overwrite.
//
// Unit tests pin input validation without a database. Proposal/apply proofs
// run as rolled-back integration tests with a scripted FakeProvider —
// skipped, not failed, without TEST_DATABASE_URL/DATABASE_URL.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import { createDecision } from "../decisions/decisions";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import type { KnowledgeCuration } from "../../ai/schemas/knowledge-curation";
import { createKnowledgeItem, getKnowledgeByKey, listCurrentKnowledge } from "./knowledge";
import { applyCuration, curateKnowledge, CuratorError } from "./curator";

const EMPTY_PROPOSAL: KnowledgeCuration = { create: [], update: [], supersede: [], sources: [] };

function depsFor(proposal: unknown, scripts?: { kind: "fail"; code: "PROVIDER_UNAVAILABLE" }) {
  const provider = scripts
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("curator input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(curateKnowledge(db, "  ", "p-1")).rejects.toBeInstanceOf(CuratorError);
    await expect(curateKnowledge(db, "u-1", "  ")).rejects.toBeInstanceOf(CuratorError);
    await expect(applyCuration(db, "", "p-1", EMPTY_PROPOSAL)).rejects.toBeInstanceOf(CuratorError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("knowledge curator (integration, fakes only)", () => {
  it("proposes without writing, then applies creates with provenance", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `kc-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "C", idea: "curator" });
        const pid = project.project.id;
        const decision = await createDecision(db, owner.id, pid, {
          decisionKey: "product.audience",
          category: "PRODUCT",
          title: "Audience",
          status: "CONFIRMED",
          impact: "MEDIUM",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: "solo founders",
        });
        const before = await getStateVersion(db, owner.id, pid);

        const proposal: KnowledgeCuration = {
          ...EMPTY_PROPOSAL,
          create: [
            {
              key: "users.primary",
              domain: "Users",
              title: "Solo founder",
              content: { audience: "solo founders" },
              confidence: "EXPLICIT",
              sources: [{ type: "DECISION", sourceId: decision.id }],
            },
          ],
        };
        const curated = await curateKnowledge(db, owner.id, pid, {}, depsFor(proposal));
        expect(curated.proposal.create).toHaveLength(1);
        expect(curated.promptKey).toBe("knowledge.curate");
        // Proposal-only: no canonical writes.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
        expect(await listCurrentKnowledge(db, owner.id, pid)).toHaveLength(0);

        const applied = await applyCuration(db, owner.id, pid, curated.proposal);
        expect(applied.created).toEqual(["users.primary"]);
        expect(await getStateVersion(db, owner.id, pid)).toBeGreaterThan(before);
        const item = await getKnowledgeByKey(db, owner.id, pid, "users.primary");
        expect(item.domain).toBe("USER");
        expect(item.confidence).toBe("EXPLICIT");
        expect(item.sources).toHaveLength(1);
        expect(item.sources[0]?.sourceId).toBe(decision.id);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects weaker-inference overwrites of confirmed knowledge", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `kw-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "W", idea: "weaker" });
        const pid = project.project.id;
        await createKnowledgeItem(db, owner.id, pid, {
          knowledgeKey: "vision.summary",
          domain: "Vision",
          title: "Tracker",
          content: { summary: "task tracker" },
          confidence: "EXPLICIT",
          sources: [{ type: "PROJECT_INPUT" }],
        });
        const before = await getStateVersion(db, owner.id, pid);

        const downgrade: KnowledgeCuration = {
          ...EMPTY_PROPOSAL,
          update: [{ key: "vision.summary", confidence: "INFERRED" }],
        };
        await expect(
          curateKnowledge(db, owner.id, pid, {}, depsFor(downgrade)),
        ).rejects.toBeInstanceOf(CuratorError);
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
        expect((await getKnowledgeByKey(db, owner.id, pid, "vision.summary")).confidence).toBe(
          "EXPLICIT",
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects unconfirmed decision sources", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `ku-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "U", idea: "unconfirmed" });
        const pid = project.project.id;
        const recommended = await createDecision(db, owner.id, pid, {
          decisionKey: "technical.stack",
          category: "TECH",
          title: "Stack",
          status: "RECOMMENDED",
          impact: "MEDIUM",
          sourceType: "AI_RECOMMENDATION",
          confidence: "INFERRED",
          value: "nextjs",
        });

        const proposal: KnowledgeCuration = {
          ...EMPTY_PROPOSAL,
          create: [
            {
              key: "technical.stack",
              domain: "Technical",
              title: "Stack",
              content: { stack: "nextjs" },
              confidence: "INFERRED",
              sources: [{ type: "DECISION", sourceId: recommended.id }],
            },
          ],
        };
        await expect(
          curateKnowledge(db, owner.id, pid, {}, depsFor(proposal)),
        ).rejects.toBeInstanceOf(CuratorError);
        expect(await listCurrentKnowledge(db, owner.id, pid)).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("consolidates duplicates by merging into the existing successor", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `km-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "M", idea: "merge" });
        const pid = project.project.id;
        for (const [key, title, source] of [
          ["users.primary", "Solo user", "PROJECT_INPUT"],
          ["users.persona", "SOLO user", "USER_MESSAGE"],
        ] as const) {
          await createKnowledgeItem(db, owner.id, pid, {
            knowledgeKey: key,
            domain: "Users",
            title,
            content: { users: ["owner"] },
            confidence: "INFERRED",
            sources: [{ type: source }],
          });
        }

        const proposal: KnowledgeCuration = {
          ...EMPTY_PROPOSAL,
          supersede: [{ key: "users.persona", successorKey: "users.primary" }],
        };
        const curated = await curateKnowledge(db, owner.id, pid, {}, depsFor(proposal));
        const applied = await applyCuration(db, owner.id, pid, curated.proposal);
        expect(applied.merged).toEqual([{ winner: "users.primary", loser: "users.persona" }]);
        expect(applied.superseded).toHaveLength(0);
        // Loser retained historically, winner keeps both provenances.
        expect((await getKnowledgeByKey(db, owner.id, pid, "users.persona")).status).toBe(
          "SUPERSEDED",
        );
        expect((await getKnowledgeByKey(db, owner.id, pid, "users.primary")).sources).toHaveLength(
          2,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("leaves approved state intact when the provider fails", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `kf-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "F", idea: "failure" });
        const pid = project.project.id;
        const before = await getStateVersion(db, owner.id, pid);

        await expect(
          curateKnowledge(
            db,
            owner.id,
            pid,
            {},
            depsFor(EMPTY_PROPOSAL, { kind: "fail", code: "PROVIDER_UNAVAILABLE" }),
          ),
        ).rejects.toBeInstanceOf(CuratorError);
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
        expect(await listCurrentKnowledge(db, owner.id, pid)).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });
});
