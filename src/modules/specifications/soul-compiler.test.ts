// TASK-067 acceptance: applicability is evaluated, non-applicable projects
// omit soul.md, soul defines behavior instead of duplicating technical
// instructions, output uses confirmed project intent.
//
// Unit tests pin validation without AI or DB. Compiler proofs run as
// rolled-back integration tests with a scripted FakeProvider — skipped,
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
import { FakeProvider } from "../../ai/providers/fake";
import { PromptRegistry } from "../../ai/prompts/registry";
import type { SoulCompilation } from "../../ai/schemas/soul-compilation";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { getSection, listDocuments } from "./documents";
import { compileSoul, evaluateSoulApplicability, SoulCompilerError } from "./soul-compiler";

const EMPTY: SoulCompilation = { sections: [], unknowns: [] };

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("soul compiler input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(compileSoul(db, "  ", "p-1")).rejects.toBeInstanceOf(SoulCompilerError);
    await expect(compileSoul(db, "u-1", "  ")).rejects.toBeInstanceOf(SoulCompilerError);
    await expect(evaluateSoulApplicability(db, "  ", "p-1")).rejects.toBeInstanceOf(
      SoulCompilerError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("soul compiler (integration, fakes only)", () => {
  async function setupSoulProject(
    db: AppDatabase,
    email: string,
    confidence: "EXPLICIT" | "INFERRED" | "ASSUMED",
  ) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "P", idea: "ai novelist" });
    const pid = project.project.id;
    const knowledge = await createKnowledgeItem(db, owner.id, pid, {
      knowledgeKey: "ai.behavior",
      domain: "AI",
      title: "Writing companion",
      content: { summary: "a calm, encouraging co-writer" },
      confidence,
      sources: [{ type: "PROJECT_INPUT" }],
    });
    return { owner, pid, knowledge };
  }

  it("omits soul.md for non-AI projects without calling the provider", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `soul-skip-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "P", idea: "expense tracker" });
        const pid = project.project.id;

        const provider = new FakeProvider([{ kind: "structured", json: JSON.stringify(EMPTY) }]);
        const compiled = await compileSoul(db, owner.id, pid, {
          provider,
          prompts: new PromptRegistry(),
          cache: null,
        });
        expect(compiled.applicable).toBe(false);
        expect(compiled.sections).toEqual([]);
        expect(compiled.unknowns).toBeNull();
        expect(compiled.operationId).toBeNull();
        expect(provider.calls).toHaveLength(0);
        const docs = await listDocuments(db, owner.id, pid);
        expect(docs.map((doc) => doc.documentType)).not.toContain("SOUL");
      });
    } finally {
      await pool.end();
    }
  });

  it("withholds soul.md when AI intent is only inferred", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupSoulProject(
          db,
          `soul-inferred-${Date.now()}@example.com`,
          "INFERRED",
        );
        const applicability = await evaluateSoulApplicability(db, owner.id, pid);
        expect(applicability.agentsApplicable).toBe(true);
        expect(applicability.applicable).toBe(false);
        expect(applicability.explicitAiKnowledgeCount).toBe(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("compiles principled behavior from explicitly confirmed AI intent", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid, knowledge } = await setupSoulProject(
          db,
          `soul-${Date.now()}@example.com`,
          "EXPLICIT",
        );
        const before = await getStateVersion(db, owner.id, pid);

        const proposal: SoulCompilation = {
          sections: [
            {
              key: "soul.voice",
              title: "Voice",
              body: "A calm co-writer: encouraging, precise, never salesy.",
              principles: ["Encourage the writer; never judge the draft."],
              knowledgeKeys: [knowledge.knowledgeKey],
            },
          ],
          unknowns: [{ topic: "Formality", detail: "Which register for dialogue feedback?" }],
        };
        const compiled = await compileSoul(db, owner.id, pid, depsFor(proposal));
        expect(compiled.applicable).toBe(true);
        expect(compiled.sections).toHaveLength(1);
        expect(compiled.sections[0]?.status).toBe("PROPOSED");
        expect(compiled.unknowns?.sectionKey).toBe("soul.unknowns");
        expect(compiled.operationId).not.toBeNull();
        // Canonical version untouched by derived compilation.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        const stored = await getSection(db, owner.id, pid, "SOUL", "soul.voice");
        const structured = stored.structuredContent as {
          principles: string[];
          knowledgeKeys: string[];
        };
        expect(structured.principles).toEqual(["Encourage the writer; never judge the draft."]);
        expect(structured.knowledgeKeys).toEqual([knowledge.knowledgeKey]);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects principle-free sections", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, pid } = await setupSoulProject(
          db,
          `soul-bad-${Date.now()}@example.com`,
          "EXPLICIT",
        );
        const unprincipled: SoulCompilation = {
          sections: [
            {
              key: "soul.vague",
              title: "Vibe",
              body: "Be nice.",
              principles: [],
            },
          ],
          unknowns: [],
        };
        await expect(compileSoul(db, owner.id, pid, depsFor(unprincipled))).rejects.toBeInstanceOf(
          SoulCompilerError,
        );
      });
    } finally {
      await pool.end();
    }
  });
});
