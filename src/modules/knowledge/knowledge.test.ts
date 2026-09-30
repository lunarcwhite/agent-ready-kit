// TASK-055 acceptance: project-scoped items, provenance sources, active/
// superseded lifecycle, decision source refs, deterministic duplicate
// detection/merge, efficient current-knowledge queries.
//
// Unit tests pin validation, taxonomy mapping, and provenance without a
// database. Row-level proofs run as rolled-back integration tests — skipped,
// not failed, without TEST_DATABASE_URL/DATABASE_URL.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { createDecision } from "../decisions/decisions";
import { createProject } from "../projects/repository";
import { ProjectNotFoundError } from "../projects/errors";
import { getStateVersion } from "../projects/state-version";
import { KnowledgeNotFoundError, KnowledgeValidationError } from "./errors";
import {
  addKnowledgeSources,
  createKnowledgeItem,
  findDuplicateCandidates,
  getKnowledgeByKey,
  listCurrentKnowledge,
  listKnowledge,
  markKnowledgeStale,
  mergeKnowledgeItems,
  resolveKnowledgeProvenance,
  supersedeKnowledgeItem,
  updateKnowledgeItem,
  withKnowledgeProvenance,
  type CreateKnowledgeInput,
} from "./knowledge";
import { normalizeKnowledgeDomain } from "./taxonomy";

const BASE: CreateKnowledgeInput = {
  knowledgeKey: "vision.summary",
  domain: "Vision",
  title: "Personal task tracker",
  content: { summary: "A local-first task tracker for one user." },
  confidence: "EXPLICIT",
  sources: [{ type: "PROJECT_INPUT" }],
};

describe("knowledge taxonomy (§18a mapping)", () => {
  it("resolves synonyms to one canonical domain per concept", () => {
    expect(normalizeKnowledgeDomain("Vision")).toBe("PRODUCT");
    expect(normalizeKnowledgeDomain("scope")).toBe("PRODUCT");
    expect(normalizeKnowledgeDomain("Users")).toBe("USER");
    expect(normalizeKnowledgeDomain("personas")).toBe("USER");
    expect(normalizeKnowledgeDomain("Features")).toBe("FEATURE");
    expect(normalizeKnowledgeDomain("business rules")).toBe("BUSINESS_RULE");
    expect(normalizeKnowledgeDomain("Entities")).toBe("DATA");
    expect(normalizeKnowledgeDomain("Integrations")).toBe("INTEGRATION");
    expect(normalizeKnowledgeDomain("technical decisions")).toBe("TECHNICAL");
    expect(normalizeKnowledgeDomain("design decisions")).toBe("UX");
    expect(normalizeKnowledgeDomain("ai behavior")).toBe("AI");
    expect(normalizeKnowledgeDomain("constraints")).toBe("NON_FUNCTIONAL");
    expect(normalizeKnowledgeDomain("access")).toBe("ACCESS");
  });

  it("rejects unknown domains instead of misfiling knowledge", () => {
    expect(() => normalizeKnowledgeDomain("vibes")).toThrow(KnowledgeValidationError);
    expect(() => normalizeKnowledgeDomain("")).toThrow(KnowledgeValidationError);
  });
});

describe("knowledge input validation", () => {
  it("rejects blank owner without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(createKnowledgeItem(db, "  ", "p-1", BASE)).rejects.toBeInstanceOf(
      KnowledgeValidationError,
    );
    await expect(getKnowledgeByKey(db, "", "p-1", "vision.summary")).rejects.toBeInstanceOf(
      KnowledgeValidationError,
    );
    await expect(listKnowledge(db, "", "p-1")).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(updateKnowledgeItem(db, "", "p-1", "vision.summary", {})).rejects.toBeInstanceOf(
      KnowledgeValidationError,
    );
    await expect(
      supersedeKnowledgeItem(db, "", "p-1", "vision.summary", { newKey: "vision.summary2" }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(mergeKnowledgeItems(db, "", "p-1", "a", "b")).rejects.toBeInstanceOf(
      KnowledgeValidationError,
    );
  });

  it("rejects malformed fields without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", { ...BASE, knowledgeKey: "  " }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", { ...BASE, knowledgeKey: "Has Spaces" }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", { ...BASE, domain: "vibes" }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", { ...BASE, title: "   " }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", { ...BASE, content: undefined }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", { ...BASE, confidence: "MAYBE" as never }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", {
        ...BASE,
        sources: [{ type: "RUMOR" as never }],
      }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", {
        ...BASE,
        sources: [{ type: "DECISION" }],
      }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      createKnowledgeItem(db, "u-1", "p-1", {
        ...BASE,
        sources: [{ type: "DECISION", sourceId: "not-a-uuid" }],
      }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      updateKnowledgeItem(db, "u-1", "p-1", "vision.summary", { status: "SUPERSEDED" as never }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(
      supersedeKnowledgeItem(db, "u-1", "p-1", "vision.summary", { newKey: "vision.summary" }),
    ).rejects.toBeInstanceOf(KnowledgeValidationError);
    await expect(mergeKnowledgeItems(db, "u-1", "p-1", "a", "a")).rejects.toBeInstanceOf(
      KnowledgeValidationError,
    );
  });
});

describe("knowledge provenance", () => {
  it("carries no origin claim without sources", () => {
    expect(resolveKnowledgeProvenance([], "EXPLICIT")).toBeNull();
  });

  it("distinguishes user facts from AI assumptions", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(
      resolveKnowledgeProvenance([{ sourceType: "PROJECT_INPUT", createdAt: at }], "EXPLICIT"),
    ).toBe("USER_EXPLICIT");
    expect(
      resolveKnowledgeProvenance([{ sourceType: "USER_MESSAGE", createdAt: at }], "INFERRED"),
    ).toBe("USER_IMPLIED");
    expect(
      resolveKnowledgeProvenance([{ sourceType: "AI_INFERENCE", createdAt: at }], "INFERRED"),
    ).toBe("AI_ASSUMED");
    // ASSUMED never reads as a confirmed user fact, whatever the source.
    expect(
      resolveKnowledgeProvenance([{ sourceType: "PROJECT_INPUT", createdAt: at }], "ASSUMED"),
    ).not.toBe("USER_EXPLICIT");
    expect(
      withKnowledgeProvenance({
        sources: [{ sourceType: "PROJECT_INPUT", createdAt: at }] as never,
        confidence: "EXPLICIT",
      }).provenance,
    ).toBe("USER_EXPLICIT");
  });

  it("uses the earliest source as the primary origin", () => {
    const early = new Date("2026-01-01T00:00:00Z");
    const late = new Date("2026-02-01T00:00:00Z");
    expect(
      resolveKnowledgeProvenance(
        [
          { sourceType: "AI_INFERENCE", createdAt: late },
          { sourceType: "PROJECT_INPUT", createdAt: early },
        ],
        "EXPLICIT",
      ),
    ).toBe("USER_EXPLICIT");
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("knowledge domain model (integration)", () => {
  it("creates an item with provenance and bumps the version", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `know-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "K", idea: "knowledge" });
        const pid = project.project.id;

        const created = await createKnowledgeItem(db, owner.id, pid, BASE);
        expect(created.knowledgeKey).toBe("vision.summary");
        expect(created.domain).toBe("PRODUCT");
        expect(created.status).toBe("CURRENT");
        expect(created.sources).toHaveLength(1);
        expect(await getStateVersion(db, owner.id, pid)).toBe(2);

        const reread = await getKnowledgeByKey(db, owner.id, pid, "vision.summary");
        expect(reread.id).toBe(created.id);
        expect(await listCurrentKnowledge(db, owner.id, pid)).toHaveLength(1);
        expect(await listKnowledge(db, owner.id, pid, { domain: "USER" })).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("references source decisions and rejects cross-project links", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `kd-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `kd-b-${stamp}@example.com` })
          .returning();
        const pa = await createProject(db, a.id, { name: "A", idea: "a" });
        const pb = await createProject(db, b.id, { name: "B", idea: "b" });
        const decision = await createDecision(db, a.id, pa.project.id, {
          decisionKey: "authentication.required",
          category: "AUTH",
          title: "Require auth",
          status: "CONFIRMED",
          impact: "HIGH",
          sourceType: "USER",
          confidence: "EXPLICIT",
        });

        const item = await createKnowledgeItem(db, a.id, pa.project.id, {
          ...BASE,
          sources: [{ type: "DECISION", sourceId: decision.id }],
        });
        expect(item.sources[0]?.sourceId).toBe(decision.id);

        // Foreign decision id: rejected, never revealing the other project.
        await expect(
          createKnowledgeItem(db, b.id, pb.project.id, {
            ...BASE,
            sources: [{ type: "DECISION", sourceId: decision.id }],
          }),
        ).rejects.toBeInstanceOf(KnowledgeValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("updates in place, marks stale idempotently, and freezes superseded rows", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `ku-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "U", idea: "updates" });
        const pid = project.project.id;
        await createKnowledgeItem(db, owner.id, pid, BASE);

        const updated = await updateKnowledgeItem(db, owner.id, pid, "vision.summary", {
          title: "Renamed",
        });
        expect(updated.title).toBe("Renamed");
        expect(updated.knowledgeKey).toBe("vision.summary");

        const before = await getStateVersion(db, owner.id, pid);
        const stale = await markKnowledgeStale(db, owner.id, pid, "vision.summary");
        expect(stale.status).toBe("STALE");
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 1);
        // Idempotent retry burns no version.
        await markKnowledgeStale(db, owner.id, pid, "vision.summary");
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 1);

        const { old, next } = await supersedeKnowledgeItem(db, owner.id, pid, "vision.summary", {
          newKey: "vision.summary.v2",
          title: "V2",
        });
        expect(old.status).toBe("SUPERSEDED");
        expect(next.status).toBe("CURRENT");
        expect(next.title).toBe("V2");
        // Provenance carries over to the successor.
        expect(next.sources).toHaveLength(old.sources.length);
        // Frozen rows reject edits; the old key is never reused.
        await expect(
          updateKnowledgeItem(db, owner.id, pid, "vision.summary", { title: "x" }),
        ).rejects.toBeInstanceOf(KnowledgeValidationError);
        await expect(
          createKnowledgeItem(db, owner.id, pid, { ...BASE, title: "Reuse" }),
        ).rejects.toBeInstanceOf(KnowledgeValidationError);
        expect(await listCurrentKnowledge(db, owner.id, pid)).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("detects duplicates deterministically and merges without losing provenance", async () => {
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

        await createKnowledgeItem(db, owner.id, pid, {
          ...BASE,
          knowledgeKey: "users.primary",
          domain: "Users",
          title: "Solo user",
          content: { users: ["owner"] },
          sources: [{ type: "PROJECT_INPUT" }],
        });
        await createKnowledgeItem(db, owner.id, pid, {
          ...BASE,
          knowledgeKey: "users.persona",
          domain: "Personas",
          title: "  SOLO   user ",
          content: { other: true },
          sources: [{ type: "USER_MESSAGE" }],
        });
        await createKnowledgeItem(db, owner.id, pid, {
          ...BASE,
          knowledgeKey: "features.other",
          domain: "Features",
          title: "Solo user",
          content: { other: true },
        });

        // Same domain (both → USER) + normalized title match groups the pair;
        // the FEATURE item with an identical title stays out (cross-domain
        // merges are rejected, so grouping across domains would be noise).
        const groups = await findDuplicateCandidates(db, owner.id, pid);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.items.map((i) => i.knowledgeKey)).toEqual([
          "users.persona",
          "users.primary",
        ]);

        const before = await getStateVersion(db, owner.id, pid);
        const winner = await mergeKnowledgeItems(
          db,
          owner.id,
          pid,
          "users.primary",
          "users.persona",
        );
        expect(winner.knowledgeKey).toBe("users.primary");
        // Loser provenance re-points to the winner: nothing is lost.
        expect(winner.sources.map((s) => s.sourceType).sort()).toEqual([
          "PROJECT_INPUT",
          "USER_MESSAGE",
        ]);
        expect((await getKnowledgeByKey(db, owner.id, pid, "users.persona")).status).toBe(
          "SUPERSEDED",
        );
        expect(await getStateVersion(db, owner.id, pid)).toBe(before + 1);
        expect(await findDuplicateCandidates(db, owner.id, pid)).toHaveLength(0);
        await expect(
          mergeKnowledgeItems(db, owner.id, pid, "users.primary", "features.other"),
        ).rejects.toBeInstanceOf(KnowledgeValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("dedupes retried source links and isolates knowledge between users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `ki-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `ki-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        const pid = project.project.id;
        await createKnowledgeItem(db, a.id, pid, BASE);

        const before = await getStateVersion(db, a.id, pid);
        const relinked = await addKnowledgeSources(db, a.id, pid, "vision.summary", [
          { type: "PROJECT_INPUT" },
        ]);
        expect(relinked.sources).toHaveLength(1);
        expect(await getStateVersion(db, a.id, pid)).toBe(before);

        await expect(getKnowledgeByKey(db, b.id, pid, "vision.summary")).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(listKnowledge(db, b.id, pid)).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(createKnowledgeItem(db, b.id, pid, BASE)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(getKnowledgeByKey(db, a.id, pid, "vision.missing")).rejects.toBeInstanceOf(
          KnowledgeNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
