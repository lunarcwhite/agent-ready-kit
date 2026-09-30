// TASK-063 acceptance: architecture reflects confirmed requirements and
// constraints, unresolved decisions stay visible, no silent technology
// selection, stable ARC identifiers via TASK-059, source state version stored.
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
import type { ArchitectureCompilation } from "../../ai/schemas/architecture-compilation";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createRequirement } from "../requirements/requirements";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { createComponent } from "../architecture/components";
import { createVersion, getSection, listDocuments, listSections } from "./documents";
import { listSectionDependencies } from "./dependencies";
import { compileArchitecture, ArchCompilerError } from "./architecture-compiler";

const EMPTY: ArchitectureCompilation = { sections: [], unknowns: [] };

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("architecture compiler input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(compileArchitecture(db, "  ", "p-1")).rejects.toBeInstanceOf(ArchCompilerError);
    await expect(compileArchitecture(db, "u-1", "  ")).rejects.toBeInstanceOf(ArchCompilerError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("architecture compiler (integration, fakes only)", () => {
  it("compiles sections with preserved FR + ARC codes and explicit unknowns", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `arch-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "A", idea: "arch" });
        const pid = project.project.id;
        const requirement = await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Sign in",
          description: "The user can sign in.",
          priority: "MUST",
          status: "CONFIRMED",
          acceptanceCriteria: ["Login works"],
        });
        const knowledge = await createKnowledgeItem(db, owner.id, pid, {
          knowledgeKey: "technical.constraints",
          domain: "Technical",
          title: "Constraints",
          content: { stack: "managed auth" },
          confidence: "EXPLICIT",
          sources: [{ type: "PROJECT_INPUT" }],
        });
        const component = await createComponent(db, owner.id, pid, {
          name: "Web app",
          status: "CONFIRMED",
        });
        const before = await getStateVersion(db, owner.id, pid);

        const proposal: ArchitectureCompilation = {
          sections: [
            {
              key: "architecture.authentication",
              title: "Authentication",
              body: "Modular monolith. Implements FR-001 via ARC-001.",
              requirementCodes: [requirement.requirementCode],
              knowledgeKeys: [knowledge.knowledgeKey],
              componentCodes: [component.componentCode],
            },
          ],
          unknowns: [{ topic: "Deployment", detail: "Which host serves v1?" }],
        };
        const compiled = await compileArchitecture(db, owner.id, pid, depsFor(proposal));
        expect(compiled.sections).toHaveLength(1);
        expect(compiled.sections[0]?.status).toBe("PROPOSED");
        expect(compiled.unknowns?.sectionKey).toBe("architecture.unknowns");
        // Canonical version untouched by derived compilation.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        // FR priorities + ARC codes preserved by construction from the tables.
        const stored = await getSection(
          db,
          owner.id,
          pid,
          "ARCHITECTURE",
          "architecture.authentication",
        );
        const structured = stored.structuredContent as {
          requirements: { code: string; priority: string }[];
          components: { code: string }[];
        };
        expect(structured.requirements).toEqual([
          { code: "FR-001", title: "Sign in", priority: "MUST", status: "CONFIRMED" },
        ]);
        expect(structured.components).toEqual([
          { code: "ARC-001", name: "Web app", status: "CONFIRMED" },
        ]);
        const deps = await listSectionDependencies(
          db,
          owner.id,
          pid,
          "ARCHITECTURE",
          "architecture.authentication",
        );
        expect(deps.map((dep) => dep.sourceType).sort()).toEqual(["KNOWLEDGE", "REQUIREMENT"]);

        // Approval snapshots bind content to the source state version.
        const snap = await createVersion(db, owner.id, pid, "ARCHITECTURE");
        expect(snap.projectStateVersion).toBe(before);
        expect(snap.content).toContain("Modular monolith");
        expect(await listSections(db, owner.id, pid, "ARCHITECTURE")).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects invented FR and ARC codes", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `archbad-${Date.now()}@example.com` })
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

        const invented: ArchitectureCompilation = {
          sections: [
            {
              key: "architecture.overview",
              title: "Overview",
              body: "Implements FR-999 via ARC-999.",
              requirementCodes: ["FR-999"],
              componentCodes: ["ARC-999"],
            },
          ],
          unknowns: [],
        };
        await expect(
          compileArchitecture(db, owner.id, pid, depsFor(invented)),
        ).rejects.toBeInstanceOf(ArchCompilerError);
        // Nothing persisted on rejection (no document container created).
        expect(await listDocuments(db, owner.id, pid)).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects superseded ARC references", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `archsup-${Date.now()}@example.com` })
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
        const first = await createComponent(db, owner.id, pid, {
          name: "Web v1",
          status: "CONFIRMED",
        });
        const { next } = await (
          await import("../architecture/components")
        ).supersedeComponent(db, owner.id, pid, first.componentCode, {
          name: "Web v2",
          status: "DRAFT",
        });

        // Old code is SUPERSEDED and must abort the batch.
        const staleRef: ArchitectureCompilation = {
          sections: [
            {
              key: "architecture.overview",
              title: "Overview",
              body: `Implements ${requirement.requirementCode} via ${first.componentCode}.`,
              requirementCodes: [requirement.requirementCode],
              componentCodes: [first.componentCode],
            },
          ],
          unknowns: [],
        };
        await expect(
          compileArchitecture(db, owner.id, pid, depsFor(staleRef)),
        ).rejects.toBeInstanceOf(ArchCompilerError);
        expect(await listDocuments(db, owner.id, pid)).toHaveLength(0);

        // Successor code resolves fine (proposal-only, no assertion on prose).
        const liveRef: ArchitectureCompilation = {
          sections: [
            {
              key: "architecture.overview",
              title: "Overview",
              body: `Implements ${requirement.requirementCode} via ${next.componentCode}.`,
              requirementCodes: [requirement.requirementCode],
              componentCodes: [next.componentCode],
            },
          ],
          unknowns: [],
        };
        const compiled = await compileArchitecture(db, owner.id, pid, depsFor(liveRef));
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
          .values({ email: `archfail-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "F", idea: "fail" });
        const pid = project.project.id;
        const before = await getStateVersion(db, owner.id, pid);

        await expect(
          compileArchitecture(db, owner.id, pid, depsFor(EMPTY, true)),
        ).rejects.toBeInstanceOf(ArchCompilerError);
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });
});
