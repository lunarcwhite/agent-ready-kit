// TASK-065 acceptance: design reflects confirmed requirements, core
// workflows and important screens carry stable SCREEN identifiers (TASK-059),
// loading/empty/error/responsive expectations explicit, no invented product
// behavior, source state version stored.
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
import type { DesignCompilation } from "../../ai/schemas/design-compilation";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createRequirement } from "../requirements/requirements";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { createScreen } from "../architecture/screens";
import { createVersion, getSection, listDocuments, listSections } from "./documents";
import { listSectionDependencies } from "./dependencies";
import { compileDesign, DesignCompilerError } from "./design-compiler";

const EMPTY: DesignCompilation = { sections: [], unknowns: [] };

function depsFor(proposal: unknown, fail = false) {
  const provider = fail
    ? new FakeProvider([{ kind: "fail", code: "PROVIDER_UNAVAILABLE" }])
    : new FakeProvider([{ kind: "structured", json: JSON.stringify(proposal) }]);
  return { provider, prompts: new PromptRegistry(), cache: null };
}

describe("design compiler input validation", () => {
  it("rejects blank owner/project without touching AI or DB", async () => {
    const db = {} as AppDatabase;
    await expect(compileDesign(db, "  ", "p-1")).rejects.toBeInstanceOf(DesignCompilerError);
    await expect(compileDesign(db, "u-1", "  ")).rejects.toBeInstanceOf(DesignCompilerError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("design compiler (integration, fakes only)", () => {
  it("compiles sections with preserved FR + SCREEN codes and explicit unknowns", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `design-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "D", idea: "design" });
        const pid = project.project.id;
        const requirement = await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "View task list",
          description: "The user can view their task list.",
          priority: "MUST",
          status: "CONFIRMED",
          acceptanceCriteria: ["List renders"],
        });
        const knowledge = await createKnowledgeItem(db, owner.id, pid, {
          knowledgeKey: "ux.preferences",
          domain: "User",
          title: "Preferences",
          content: { theme: "calm, desktop-first" },
          confidence: "EXPLICIT",
          sources: [{ type: "PROJECT_INPUT" }],
        });
        const screen = await createScreen(db, owner.id, pid, {
          name: "Task list",
          routeHint: "/tasks",
          status: "CONFIRMED",
        });
        const before = await getStateVersion(db, owner.id, pid);

        const proposal: DesignCompilation = {
          sections: [
            {
              key: "design.task_list",
              title: "Task list",
              body: "Task list screen with loading, empty, and error states. Responsive: stacked on narrow viewports. Implements FR-001 via SCREEN-001.",
              requirementCodes: [requirement.requirementCode],
              knowledgeKeys: [knowledge.knowledgeKey],
              screenCodes: [screen.screenCode],
            },
          ],
          unknowns: [{ topic: "Branding", detail: "Which accent color ships in v1?" }],
        };
        const compiled = await compileDesign(db, owner.id, pid, depsFor(proposal));
        expect(compiled.sections).toHaveLength(1);
        expect(compiled.sections[0]?.status).toBe("PROPOSED");
        expect(compiled.unknowns?.sectionKey).toBe("design.unknowns");
        // Canonical version untouched by derived compilation.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        // FR priorities + SCREEN codes preserved by construction from the tables.
        const stored = await getSection(db, owner.id, pid, "DESIGN", "design.task_list");
        const structured = stored.structuredContent as {
          requirements: { code: string; priority: string }[];
          screens: { code: string }[];
        };
        expect(structured.requirements).toEqual([
          { code: "FR-001", title: "View task list", priority: "MUST", status: "CONFIRMED" },
        ]);
        expect(structured.screens).toEqual([
          { code: "SCREEN-001", name: "Task list", status: "CONFIRMED" },
        ]);
        const deps = await listSectionDependencies(db, owner.id, pid, "DESIGN", "design.task_list");
        expect(deps.map((dep) => dep.sourceType).sort()).toEqual(["KNOWLEDGE", "REQUIREMENT"]);

        // Approval snapshots bind content to the source state version.
        const snap = await createVersion(db, owner.id, pid, "DESIGN");
        expect(snap.projectStateVersion).toBe(before);
        expect(snap.content).toContain("empty, and error states");
        expect(await listSections(db, owner.id, pid, "DESIGN")).toHaveLength(2);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects invented FR and SCREEN codes", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `designbad-${Date.now()}@example.com` })
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

        const invented: DesignCompilation = {
          sections: [
            {
              key: "design.overview",
              title: "Overview",
              body: "Implements FR-999 via SCREEN-999.",
              requirementCodes: ["FR-999"],
              screenCodes: ["SCREEN-999"],
            },
          ],
          unknowns: [],
        };
        await expect(compileDesign(db, owner.id, pid, depsFor(invented))).rejects.toBeInstanceOf(
          DesignCompilerError,
        );
        // Nothing persisted on rejection (no document container created).
        expect(await listDocuments(db, owner.id, pid)).toHaveLength(0);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects superseded SCREEN references", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `designsup-${Date.now()}@example.com` })
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
        const first = await createScreen(db, owner.id, pid, {
          name: "List v1",
          status: "CONFIRMED",
        });
        const { next } = await (
          await import("../architecture/screens")
        ).supersedeScreen(db, owner.id, pid, first.screenCode, {
          name: "List v2",
          status: "DRAFT",
        });

        // Old code is SUPERSEDED and must abort the batch.
        const staleRef: DesignCompilation = {
          sections: [
            {
              key: "design.overview",
              title: "Overview",
              body: `Implements ${requirement.requirementCode} via ${first.screenCode}.`,
              requirementCodes: [requirement.requirementCode],
              screenCodes: [first.screenCode],
            },
          ],
          unknowns: [],
        };
        await expect(compileDesign(db, owner.id, pid, depsFor(staleRef))).rejects.toBeInstanceOf(
          DesignCompilerError,
        );
        expect(await listDocuments(db, owner.id, pid)).toHaveLength(0);

        // Successor code resolves fine (proposal-only, no assertion on prose).
        const liveRef: DesignCompilation = {
          sections: [
            {
              key: "design.overview",
              title: "Overview",
              body: `Implements ${requirement.requirementCode} via ${next.screenCode}.`,
              requirementCodes: [requirement.requirementCode],
              screenCodes: [next.screenCode],
            },
          ],
          unknowns: [],
        };
        const compiled = await compileDesign(db, owner.id, pid, depsFor(liveRef));
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
          .values({ email: `designfail-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "F", idea: "fail" });
        const pid = project.project.id;
        const before = await getStateVersion(db, owner.id, pid);

        await expect(compileDesign(db, owner.id, pid, depsFor(EMPTY, true))).rejects.toBeInstanceOf(
          DesignCompilerError,
        );
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);
      });
    } finally {
      await pool.end();
    }
  });
});
