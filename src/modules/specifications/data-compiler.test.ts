// TASK-064 acceptance: entities map to persistence structures, ENT codes
// stable via atomic counter, relationships explicit with cardinality,
// constraints/ownership/lifecycle represented, unknowns explicit.
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
import type { DataCompilation } from "../../ai/schemas/data-compilation";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createRequirement } from "../requirements/requirements";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { addRelationship, createEntity } from "../entities/entities";
import { createVersion, getSection, listDocuments, listSections } from "./documents";
import { listSectionDependencies } from "./dependencies";
import { compileData, DataCompilerError } from "./data-compiler";

const EMPTY: DataCompilation = { sections: [], unknowns: [] };

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("data compiler input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(compileData(db, "  ", "p-1")).rejects.toBeInstanceOf(DataCompilerError);
    await expect(compileData(db, "u-1", "  ")).rejects.toBeInstanceOf(DataCompilerError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("data compiler (integration, fakes only)", () => {
  it("compiles sections with preserved FR + ENT codes and explicit unknowns", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `data-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "D", idea: "data" });
        const pid = project.project.id;
        const requirement = await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Track tasks",
          description: "The user can track tasks.",
          priority: "MUST",
          status: "CONFIRMED",
          acceptanceCriteria: ["Tasks persist"],
        });
        const knowledge = await createKnowledgeItem(db, owner.id, pid, {
          knowledgeKey: "data.retention",
          domain: "Technical",
          title: "Retention",
          content: { retention: "tasks kept indefinitely" },
          confidence: "EXPLICIT",
          sources: [{ type: "PROJECT_INPUT" }],
        });
        const task = await createEntity(db, owner.id, pid, {
          name: "Task",
          status: "CONFIRMED",
          ownershipModel: { owner: "user" },
          lifecycle: { states: ["open", "done"] },
          attributes: [
            { name: "title", dataType: "text", required: true },
            { name: "slug", dataType: "text", uniqueValue: true },
          ],
        });
        const projectEntity = await createEntity(db, owner.id, pid, {
          name: "Project",
          status: "CONFIRMED",
          attributes: [{ name: "name", dataType: "text", required: true }],
        });
        await addRelationship(db, owner.id, pid, {
          sourceCode: projectEntity.entityCode,
          targetCode: task.entityCode,
          relationshipType: "ONE_TO_MANY",
        });
        const before = await getStateVersion(db, owner.id, pid);

        const proposal: DataCompilation = {
          sections: [
            {
              key: "data.tasks",
              title: "Tasks",
              body: "tasks table with title, slug unique index. Implements FR-001 via ENT-001.",
              requirementCodes: [requirement.requirementCode],
              knowledgeKeys: [knowledge.knowledgeKey],
              entityCodes: [task.entityCode, projectEntity.entityCode],
            },
          ],
          unknowns: [{ topic: "Retention", detail: "How long are done tasks kept?" }],
        };
        const compiled = await compileData(db, owner.id, pid, depsFor(proposal));
        expect(compiled.sections).toHaveLength(1);
        expect(compiled.sections[0]?.status).toBe("PROPOSED");
        expect(compiled.unknowns?.sectionKey).toBe("data.unknowns");
        // Canonical version untouched by derived compilation.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        // FR priorities + ENT codes preserved by construction from the tables.
        const stored = await getSection(db, owner.id, pid, "DATABASE_SCHEMA", "data.tasks");
        const structured = stored.structuredContent as {
          requirements: { code: string; priority: string }[];
          entities: { code: string; attributes: { name: string }[] }[];
        };
        expect(structured.requirements).toEqual([
          { code: "FR-001", title: "Track tasks", priority: "MUST", status: "CONFIRMED" },
        ]);
        expect(structured.entities.map((e) => e.code)).toEqual(["ENT-001", "ENT-002"]);
        expect(structured.entities[0]?.attributes.map((a) => a.name)).toEqual(["slug", "title"]);
        const deps = await listSectionDependencies(
          db,
          owner.id,
          pid,
          "DATABASE_SCHEMA",
          "data.tasks",
        );
        expect(deps.map((dep) => dep.sourceType).sort()).toEqual([
          "ENTITY",
          "ENTITY",
          "KNOWLEDGE",
          "REQUIREMENT",
        ]);

        // Approval snapshots bind content to the source state version.
        const snap = await createVersion(db, owner.id, pid, "DATABASE_SCHEMA");
        expect(snap.projectStateVersion).toBe(before);
        expect(snap.content).toContain("slug unique");
        expect(await listSections(db, owner.id, pid, "DATABASE_SCHEMA")).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects invented FR and ENT codes", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `databad-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "B", idea: "bad" });
        const pid = project.project.id;
        await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Real",
          description: "A real requirement.",
          priority: "MUST",
          status: "CONFIRMED",
        });

        const invented: DataCompilation = {
          sections: [
            {
              key: "data.overview",
              title: "Overview",
              body: "Implements FR-999 via ENT-999.",
              requirementCodes: ["FR-999"],
              entityCodes: ["ENT-999"],
            },
          ],
          unknowns: [],
        };
        await expect(compileData(db, owner.id, pid, depsFor(invented))).rejects.toBeInstanceOf(
          DataCompilerError,
        );
        // Nothing persisted on rejection (no document container created).
        expect(await listDocuments(db, owner.id, pid)).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects superseded ENT references", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `datasup-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "S", idea: "sup" });
        const pid = project.project.id;
        const requirement = await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Real",
          description: "A real requirement.",
          priority: "MUST",
          status: "CONFIRMED",
        });
        const first = await createEntity(db, owner.id, pid, {
          name: "Task v1",
          status: "CONFIRMED",
        });
        const { next } = await (
          await import("../entities/entities")
        ).supersedeEntity(db, owner.id, pid, first.entityCode, {
          name: "Task v2",
          status: "DRAFT",
        });

        // Old code is SUPERSEDED and must abort the batch.
        const staleRef: DataCompilation = {
          sections: [
            {
              key: "data.overview",
              title: "Overview",
              body: `Implements ${requirement.requirementCode} via ${first.entityCode}.`,
              requirementCodes: [requirement.requirementCode],
              entityCodes: [first.entityCode],
            },
          ],
          unknowns: [],
        };
        await expect(compileData(db, owner.id, pid, depsFor(staleRef))).rejects.toBeInstanceOf(
          DataCompilerError,
        );
        expect(await listDocuments(db, owner.id, pid)).toHaveLength(0);

        // Successor code resolves fine (proposal-only, no assertion on prose).
        const liveRef: DataCompilation = {
          sections: [
            {
              key: "data.overview",
              title: "Overview",
              body: `Implements ${requirement.requirementCode} via ${next.entityCode}.`,
              requirementCodes: [requirement.requirementCode],
              entityCodes: [next.entityCode],
            },
          ],
          unknowns: [],
        };
        const compiled = await compileData(db, owner.id, pid, depsFor(liveRef));
        expect(compiled.sections).toHaveLength(1);
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
          .values({ email: `datafail-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "F", idea: "fail" });
        const pid = project.project.id;
        const before = await getStateVersion(db, owner.id, pid);

        await expect(compileData(db, owner.id, pid, depsFor(EMPTY, true))).rejects.toBeInstanceOf(
          DataCompilerError,
        );
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });
});
