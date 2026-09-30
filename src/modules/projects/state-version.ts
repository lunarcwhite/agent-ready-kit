// Project state versioning (TASK-020).
//
// Canonical state changes are numbered: every accepted meaningful change
// bumps projects.state_version by exactly one, atomically with the change
// itself. Future artifacts (spec versions, exports) reference history by
// storing this integer (database-schema.md §6) — no history table exists in
// the MVP boundary, the monotonic integer IS the version record.
//
// Rules:
// - Only APPROVED writes bump. incrementStateVersion runs inside the same
//   transaction as the data change it numbers, so an AI failure (or any
//   rollback) before commit leaves the approved version untouched.
// - Settings-only changes (preferred_stack/language) do NOT bump: they are
//   preferences, and a language switch must not change canonical intent
//   (agents.md §84). Callers decide what counts as meaningful; this module
//   only numbers what it is asked to number, atomically.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { projects } from "../../infrastructure/database/schema";
import { assertProjectOwnership } from "./authorization";
import { ProjectNotFoundError, ProjectValidationError } from "./errors";

// Current approved version. Lightweight projection (no input/settings
// joins): version checks must stay cheap enough for guards and headers.
export async function getStateVersion(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<number> {
  if (userId.trim() === "") throw new ProjectValidationError("Owner is required.");
  const row = await db.query.projects.findFirst({
    columns: { userId: true, stateVersion: true },
    where: and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)),
  });
  if (!row) throw new ProjectNotFoundError();
  assertProjectOwnership(row.userId, userId);
  return row.stateVersion;
}

// Atomic +1 scoped to (id, owner, live). Single statement: race-safe without
// a read-modify-write round-trip, and safe to call inside a caller-owned
// transaction (TASK-054's decision-apply will do exactly that) — on rollback
// the bump vanishes together with the uncommitted change.
export async function incrementStateVersion(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<number> {
  if (userId.trim() === "") throw new ProjectValidationError("Owner is required.");
  const [row] = await db
    .update(projects)
    .set({ stateVersion: sql`${projects.stateVersion} + 1` })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .returning({ stateVersion: projects.stateVersion });
  if (!row) throw new ProjectNotFoundError();
  return row.stateVersion;
}
