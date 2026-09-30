// TASK-047 acceptance: dependency fingerprinting, prompt-version validity,
// invalidation on changed dependencies, and no stale overwrite of newer
// confirmed state. Pure cache tests run without a database; end-to-end hit
// behavior uses the ledger with fakes.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { createProject } from "../../modules/projects/repository";
import { getStateVersion } from "../../modules/projects/state-version";
import { updateProject } from "../../modules/projects/repository";
import { FakeProvider } from "../providers/fake";
import { PromptRegistry } from "../prompts/registry";
import { getOperation } from "../operations/ledger";
import type { FieldSchema } from "../validation/schema";
import { orchestrate, type OrchestrateInput } from "./orchestrator";
import { buildFingerprint, MemoryCache, type FingerprintInput } from "./cache";

const BASE: FingerprintInput = {
  capability: "answer-extraction",
  userId: "u-1",
  projectId: "p-1",
  stateVersion: 3,
  promptKey: "discovery.extract-answer",
  promptVersion: "1.0",
  taskInput: "No login.",
  contextJson: "{}",
};

describe("buildFingerprint (unit, no database)", () => {
  it("is stable for identical inputs", () => {
    expect(buildFingerprint(BASE)).toBe(buildFingerprint({ ...BASE }));
    expect(buildFingerprint(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("moves with prompt versions, state versions, and scope", () => {
    const variants: FingerprintInput[] = [
      { ...BASE, promptVersion: "1.1" },
      { ...BASE, promptKey: "other.key" },
      { ...BASE, stateVersion: 4 },
      { ...BASE, taskInput: "With login." },
      { ...BASE, contextJson: '{"a":1}' },
      { ...BASE, projectId: "p-2" },
      { ...BASE, userId: "u-2" },
      { ...BASE, capability: "idea-analysis" },
    ];
    const seen = new Set(variants.map((input) => buildFingerprint(input)));
    expect(seen.size).toBe(variants.length);
    expect(seen.has(buildFingerprint(BASE))).toBe(false);
  });
});

describe("MemoryCache (unit, no database)", () => {
  it("returns clones so callers cannot poison each other", () => {
    const cache = new MemoryCache();
    cache.set("k", { data: { ok: [1] }, model: "m" });
    const first = cache.get("k");
    (first?.data as { ok: number[] }).ok.push(2);
    expect(cache.get("k")).toEqual({ data: { ok: [1] }, model: "m" });
  });

  it("expires entries and evicts oldest-first", () => {
    const cache = new MemoryCache(2, 1000);
    cache.set("a", { data: 1, model: "m" }, 0);
    cache.set("b", { data: 2, model: "m" }, 0);
    expect(cache.get("a", 999)).toEqual({ data: 1, model: "m" });
    expect(cache.get("a", 1000)).toBeUndefined();
    cache.set("c", { data: 3, model: "m" }, 0);
    expect(cache.size).toBe(2);
    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("b", 0)).toEqual({ data: 2, model: "m" });
    expect(cache.get("c", 0)).toEqual({ data: 3, model: "m" });
  });

  it("rejects nonsense configuration", () => {
    expect(() => new MemoryCache(0)).toThrow();
    expect(() => new MemoryCache(10, 0)).toThrow();
  });
});

const SCHEMA: FieldSchema = {
  type: "object",
  properties: { ok: { type: "boolean", required: true } },
  additionalProperties: false,
};

const PROMPT = {
  key: "discovery.extract-answer",
  version: "1.0",
  role: "You are the Answer Interpreter.",
  objective: "Extract supported project decisions.",
  boundaries: ["Do not invent unsupported decisions."],
  outputSchema: "answer-interpretation/v1",
  qualityCriteria: ["Every decision cites supporting text."],
};

function prompts(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register(PROMPT);
  return registry;
}

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("orchestrator cache (integration, fakes only)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "C", idea: "cached" });
    return { owner, projectId: project.project.id };
  }

  function input(ownerId: string, projectId: string): OrchestrateInput {
    return {
      userId: ownerId,
      projectId,
      capability: "answer-extraction",
      operationType: "ANSWER_EXTRACTION",
      promptKey: "discovery.extract-answer",
      taskInput: "No login, single user.",
      schema: SCHEMA,
    };
  }

  it("serves equivalent requests without provider spend and records the hit", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cache-${Date.now()}@example.com`);
        const versionBefore = await getStateVersion(db, owner.id, projectId);
        const cache = new MemoryCache();
        const provider = new FakeProvider([{ kind: "structured", json: '{"ok":true}' }]);

        const first = await orchestrate(db, input(owner.id, projectId), {
          provider,
          prompts: prompts(),
          cache,
        });
        expect(first.data).toEqual({ ok: true });
        expect(provider.calls).toHaveLength(1);

        const second = await orchestrate(db, input(owner.id, projectId), {
          provider,
          prompts: prompts(),
          cache,
        });
        expect(second.data).toEqual({ ok: true });
        expect(second.operationId).not.toBe(first.operationId);
        // No second provider spend; the hit is ledger-recorded as such.
        expect(provider.calls).toHaveLength(1);
        const operation = await getOperation(db, owner.id, second.operationId);
        expect(operation.status).toBe("SUCCEEDED");
        expect(operation.provider).toBe("cache");
        // Cache observes: canonical version untouched either way.
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);
      });
    } finally {
      await pool.end();
    }
  });

  it("reuses equivalent results and never serves failures", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cache-inv-${Date.now()}@example.com`);
        const cache = new MemoryCache();
        const makeProvider = () => new FakeProvider([{ kind: "structured", json: '{"ok":true}' }]);
        const base = { prompts: prompts(), cache };

        await orchestrate(db, input(owner.id, projectId), { ...base, provider: makeProvider() });
        // Same fingerprint hits.
        const hitting = new FakeProvider([{ kind: "structured", json: '{"ok":false}' }]);
        const hit = await orchestrate(db, input(owner.id, projectId), {
          ...base,
          provider: hitting,
        });
        expect(hit.data).toEqual({ ok: true });
        expect(hitting.calls).toHaveLength(0);

        // Advancing canonical state invalidates: identical task input
        // misses after the version bump and spends the provider again.
        await updateProject(db, owner.id, projectId, { idea: "A personal planner with sync." });
        const advanced = new FakeProvider([{ kind: "structured", json: '{"ok":true}' }]);
        const miss = await orchestrate(db, input(owner.id, projectId), {
          ...base,
          provider: advanced,
        });
        expect(miss.data).toEqual({ ok: true });
        expect(advanced.calls).toHaveLength(1);

        // Failures never populate the cache: a failing provider followed by
        // a working one for the same input still reaches the provider.
        const other = await setup(db, `cache-fail-${Date.now()}@example.com`);
        const failing = new FakeProvider([
          { kind: "structured", json: '{"nope":1}' },
          { kind: "structured", json: '{"still":2}' },
        ]);
        await expect(
          orchestrate(db, input(other.owner.id, other.projectId), { ...base, provider: failing }),
        ).rejects.toThrow();
        const recovery = new FakeProvider([{ kind: "structured", json: '{"ok":true}' }]);
        const recovered = await orchestrate(db, input(other.owner.id, other.projectId), {
          ...base,
          provider: recovery,
        });
        expect(recovered.data).toEqual({ ok: true });
        expect(recovery.calls).toHaveLength(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("treats disabled caches as a full miss", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `cache-off-${Date.now()}@example.com`);
        const provider = new FakeProvider([
          { kind: "structured", json: '{"ok":true}' },
          { kind: "structured", json: '{"ok":true}' },
        ]);
        const base = { prompts: prompts(), cache: null };
        await orchestrate(db, input(owner.id, projectId), { ...base, provider });
        await orchestrate(db, input(owner.id, projectId), { ...base, provider });
        expect(provider.calls).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });
});
