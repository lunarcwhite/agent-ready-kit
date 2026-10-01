// TASK-061 acceptance: sections reference decisions/requirements/
// knowledge; changed dependencies mark affected sections stale;
// unaffected sections remain current; propagation is deterministic.
//
// Unit tests pin validation + hash determinism without a database.
// Row-level proofs run as rolled-back integration tests — skipped, not
// failed, without TEST_DATABASE_URL/DATABASE_URL.
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "../../infrastructure/database/db";
import * as schema from "../../infrastructure/database/schema";
import {
  getIntegrationDatabaseUrl,
  withRolledBackTransaction,
} from "../../infrastructure/database/test-utils";
import { createProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { createDecision } from "../decisions/decisions";
import { createRequirement } from "../requirements/requirements";
import { createKnowledgeItem } from "../knowledge/knowledge";
import { SpecificationNotFoundError, SpecificationValidationError } from "./errors";
import { getSection, upsertSection } from "./documents";
import {
  computeDependencyHash,
  listSectionDependencies,
  listSectionSources,
  listSectionsDependingOn,
  markStaleDependents,
  setSectionDependencies,
} from "./dependencies";

describe("dependency tracking validation", () => {
  it("computes stable hashes independent of input order", () => {
    const a = computeDependencyHash([
      { sourceType: "DECISION", sourceId: "00000000-0000-0000-0000-000000000001" },
      { sourceType: "REQUIREMENT", sourceId: "00000000-0000-0000-0000-000000000002" },
    ]);
    const b = computeDependencyHash([
      { sourceType: "REQUIREMENT", sourceId: "00000000-0000-0000-0000-000000000002" },
      { sourceType: "DECISION", sourceId: "00000000-0000-0000-0000-000000000001" },
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(
      computeDependencyHash([
        { sourceType: "DECISION", sourceId: "00000000-0000-0000-0000-000000000003" },
      ]),
    ).not.toBe(a);
  });

  it("rejects malformed refs without touching the database", async () => {
    const db = {} as AppDatabase;
    await expect(setSectionDependencies(db, "  ", "p-1", "PRD", "a", [])).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
    await expect(
      setSectionDependencies(db, "u-1", "p-1", "PRD", "a", [
        { sourceType: "RUMOR" as never, sourceId: "x" },
      ]),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(
      setSectionDependencies(db, "u-1", "p-1", "PRD", "a", [
        { sourceType: "DECISION", sourceId: "not-a-uuid" },
      ]),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(
      listSectionsDependingOn(db, "", "p-1", "DECISION", "00000000-0000-0000-0000-000000000001"),
    ).rejects.toBeInstanceOf(SpecificationValidationError);
    await expect(markStaleDependents(db, "u-1", "p-1", "DECISION", "nope")).rejects.toBeInstanceOf(
      SpecificationValidationError,
    );
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("specification dependencies (integration)", () => {
  it("links sections to canonical objects and hashes the set", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `sdep-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "D", idea: "deps" });
        const pid = project.project.id;
        const decision = await createDecision(db, owner.id, pid, {
          decisionKey: "authentication.required",
          category: "AUTH",
          title: "Require auth",
          status: "CONFIRMED",
          impact: "HIGH",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: true,
        });
        await upsertSection(db, owner.id, pid, "ARCHITECTURE", {
          sectionKey: "architecture.authentication",
          title: "Authentication",
          renderedContent: "Google only.",
        });
        const before = await getStateVersion(db, owner.id, pid);

        const section = await setSectionDependencies(
          db,
          owner.id,
          pid,
          "ARCHITECTURE",
          "architecture.authentication",
          [{ sourceType: "DECISION", sourceId: decision.id }],
        );
        expect(section.dependencyHash).toMatch(/^[0-9a-f]{16}$/);
        expect(
          await listSectionDependencies(
            db,
            owner.id,
            pid,
            "ARCHITECTURE",
            "architecture.authentication",
          ),
        ).toHaveLength(1);
        // Derived writes never bump the canonical version.
        expect(await getStateVersion(db, owner.id, pid)).toBe(before);

        // Replace-all: removed links vanish, hash follows.
        const relinked = await setSectionDependencies(
          db,
          owner.id,
          pid,
          "ARCHITECTURE",
          "architecture.authentication",
          [],
        );
        expect(relinked.dependencyHash).toBeNull();
        expect(
          await listSectionDependencies(
            db,
            owner.id,
            pid,
            "ARCHITECTURE",
            "architecture.authentication",
          ),
        ).toHaveLength(0);

        // Cross-project decision ids are rejected, never revealed.
        await expect(
          setSectionDependencies(db, owner.id, pid, "ARCHITECTURE", "architecture.authentication", [
            { sourceType: "DECISION", sourceId: "00000000-0000-0000-0000-000000000099" },
          ]),
        ).rejects.toBeInstanceOf(SpecificationValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("marks exactly the affected sections stale", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `staledep-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "S", idea: "stale deps" });
        const pid = project.project.id;
        const requirement = await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Login",
          description: "Users can log in.",
          priority: "MUST",
          status: "CONFIRMED",
        });
        const knowledge = await createKnowledgeItem(db, owner.id, pid, {
          knowledgeKey: "users.primary",
          domain: "Users",
          title: "Solo",
          content: { users: 1 },
          confidence: "EXPLICIT",
          sources: [{ type: "PROJECT_INPUT" }],
        });
        await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "product.scope",
          title: "Scope",
          renderedContent: "Scope text.",
        });
        await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "product.users",
          title: "Users",
          renderedContent: "Users text.",
        });
        await setSectionDependencies(db, owner.id, pid, "PRD", "product.scope", [
          { sourceType: "REQUIREMENT", sourceId: requirement.id },
        ]);
        await setSectionDependencies(db, owner.id, pid, "PRD", "product.users", [
          { sourceType: "KNOWLEDGE", sourceId: knowledge.id },
        ]);

        const affected = await markStaleDependents(
          db,
          owner.id,
          pid,
          "REQUIREMENT",
          requirement.id,
        );
        expect(affected).toEqual([{ documentType: "PRD", sectionKey: "product.scope" }]);
        expect((await getSection(db, owner.id, pid, "PRD", "product.scope")).status).toBe("STALE");
        // Unaffected sections remain current.
        expect((await getSection(db, owner.id, pid, "PRD", "product.users")).status).toBe(
          "CURRENT",
        );

        // Reverse lookup is project-scoped and repeatable.
        expect(await listSectionsDependingOn(db, owner.id, pid, "KNOWLEDGE", knowledge.id)).toEqual(
          [{ documentType: "PRD", sectionKey: "product.users" }],
        );
        expect(
          await markStaleDependents(
            db,
            owner.id,
            pid,
            "DECISION",
            "00000000-0000-0000-0000-000000000099",
          ),
        ).toEqual([]);
      });
    } finally {
      await pool.end();
    }
  });

  it("resolves section sources to human labels", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const [owner] = await db
          .insert(schema.users)
          .values({ email: `sourcelabel-${Date.now()}@example.com` })
          .returning();
        const project = await createProject(db, owner.id, { name: "S", idea: "source labels" });
        const pid = project.project.id;
        const requirement = await createRequirement(db, owner.id, pid, {
          type: "FUNCTIONAL",
          title: "Login",
          description: "Users can log in.",
          priority: "MUST",
          status: "CONFIRMED",
        });
        const knowledge = await createKnowledgeItem(db, owner.id, pid, {
          knowledgeKey: "users.primary",
          domain: "Users",
          title: "Solo",
          content: { users: 1 },
          confidence: "EXPLICIT",
          sources: [{ type: "PROJECT_INPUT" }],
        });
        await upsertSection(db, owner.id, pid, "PRD", {
          sectionKey: "product.scope",
          title: "Scope",
          renderedContent: "Scope text.",
        });
        await setSectionDependencies(db, owner.id, pid, "PRD", "product.scope", [
          { sourceType: "REQUIREMENT", sourceId: requirement.id },
          { sourceType: "KNOWLEDGE", sourceId: knowledge.id },
        ]);

        const sources = await listSectionSources(db, owner.id, pid, "PRD", "product.scope");
        expect(sources.map((source) => source.label).sort()).toEqual([
          requirement.requirementCode,
          "users.primary",
        ]);
        expect(sources.map((source) => source.sourceType).sort()).toEqual([
          "KNOWLEDGE",
          "REQUIREMENT",
        ]);

        await expect(
          listSectionSources(db, owner.id, pid, "PRD", "product.missing"),
        ).rejects.toBeInstanceOf(SpecificationNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
