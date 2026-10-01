// TASK-074 acceptance: stable ASM identity, impact/source storage,
// artifact links, Confirm/Replace/Defer/Reject lifecycle, canonical-state
// updates. Pure unit tests run everywhere; persistence tests skip without
// a database (same convention as the sibling modules).
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
import { createDecision } from "../decisions/decisions";
import {
  addAssumptionImpacts,
  assumptionDedupeKey,
  createAssumption,
  getAssumptionByCode,
  listAssumptions,
  reopenAssumption,
  replaceAssumption,
  resolveAssumption,
  updateAssumption,
  type CreateAssumptionInput,
} from "./assumptions";
import { AssumptionNotFoundError, AssumptionValidationError } from "./errors";

const BASE: CreateAssumptionInput = {
  title: "Browser storage quota suffices",
  description: "Assumes local browser storage fits the expected data volume.",
  impact: "MEDIUM",
  confidence: "MEDIUM",
  source: "AI_ASSUMED",
};

describe("assumptionDedupeKey (unit, no database)", () => {
  it("is stable, normalized, and bounded", () => {
    expect(assumptionDedupeKey("Browser storage quota suffices!")).toBe(
      "browser-storage-quota-suffices",
    );
    expect(assumptionDedupeKey("  Browser   STORAGE quota suffices? ")).toBe(
      "browser-storage-quota-suffices",
    );
    expect(assumptionDedupeKey("x".repeat(500)).length).toBeLessThanOrEqual(120);
    expect(assumptionDedupeKey("!!!")).toBe("assumption");
  });
});

describe("assumption input validation (unit, no database)", () => {
  it("rejects unknown enums without touching storage", async () => {
    const fake = {} as AppDatabase;
    await expect(
      createAssumption(fake, "u", "p", { ...BASE, impact: "BLOCKER" as never }),
    ).rejects.toBeInstanceOf(AssumptionValidationError);
    await expect(
      createAssumption(fake, "u", "p", { ...BASE, source: "USER_EXPLICIT" as never }),
    ).rejects.toBeInstanceOf(AssumptionValidationError);
    await expect(createAssumption(fake, "  ", "p", BASE)).rejects.toBeInstanceOf(
      AssumptionValidationError,
    );
    await expect(
      createAssumption(fake, "u", "p", {
        ...BASE,
        impacts: [{ targetType: "SECTION" as never, targetId: "x" }],
      }),
    ).rejects.toBeInstanceOf(AssumptionValidationError);
  });
});

const url = getIntegrationDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb("assumptions (integration)", () => {
  async function setup(db: AppDatabase, email: string) {
    const [owner] = await db.insert(schema.users).values({ email }).returning();
    const created = await createProject(db, owner.id, { name: "A", idea: "A planner." });
    return { owner, projectId: created.project.id };
  }

  it("creates ASM-coded assumptions and filters them", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `asm-${Date.now()}@example.com`);

        const first = await createAssumption(db, owner.id, projectId, BASE);
        expect(first.assumptionCode).toBe("ASM-001");
        expect(first.status).toBe("OPEN");
        expect(first.source).toBe("AI_ASSUMED");
        expect(first.resolvedAt).toBeNull();

        const second = await createAssumption(db, owner.id, projectId, {
          ...BASE,
          title: "Second",
          impact: "HIGH",
          source: "USER_IMPLIED",
        });
        expect(second.assumptionCode).toBe("ASM-002");

        expect(await getAssumptionByCode(db, owner.id, projectId, "ASM-001")).toMatchObject({
          title: BASE.title,
        });
        expect(
          (await listAssumptions(db, owner.id, projectId, { impact: "HIGH" })).map(
            (row) => row.assumptionCode,
          ),
        ).toEqual(["ASM-002"]);
        expect(
          (await listAssumptions(db, owner.id, projectId, { source: "USER_IMPLIED" })).map(
            (row) => row.assumptionCode,
          ),
        ).toEqual(["ASM-002"]);
      });
    } finally {
      await pool.end();
    }
  });

  it("links affected artifacts same-project and rejects foreign rows", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `asm-link-${Date.now()}@example.com`);
        const decision = await createDecision(db, owner.id, projectId, {
          decisionKey: "storage.type",
          category: "DATA",
          title: "Storage type",
          status: "CONFIRMED",
          impact: "HIGH",
          sourceType: "USER",
          confidence: "EXPLICIT",
          value: "local_browser",
        });

        const created = await createAssumption(db, owner.id, projectId, {
          ...BASE,
          impacts: [{ targetType: "DECISION", targetId: decision.id }],
        });
        expect(created.impacts).toHaveLength(1);

        // Idempotent append: same link twice adds one row.
        const again = await addAssumptionImpacts(db, owner.id, projectId, "ASM-001", [
          { targetType: "DECISION", targetId: decision.id },
          { targetType: "TASK", targetId: "11111111-1111-4111-8111-111111111111" },
        ]);
        expect(again.impacts).toHaveLength(2);

        // Missing-or-foreign rows surface identically as validation errors.
        await expect(
          createAssumption(db, owner.id, projectId, {
            ...BASE,
            title: "Bad link",
            impacts: [
              { targetType: "REQUIREMENT", targetId: "22222222-2222-4222-8222-222222222222" },
            ],
          }),
        ).rejects.toBeInstanceOf(AssumptionValidationError);
      });
    } finally {
      await pool.end();
    }
  });

  it("runs Confirm/Reject/Defer/Reopen with frozen terminal rows", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `asm-life-${Date.now()}@example.com`);
        await createAssumption(db, owner.id, projectId, BASE);

        const deferred = await resolveAssumption(
          db,
          owner.id,
          projectId,
          "ASM-001",
          "DEFERRED",
          "Decide after prototype.",
        );
        expect(deferred.status).toBe("DEFERRED");
        expect(deferred.resolution).toBe("Decide after prototype.");
        expect(deferred.resolvedAt).not.toBeNull();

        // DEFERRED rows stay editable like IGNORED issues; terminal rows freeze.
        const parked = await updateAssumption(db, owner.id, projectId, "ASM-001", {
          confidence: "HIGH",
        });
        expect(parked.confidence).toBe("HIGH");

        const reopened = await reopenAssumption(db, owner.id, projectId, "ASM-001");
        expect(reopened.status).toBe("OPEN");
        expect(reopened.resolution).toBeNull();

        const confirmed = await resolveAssumption(
          db,
          owner.id,
          projectId,
          "ASM-001",
          "CONFIRMED",
          "Verified against usage data.",
        );
        expect(confirmed.status).toBe("CONFIRMED");

        // Terminal rows are frozen until reopened.
        await expect(
          updateAssumption(db, owner.id, projectId, "ASM-001", { title: "Changed" }),
        ).rejects.toBeInstanceOf(AssumptionValidationError);

        // Terminal rows reject direct re-resolution; reopen first.
        await expect(
          resolveAssumption(db, owner.id, projectId, "ASM-001", "REJECTED", "Changed mind."),
        ).rejects.toBeInstanceOf(AssumptionValidationError);
        await reopenAssumption(db, owner.id, projectId, "ASM-001");
        const rejected = await resolveAssumption(
          db,
          owner.id,
          projectId,
          "ASM-001",
          "REJECTED",
          "Superseded by measurements.",
        );
        expect(rejected.status).toBe("REJECTED");
      });
    } finally {
      await pool.end();
    }
  });

  it("replaces atomically with a successor chain", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      await withRolledBackTransaction(pool, async () => {
        const db = drizzle(pool, { schema });
        const { owner, projectId } = await setup(db, `asm-rep-${Date.now()}@example.com`);
        await createAssumption(db, owner.id, projectId, BASE);

        const { replaced, successor } = await replaceAssumption(
          db,
          owner.id,
          projectId,
          "ASM-001",
          { ...BASE, title: "IndexedDB quota suffices", confidence: "HIGH" },
          "Narrowed to IndexedDB after spike.",
        );
        expect(replaced.status).toBe("REPLACED");
        expect(successor.assumptionCode).toBe("ASM-002");
        expect(successor.status).toBe("OPEN");
        const chain = replaced.impacts.find((row) => row.targetType === "ASSUMPTION");
        expect(chain?.targetId).toBe(successor.id);

        // REPLACED is terminal: reopen and edit both rejected.
        await expect(reopenAssumption(db, owner.id, projectId, "ASM-001")).rejects.toBeInstanceOf(
          AssumptionValidationError,
        );
        await expect(
          updateAssumption(db, owner.id, projectId, "ASM-001", { title: "X" }),
        ).rejects.toBeInstanceOf(AssumptionValidationError);
        await expect(
          getAssumptionByCode(db, owner.id, projectId, "ASM-999"),
        ).rejects.toBeInstanceOf(AssumptionNotFoundError);
      });
    } finally {
      await pool.end();
    }
  });
});
