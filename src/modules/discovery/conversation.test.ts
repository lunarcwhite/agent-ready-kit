// TASK-033 acceptance: question/answer stored, topic/AI-op/interpretation
// linkable, project-scoped history. No version bumps anywhere (evidence).
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { ProjectNotFoundError } from "../projects/errors";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { DiscoveryNotFoundError, DiscoveryValidationError } from "./errors";
import { ensureDiscoveryMap } from "./discovery";
import {
  appendDiscoveryMessage,
  endDiscoverySession,
  listDiscoveryMessages,
  listDiscoverySessions,
  startDiscoverySession,
} from "./conversation";

describe("conversation input validation", () => {
  it("rejects blank owner and malformed payloads without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(startDiscoverySession(db, "  ", "p-1")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(listDiscoverySessions(db, "", "p-1")).rejects.toBeInstanceOf(
      DiscoveryValidationError,
    );
    await expect(
      appendDiscoveryMessage(db, "u-1", "p-1", "s-1", { role: "BOT" as never, content: "hi" }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(
      appendDiscoveryMessage(db, "u-1", "p-1", "s-1", { role: "USER", content: "   " }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(
      appendDiscoveryMessage(db, "u-1", "p-1", "s-1", {
        role: "USER",
        content: "hi",
        nodeKey: "Has Spaces",
      }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(
      appendDiscoveryMessage(db, "u-1", "p-1", "s-1", {
        role: "USER",
        content: "hi",
        aiOperationId: "not-a-uuid",
      }),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
    await expect(
      endDiscoverySession(db, "u-1", "p-1", "s-1", "DONE" as never),
    ).rejects.toBeInstanceOf(DiscoveryValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("discovery conversation (integration)", () => {
  async function setupProject(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const project = await createProject(db, owner.id, { name: "C", idea: "chat" });
    return { owner, projectId: project.project.id };
  }

  it("persists a Q&A run with topic and refs, ordered, without version bumps", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setupProject(db, `conv-${Date.now()}@example.com`);
        await ensureDiscoveryMap(db, owner.id, projectId);
        const versionBefore = await getStateVersion(db, owner.id, projectId);

        const session = await startDiscoverySession(db, owner.id, projectId);
        expect(session.status).toBe("ACTIVE");

        const question = await appendDiscoveryMessage(db, owner.id, projectId, session.id, {
          role: "ASSISTANT",
          content: "Do users need accounts?",
          nodeKey: "access",
          aiOperationId: "11111111-1111-4111-8111-111111111111",
        });
        expect(question.sequenceNumber).toBe(1);
        expect(question.metadata?.nodeKey).toBe("access");

        const answer = await appendDiscoveryMessage(db, owner.id, projectId, session.id, {
          role: "USER",
          content: "No login, single user.",
          nodeKey: "access",
          interpretation: { decisions: [{ key: "authentication.required", value: false }] },
        });
        expect(answer.sequenceNumber).toBe(2);
        expect(answer.metadata?.interpretation).toEqual({
          decisions: [{ key: "authentication.required", value: false }],
        });

        // History survives sessions: ordered re-read returns the same run.
        const reread = await listDiscoveryMessages(db, owner.id, projectId, session.id);
        expect(reread.map((row) => row.sequenceNumber)).toEqual([1, 2]);
        expect(reread[0].role).toBe("ASSISTANT");

        // Evidence writes never bump canonical state.
        expect(await getStateVersion(db, owner.id, projectId)).toBe(versionBefore);

        const ended = await endDiscoverySession(db, owner.id, projectId, session.id, "COMPLETED");
        expect(ended.status).toBe("COMPLETED");
        await expect(
          appendDiscoveryMessage(db, owner.id, projectId, session.id, {
            role: "USER",
            content: "too late",
          }),
        ).rejects.toBeInstanceOf(DiscoveryValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects unknown topics and isolates sessions between users", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `cv-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `cv-b-${stamp}@example.com` })
          .returning();
        const project = await createProject(db, a.id, { name: "P", idea: "mine" });
        await ensureDiscoveryMap(db, a.id, project.project.id);
        const session = await startDiscoverySession(db, a.id, project.project.id);

        await expect(
          appendDiscoveryMessage(db, a.id, project.project.id, session.id, {
            role: "USER",
            content: "hi",
            nodeKey: "ghost",
          }),
        ).rejects.toBeInstanceOf(DiscoveryNotFoundError);

        // Cross-user access fails at the scope gate in every direction.
        await expect(listDiscoverySessions(db, b.id, project.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
        await expect(
          listDiscoveryMessages(db, b.id, project.project.id, session.id),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        await expect(
          endDiscoverySession(db, b.id, project.project.id, session.id, "ABANDONED"),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
