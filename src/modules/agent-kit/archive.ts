// Agent Kit ZIP export (TASK-105, FR-122, architecture.md §42).
//
// Serializes the assembled canonical package (TASK-104) into a download
// archive. On-demand and in-memory by architecture decision (§42 "avoid
// permanently storing archives"): no temp files are created, so there is
// nothing to clean — the "temporary files" acceptance criterion is met
// vacuously and documented as such.
//
// - Filename: derived from the project slug (safe ASCII, no traversal),
//   suffixed `-agent-kit.zip`.
// - Authorization: project ownership resolves through the scoped assembly
//   path (TASK-014) — a foreign projectId is unrepresentable here, and
//   the future download route inherits the same gate by calling this.
// - Failure safety: assembly is read-only and zipping is pure; a failure
//   throws before any bytes are returned, so canonical state can never
//   be half-exported. Archive integrity (openable, correct entries) is
//   verified by round-tripping through unzip in tests plus a real
//   third-party opener outside CI (Expand-Archive).
import { strToU8, zipSync } from "fflate";
import type { AppDatabase } from "../../infrastructure/database/db";
import { getProject } from "../projects/repository";
import { deriveSlug } from "../projects/slugs";
import { AgentKitValidationError } from "./errors";
import { assembleAgentKit } from "./compiler";

export interface AgentKitArchive {
  /** Safe download filename, e.g. my-project-agent-kit.zip. */
  filename: string;
  /** Archive bytes (in-memory; never written to disk here). */
  bytes: Uint8Array;
  /** Number of file entries in the archive. */
  fileCount: number;
  /** Project state version the package was generated from. */
  sourceStateVersion: number;
}

export interface ExportAgentKitOptions {
  generatedAt?: string;
}

// Export the project as a ZIP archive. Returns bytes for the download
// route to stream; nothing is stored server-side.
export async function exportAgentKitZip(
  db: AppDatabase,
  userId: string,
  projectId: string,
  options: ExportAgentKitOptions = {},
): Promise<AgentKitArchive> {
  if (userId.trim() === "") throw new AgentKitValidationError("Owner is required.");
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;

  const kit = await assembleAgentKit(db, userId, pid, { generatedAt: options.generatedAt });
  const slug = deriveSlug(detail.project.name);
  const filename = `${slug}-agent-kit.zip`;

  let bytes: Uint8Array;
  try {
    const entries: Record<string, Uint8Array> = {};
    for (const file of kit.files) {
      entries[file.path] = strToU8(file.content);
    }
    bytes = zipSync(entries, { level: 6 });
  } catch (error) {
    throw new AgentKitValidationError(
      `ZIP packaging failed: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
  }
  return {
    filename,
    bytes,
    fileCount: kit.files.length,
    sourceStateVersion: kit.manifest.sourceStateVersion,
  };
}
