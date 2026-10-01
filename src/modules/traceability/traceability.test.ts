// TASK-024 acceptance: source+target storage, cross-project rejection,
// duplicate prevention, bidirectional queries, removed/superseded safety.
//
// Unit tests pin validation without a database. Graph proofs run as
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
import { createDecision } from "../decisions/decisions";
import { createProject } from "../projects/repository";
import { ProjectNotFoundError } from "../projects/errors";
import { createComponent, updateComponent } from "../architecture/components";
import { createScreen } from "../architecture/screens";
import { createEntity } from "../entities/entities";
import {
  createRequirement,
  supersedeRequirement,
  updateRequirement,
} from "../requirements/requirements";
import { TraceabilityNotFoundError, TraceabilityValidationError } from "./errors";
import {
  createLink,
  listIncomingLinks,
  listOutgoingLinks,
  listProjectLinks,
  removeLink,
} from "./traceability";

const DECISION = {
  decisionKey: "authentication.required",
  category: "auth",
  title: "Authentication required",
  status: "CONFIRMED" as const,
  impact: "HIGH" as const,
  sourceType: "USER" as const,
  confidence: "EXPLICIT" as const,
  value: true,
};

const REQUIREMENT = {
  type: "FUNCTIONAL" as const,
  title: "Sign in",
  description: "Users can sign in.",
  priority: "MUST" as const,
  status: "CONFIRMED" as const,
};

describe("link input validation", () => {
  const link = {
    source: { type: "DECISION", id: "11111111-1111-1111-1111-111111111111" },
    target: { type: "REQUIREMENT", id: "22222222-2222-2222-2222-222222222222" },
    relationship: "implemented_by",
  };
  it("rejects malformed links without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(createLink(db, "  ", "p-1", link)).rejects.toBeInstanceOf(
      TraceabilityValidationError,
    );
    await expect(
      createLink(db, "u-1", "p-1", {
        ...link,
        source: { type: "ENTITY", id: link.source.id },
      }),
    ).rejects.toBeInstanceOf(TraceabilityValidationError);
    await expect(
      createLink(db, "u-1", "p-1", {
        ...link,
        target: { type: "REQUIREMENT", id: "not-a-uuid" },
      }),
    ).rejects.toBeInstanceOf(TraceabilityValidationError);
    await expect(
      createLink(db, "u-1", "p-1", { ...link, relationship: "Implements By" }),
    ).rejects.toBeInstanceOf(TraceabilityValidationError);
    await expect(
      createLink(db, "u-1", "p-1", { ...link, relationship: "x" }),
    ).rejects.toBeInstanceOf(TraceabilityValidationError);
    await expect(removeLink(db, "", "p-1", link.source.id)).rejects.toBeInstanceOf(
      TraceabilityValidationError,
    );
    await expect(listOutgoingLinks(db, "", "p-1", link.source)).rejects.toBeInstanceOf(
      TraceabilityValidationError,
    );
    await expect(
      listIncomingLinks(db, "u-1", "p-1", { type: "NOPE", id: link.source.id }),
    ).rejects.toBeInstanceOf(TraceabilityValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("traceability graph (integration)", () => {
  it("links DECISION to REQUIREMENT and queries both directions", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `tr-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "T", idea: "trace" });
        const pid = project.project.id;
        const decision = await createDecision(db, owner.id, pid, DECISION);
        const requirement = await createRequirement(db, owner.id, pid, REQUIREMENT);

        const link = await createLink(db, owner.id, pid, {
          source: { type: "DECISION", id: decision.id },
          target: { type: "REQUIREMENT", id: requirement.id },
          relationship: "implemented_by",
        });
        expect(link.relationship).toBe("implemented_by");

        // Exact duplicate is rejected, reverse direction is a distinct link.
        await expect(
          createLink(db, owner.id, pid, {
            source: { type: "DECISION", id: decision.id },
            target: { type: "REQUIREMENT", id: requirement.id },
            relationship: "implemented_by",
          }),
        ).rejects.toBeInstanceOf(TraceabilityValidationError);
        const reverse = await createLink(db, owner.id, pid, {
          source: { type: "REQUIREMENT", id: requirement.id },
          target: { type: "DECISION", id: decision.id },
          relationship: "references",
        });

        const outgoing = await listOutgoingLinks(db, owner.id, pid, {
          type: "DECISION",
          id: decision.id,
        });
        expect(outgoing.map((row) => row.id)).toEqual([link.id]);
        const incoming = await listIncomingLinks(db, owner.id, pid, {
          type: "REQUIREMENT",
          id: requirement.id,
        });
        expect(incoming.map((row) => row.id)).toEqual([link.id]);
        const reverseIncoming = await listIncomingLinks(db, owner.id, pid, {
          type: "DECISION",
          id: decision.id,
        });
        expect(reverseIncoming.map((row) => row.id)).toEqual([reverse.id]);
        expect(await listProjectLinks(db, owner.id, pid)).toHaveLength(2);

        await removeLink(db, owner.id, pid, reverse.id);
        expect(await listProjectLinks(db, owner.id, pid)).toHaveLength(1);
        await expect(removeLink(db, owner.id, pid, reverse.id)).rejects.toBeInstanceOf(
          TraceabilityNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("rejects cross-project links and dangling nodes", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const stamp = Date.now();
        const [a] = await db
          .insert(schema.users)
          .values({ email: `tr-a-${stamp}@example.com` })
          .returning();
        const [b] = await db
          .insert(schema.users)
          .values({ email: `tr-b-${stamp}@example.com` })
          .returning();
        const pa = await createProject(db, a.id, { name: "A", idea: "a" });
        const pb = await createProject(db, b.id, { name: "B", idea: "b" });
        const decA = await createDecision(db, a.id, pa.project.id, DECISION);
        const reqB = await createRequirement(db, b.id, pb.project.id, REQUIREMENT);

        // Foreign scope fails closed at the gate.
        await expect(
          createLink(db, b.id, pa.project.id, {
            source: { type: "DECISION", id: decA.id },
            target: { type: "REQUIREMENT", id: reqB.id },
            relationship: "uses",
          }),
        ).rejects.toBeInstanceOf(ProjectNotFoundError);
        // Foreign node ID inside own scope: unresolvable, never linked.
        await expect(
          createLink(db, a.id, pa.project.id, {
            source: { type: "DECISION", id: decA.id },
            target: { type: "REQUIREMENT", id: reqB.id },
            relationship: "uses",
          }),
        ).rejects.toBeInstanceOf(TraceabilityNotFoundError);
        await expect(listProjectLinks(db, b.id, pa.project.id)).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        );
      });
    } finally {
      await pool.end();
    }
  });

  it("handles withdrawn and superseded requirements safely", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `trw-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "W", idea: "w" });
        const pid = project.project.id;
        const decision = await createDecision(db, owner.id, pid, DECISION);
        const live = await createRequirement(db, owner.id, pid, REQUIREMENT);
        const gone = await createRequirement(db, owner.id, pid, { ...REQUIREMENT, title: "Gone" });
        await updateRequirement(db, owner.id, pid, gone.requirementCode, { status: "REMOVED" });

        // Withdrawn rows cannot gain new links.
        await expect(
          createLink(db, owner.id, pid, {
            source: { type: "DECISION", id: decision.id },
            target: { type: "REQUIREMENT", id: gone.id },
            relationship: "uses",
          }),
        ).rejects.toBeInstanceOf(TraceabilityValidationError);

        // Superseded rows stay traceable — frozen history keeps its links.
        const { old, next } = await supersedeRequirement(db, owner.id, pid, live.requirementCode, {
          ...REQUIREMENT,
          title: "Sign in v2",
          status: "DRAFT",
        });
        const toOld = await createLink(db, owner.id, pid, {
          source: { type: "DECISION", id: decision.id },
          target: { type: "REQUIREMENT", id: old.id },
          relationship: "implemented_by",
        });
        const toNext = await createLink(db, owner.id, pid, {
          source: { type: "DECISION", id: decision.id },
          target: { type: "REQUIREMENT", id: next.id },
          relationship: "implemented_by",
        });
        const incoming = await listIncomingLinks(db, owner.id, pid, {
          type: "REQUIREMENT",
          id: old.id,
        });
        expect(incoming.map((row) => row.id)).toEqual([toOld.id]);
        expect(
          (await listIncomingLinks(db, owner.id, pid, { type: "REQUIREMENT", id: next.id })).map(
            (row) => row.id,
          ),
        ).toEqual([toNext.id]);
      });
    } finally {
      await pool.end();
    }
  });
});

describeDb("downstream requirement links (integration, TASK-076)", () => {
  it("links REQUIREMENT to ARC, SCREEN, and ENT with scope checks", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `tr-down-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "D", idea: "downstream" });
        const pid = project.project.id;
        const requirement = await createRequirement(db, owner.id, pid, REQUIREMENT);
        const component = await createComponent(db, owner.id, pid, {
          name: "AuthService",
          status: "DRAFT",
        });
        const screen = await createScreen(db, owner.id, pid, {
          name: "Login",
          status: "CONFIRMED",
        });
        const entity = await createEntity(db, owner.id, pid, {
          name: "User",
          status: "CONFIRMED",
        });

        for (const [type, id] of [
          ["ARC", component.id],
          ["SCREEN", screen.id],
          ["ENT", entity.id],
        ] as const) {
          const link = await createLink(db, owner.id, pid, {
            source: { type: "REQUIREMENT", id: requirement.id },
            target: { type, id },
            relationship: "implemented_by",
          });
          expect(link.target.type).toBe(type);
        }
        const outgoing = await listOutgoingLinks(db, owner.id, pid, {
          type: "REQUIREMENT",
          id: requirement.id,
        });
        expect(outgoing).toHaveLength(3);
        const incoming = await listIncomingLinks(db, owner.id, pid, {
          type: "ARC",
          id: component.id,
        });
        expect(incoming).toHaveLength(1);

        // Missing-or-foreign targets surface identically as NotFound.
        await expect(
          createLink(db, owner.id, pid, {
            source: { type: "REQUIREMENT", id: requirement.id },
            target: { type: "ARC", id: "33333333-3333-4333-8333-333333333333" },
            relationship: "implemented_by",
          }),
        ).rejects.toBeInstanceOf(TraceabilityNotFoundError);

        // Withdrawn targets cannot be linked.
        const withdrawn = await createComponent(db, owner.id, pid, {
          name: "Legacy",
          status: "DRAFT",
        });
        await updateComponent(db, owner.id, pid, withdrawn.componentCode, {
          status: "REMOVED",
        });
        await expect(
          createLink(db, owner.id, pid, {
            source: { type: "REQUIREMENT", id: requirement.id },
            target: { type: "ARC", id: withdrawn.id },
            relationship: "implemented_by",
          }),
        ).rejects.toBeInstanceOf(TraceabilityValidationError);
      });
    } finally {
      await pool.end();
    }
  });
});
