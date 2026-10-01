// Agent Kit Markdown renderer (TASK-102, FR-120, agents.md §47).
//
// Renders approved specification state into exportable Markdown files.
// "Approved" means the latest approval snapshot (specification_versions),
// not live sections: versions are immutable, bound to the project state
// version they were approved from, and therefore the only source that can
// satisfy the export-integrity rule (AGENTS.md §96 — a package must
// correspond to a known project state, never an uncontrolled mixture of
// live edits). Live PROPOSED/STALE content never ships through this path.
//
// The renderer is deliberately thin and pure where possible:
//
// - renderApprovedDocument: latest approved snapshot for one document
//   type, or null when the document was never approved (missing document
//   and zero-version documents are both "not applicable" — §47: omit
//   optional documents instead of generating placeholders).
// - renderAgentKitFiles: the canonical kit file set in FR-120 order,
//   omissions excluded.
// - renderReadme: package index from the project name plus the rendered
//   file list. Pure function of its inputs — no timestamps, no ids, no
//   hashes — so identical inputs always yield byte-identical output.
//
// Acceptance properties, enforced by construction:
//
// - Deterministic: snapshot text passes through untouched; ordering is a
//   fixed constant; README carries no timestamps. Render twice, diff
//   never.
// - Stable identifiers preserved: the renderer never rewrites content —
//   FR-001, UTASK-001, and friends survive byte-for-byte.
// - Internal-only metadata excluded: snapshots already contain only
//   section titles plus rendered bodies; the renderer adds no ids,
//   hashes, timestamps, or operation metadata.
// - UTF-8: text is never re-encoded or escaped; what was approved is
//   what ships.
import type { AppDatabase } from "../../infrastructure/database/db";
import {
  listDocuments,
  listVersions,
  SPECIFICATION_DOCUMENT_TYPES,
  type SpecificationDocumentType,
} from "../specifications/documents";
import { AgentKitValidationError } from "./errors";

// Canonical kit layout (FR-120, agents.md §47): AGENTS.md and context.md at
// the root, compiled specifications under docs/. README.md and
// .agent-ready/manifest.json are assembled by TASK-103/104, not here.
export const AGENT_KIT_FILE_PATHS: Record<SpecificationDocumentType, string> = {
  AGENT_INSTRUCTIONS: "AGENTS.md",
  CONTEXT: "context.md",
  PRD: "docs/PRD.md",
  ARCHITECTURE: "docs/architecture.md",
  DATABASE_SCHEMA: "docs/database-schema.md",
  DESIGN: "docs/design.md",
  PRODUCT_AGENTS: "docs/agents.md",
  SOUL: "docs/soul.md",
  TASKS: "docs/tasks.md",
};

const KIT_ORDER: SpecificationDocumentType[] = [
  "AGENT_INSTRUCTIONS",
  "CONTEXT",
  "PRD",
  "ARCHITECTURE",
  "DATABASE_SCHEMA",
  "DESIGN",
  "PRODUCT_AGENTS",
  "SOUL",
  "TASKS",
];

const FILE_DESCRIPTIONS: Record<string, string> = {
  "AGENTS.md": "Instructions for the coding agent working on this project.",
  "context.md": "Compact project bootstrap — read first.",
  "docs/PRD.md": "Product requirements.",
  "docs/architecture.md": "System architecture.",
  "docs/database-schema.md": "Persistence design.",
  "docs/design.md": "UX and interface specification.",
  "docs/agents.md": "The product's own AI agents.",
  "docs/soul.md": "Product AI behavior.",
  "docs/tasks.md": "Implementation plan.",
};

export interface RenderedDocument {
  documentType: SpecificationDocumentType;
  /** Kit-relative path, e.g. docs/PRD.md. */
  path: string;
  /** Approved snapshot number (1-based per document). */
  version: number;
  /** Project state version the snapshot was approved from (§96). */
  projectStateVersion: number;
  /** Approved Markdown, byte-identical to the snapshot. */
  content: string;
}

function requireOwner(userId: string): void {
  if (userId.trim() === "") throw new AgentKitValidationError("Owner is required.");
}

function requireDocumentType(raw: string): SpecificationDocumentType {
  if (!(SPECIFICATION_DOCUMENT_TYPES as readonly string[]).includes(raw)) {
    throw new AgentKitValidationError(
      `documentType must be one of ${SPECIFICATION_DOCUMENT_TYPES.join(", ")}.`,
    );
  }
  return raw as SpecificationDocumentType;
}

// Latest approved snapshot for one document type. Null when there is
// nothing approved to ship — the omission signal TASK-104 uses to skip
// optional documents. Never throws for missing content; unknown types and
// blank owners are caller bugs and throw.
export async function renderApprovedDocument(
  db: AppDatabase,
  userId: string,
  projectId: string,
  documentType: string,
): Promise<RenderedDocument | null> {
  requireOwner(userId);
  const type = requireDocumentType(documentType);
  const documents = await listDocuments(db, userId, projectId);
  const document = documents.find((doc) => doc.documentType === type);
  if (!document) return null;
  const versions = await listVersions(db, userId, projectId, type);
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1]!;
  return {
    documentType: type,
    path: AGENT_KIT_FILE_PATHS[type],
    version: latest.version,
    projectStateVersion: latest.projectStateVersion,
    content: latest.content,
  };
}

// Full kit file set in canonical order (one scoped document list, then one
// version read per present document — bounded by the nine known types).
// Returns only approved documents; callers must not backfill omissions.
export async function renderAgentKitFiles(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<RenderedDocument[]> {
  requireOwner(userId);
  const documents = await listDocuments(db, userId, projectId);
  const present = new Set(documents.map((doc) => doc.documentType));
  const files: RenderedDocument[] = [];
  for (const type of KIT_ORDER) {
    if (!present.has(type)) continue;
    const versions = await listVersions(db, userId, projectId, type);
    if (versions.length === 0) continue;
    const latest = versions[versions.length - 1]!;
    files.push({
      documentType: type,
      path: AGENT_KIT_FILE_PATHS[type],
      version: latest.version,
      projectStateVersion: latest.projectStateVersion,
      content: latest.content,
    });
  }
  return files;
}

// Package index: project name plus the rendered file set. Pure and
// timestamp-free — byte-identical for identical inputs, so the assembler
// (TASK-104) can treat it as deterministic derived content.
export function renderReadme(projectName: string, files: { path: string }[]): string {
  const name = projectName.trim();
  if (name === "") throw new AgentKitValidationError("projectName is required.");
  const lines = [
    `# ${name} — Agent Kit`,
    "",
    "Implementation-ready context for a coding agent, generated by Agent Ready Kit.",
    "",
    "## Contents",
    "",
  ];
  for (const file of files) {
    const description = FILE_DESCRIPTIONS[file.path] ?? "Specification document.";
    lines.push(`- \`${file.path}\` — ${description}`);
  }
  lines.push("", "Start with `context.md`, then follow `AGENTS.md`.");
  return lines.join("\n");
}
