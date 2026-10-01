// TASK-044 acceptance: per-capability requirements, unrelated history
// excluded, provenance-marked decisions, project scoping, inspectability.
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
import { ProjectNotFoundError } from "../../modules/projects/errors";
import { createDecision } from "../../modules/decisions/decisions";
import { createRequirement } from "../../modules/requirements/requirements";
import { ensureDiscoveryMap } from "../../modules/discovery/discovery";
import {
  appendDiscoveryMessage,
  startDiscoverySession,
} from "../../modules/discovery/conversation";
import { DiscoveryValidationError } from "../../modules/discovery/errors";
import { buildContext } from "./builder";

describe("buildContext validation", () => {
  it("rejects blank owner and unknown capabilities without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(buildContext(db, "  ", "p-1", "idea-analysis")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(buildContext(db, "u-1", "p-1", "telepathy")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("context builder (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, {
      name: "Ctx",
      idea: "a calm planner",
      targetUsers: "solo founders",
    });
    return { owner, projectId: project.project.id };
  }

  it("builds idea-analysis context from project input only", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ctx-${Date.now()}@example.com`);
        const context = await buildContext(db, owner.id, projectId, "idea-analysis");
        expect(context.capability).toBe("idea-analysis");
        expect(context.sections.map((section) => section.name)).toEqual(["projectInput"]);
        const input = context.sections[0].data as { idea: string };
        expect(input.idea).toBe("a calm planner");
        expect(() => JSON.stringify(context)).not.toThrow();
      });
    } finally {
      await pool.end();
    }
  });

  it("marks confirmed decisions with provenance and excludes unrelated messages", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `ctx2-${Date.now()}@example.com`);
        await ensureDiscoveryMap(db, owner.id, projectId);
        await createDecision(db, owner.id, projectId, {
          decisionKey: "authentication.required",
          category: "auth",
          title: "Authentication required",
          status: "CONFIRMED",
          impact: "HIGH",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: false,
        });
        await createRequirement(db, owner.id, projectId, {
          type: "FUNCTIONAL",
          title: "Single-user mode",
          description: "The app runs without accounts.",
          priority: "MUST",
          status: "CONFIRMED",
        });
        const session = await startDiscoverySession(db, owner.id, projectId);
        await appendDiscoveryMessage(db, owner.id, projectId, session.id, {
          role: "USER",
          content: "No login please.",
          nodeKey: "access",
        });
        await appendDiscoveryMessage(db, owner.id, projectId, session.id, {
          role: "USER",
          content: "Blue theme.",
          nodeKey: "ux",
        });

        const context = await buildContext(db, owner.id, projectId, "answer-extraction", {
          nodeKey: "access",
          sessionId: session.id,
        });
        const messages = context.sections.find((section) => section.name === "recentMessages");
        expect(messages?.priority).toBe("essential");
        const contents = (messages?.data as { content: string }[]).map((row) => row.content);
        expect(contents).toEqual(["No login please."]);

        const knowledge = await buildContext(db, owner.id, projectId, "knowledge-curation");
        const confirmed = knowledge.sections.find(
          (section) => section.name === "confirmedDecisions",
        );
        expect(confirmed?.priority).toBe("essential");
        expect(confirmed?.data).toEqual([
          {
            decisionKey: "authentication.required",
            decisionCode: "DEC-AUTH-001",
            title: "Authentication required",
            value: false,
            status: "CONFIRMED",
            provenance: "USER_EXPLICIT",
          },
        ]);
        const requirements = knowledge.sections.find((section) => section.name === "requirements");
        expect((requirements?.data as unknown[]).length).toBe(1);
      });
    } finally {
      await pool.end();
    }
  });

  it("respects maxLayer budgets and project isolation", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `ctx-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `ctx-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        await ensureDiscoveryMap(db, a.id, project.project.id);

        const minimal = await buildContext(db, a.id, project.project.id, "knowledge-curation", {
          maxLayer: "essential",
        });
        expect(minimal.sections.map((section) => section.name)).toEqual(["confirmedDecisions"]);
        await expect(
          buildContext(db, b.id, project.project.id, "idea-analysis"),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
