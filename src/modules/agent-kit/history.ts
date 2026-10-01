// Export history domain (TASK-107, deps TASK-020 state versioning).
//
// Append-only ledger answering "when did we last export, and is that
// export stale?". recordExport is called by the export flow AFTER a
// package is generated (archive.ts stays side-effect free); staleness is
// computed live as last.source_state_version vs current state version.
//
// Recording is bookkeeping: it never bumps the project state version
// (same posture as traceability links) and never mutates canonical rows.
// Every function resolves ownership through requireProjectScope —
// cross-project history is unrepresentable, not merely rejected.
import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { exportHistory } from "../../infrastructure/database/schema/export-history";
import { requireProjectScope } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { AgentKitValidationError } from "./errors";
import { GENERIC_TARGET } from "./adapters";

export interface ExportHistoryRow {
  id: string;
  projectId: string;
  target: string;
  sourceStateVersion: number;
  artifactCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordExportInput {
  target?: string;
  sourceStateVersion: number;
  artifactCount: number;
}

export interface ExportStaleness {
  stale: boolean;
  lastExport: ExportHistoryRow | null;
  currentStateVersion: number;
}

const TARGET_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

function toRow(raw: typeof exportHistory.$inferSelect): ExportHistoryRow {
  return { ...raw };
}

// Persist one export record. The caller passes the versions from the
// generated package (manifest.sourceStateVersion, file count) — history
// records what was shipped, never re-derives it.
export async function recordExport(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: RecordExportInput,
): Promise<ExportHistoryRow> {
  if (userId.trim() === "") throw new AgentKitValidationError("Owner is required.");
  const target = String(raw.target ?? GENERIC_TARGET)
    .trim()
    .toLowerCase();
  if (!TARGET_PATTERN.test(target)) {
    throw new AgentKitValidationError("target must be lowercase kebab-case, 2-32 characters.");
  }
  if (!Number.isInteger(raw.sourceStateVersion) || raw.sourceStateVersion < 1) {
    throw new AgentKitValidationError("sourceStateVersion must be a positive integer.");
  }
  if (!Number.isInteger(raw.artifactCount) || raw.artifactCount < 1) {
    throw new AgentKitValidationError("artifactCount must be a positive integer.");
  }
  const scope = await requireProjectScope(db, userId, projectId);
  const [inserted] = await db
    .insert(exportHistory)
    .values({
      projectId: scope.projectId,
      target,
      sourceStateVersion: raw.sourceStateVersion,
      artifactCount: raw.artifactCount,
    })
    .returning();
  if (!inserted) throw new AgentKitValidationError("Export recording failed.");
  return toRow(inserted);
}

export async function listExports(
  db: AppDatabase,
  userId: string,
  projectId: string,
  limit = 20,
): Promise<ExportHistoryRow[]> {
  if (userId.trim() === "") throw new AgentKitValidationError("Owner is required.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AgentKitValidationError("limit must be an integer between 1 and 100.");
  }
  const scope = await requireProjectScope(db, userId, projectId);
  const rows = await db.query.exportHistory.findMany({
    where: eq(exportHistory.projectId, scope.projectId),
    orderBy: [desc(exportHistory.createdAt)],
    limit,
  });
  return rows.map(toRow);
}

export async function getLastExport(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<ExportHistoryRow | null> {
  const rows = await listExports(db, userId, projectId, 1);
  return rows[0] ?? null;
}

// Live staleness: no export yet counts as stale (nothing to download),
// otherwise the recorded version must equal the current state version.
export async function isLastExportStale(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<ExportStaleness> {
  if (userId.trim() === "") throw new AgentKitValidationError("Owner is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const [lastExport, currentStateVersion] = await Promise.all([
    getLastExport(db, userId, scope.projectId),
    getStateVersion(db, userId, scope.projectId),
  ]);
  if (!lastExport) return { stale: true, lastExport: null, currentStateVersion };
  return {
    stale: lastExport.sourceStateVersion !== currentStateVersion,
    lastExport,
    currentStateVersion,
  };
}
