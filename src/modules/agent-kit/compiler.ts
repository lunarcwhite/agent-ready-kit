// Generic Agent Kit compiler (TASK-104, FR-120, agents.md §45, §47, §68).
//
// Deterministic application service (never an LLM agent): approved
// snapshots + README + manifest → canonical in-memory package. ZIP
// serialization is TASK-105; this module ends at the verified file set
// so the archive layer cannot silently reshape content.
//
// Assembly contract:
// - Required entry points: README.md, AGENTS.md, context.md, and the
//   manifest itself. A kit without its bootstrap trio is meaningless, so
//   missing AGENTS.md/context.md fails loudly (naming what to approve
//   first) instead of shipping a hollow package.
// - docs/* are included when approved. PRODUCT_AGENTS and SOUL are the
//   explicitly optional documents (applicability-gated upstream); other
//   missing docs are simply not approved yet. Nothing is backfilled with
//   placeholders (§47).
// - Paths match manifest: every manifest artifact path resolves to
//   assembled content, verified here, not trusted.
// - No secrets by construction: inputs are approved snapshot text, the
//   project name, kit paths, and version numbers. User ids, emails,
//   tokens, and provider keys are never read, so they cannot leak.
// - Rebuildable: same approved state plus the same generatedAt yields a
//   byte-identical package (the timestamp is the only time input, and it
//   is injectable). Vendor-neutral: target is always "generic" —
//   vendor adapters (TASK-106) derive later, never here.
import type { AppDatabase } from "../../infrastructure/database/db";
import { getProject } from "../projects/repository";
import { AgentKitValidationError } from "./errors";
import {
  AGENT_KIT_FILE_PATHS,
  renderAgentKitFiles,
  renderReadme,
  type RenderedDocument,
} from "./renderer";
import { AGENT_KIT_MANIFEST_PATH, generateManifest, type AgentKitManifest } from "./manifest";

export interface AgentKitFile {
  path: string;
  content: string;
}

export interface AssembledAgentKit {
  files: AgentKitFile[];
  manifest: AgentKitManifest;
}

export interface AssembleAgentKitOptions {
  generatedAt?: string;
}

const REQUIRED_SPEC_PATHS = [AGENT_KIT_FILE_PATHS.AGENT_INSTRUCTIONS, AGENT_KIT_FILE_PATHS.CONTEXT];

function toArtifacts(files: RenderedDocument[]) {
  return files.map((file) => ({
    path: file.path,
    documentType: file.documentType,
    version: file.version,
    projectStateVersion: file.projectStateVersion,
  }));
}

// Assemble the canonical package. Read-only against project state:
// rendering, manifesting, and assembly never write canonical rows.
export async function assembleAgentKit(
  db: AppDatabase,
  userId: string,
  projectId: string,
  options: AssembleAgentKitOptions = {},
): Promise<AssembledAgentKit> {
  if (userId.trim() === "") throw new AgentKitValidationError("Owner is required.");
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;

  const rendered = await renderAgentKitFiles(db, userId, pid);
  const renderedPaths = new Set(rendered.map((file) => file.path));
  const missing = REQUIRED_SPEC_PATHS.filter((path) => !renderedPaths.has(path));
  if (missing.length > 0) {
    throw new AgentKitValidationError(
      `Cannot assemble an Agent Kit without approved ${missing.join(", ")} — approve them first.`,
    );
  }

  const readme = renderReadme(detail.project.name, rendered);
  const manifest = await generateManifest(db, userId, pid, toArtifacts(rendered), {
    generatedAt: options.generatedAt,
  });

  const files: AgentKitFile[] = [
    { path: "README.md", content: readme },
    ...rendered.map((file) => ({ path: file.path, content: file.content })),
    { path: AGENT_KIT_MANIFEST_PATH, content: `${JSON.stringify(manifest, null, 2)}\n` },
  ];

  // Paths match manifest (AC): every declared artifact resolves, no
  // duplicates, required entries present.
  const byPath = new Map<string, number>();
  for (const file of files) {
    byPath.set(file.path, (byPath.get(file.path) ?? 0) + 1);
  }
  const duplicated = [...byPath.entries()].filter(([, count]) => count > 1).map(([path]) => path);
  if (duplicated.length > 0) {
    throw new AgentKitValidationError(
      `Assembled package has duplicated paths: ${duplicated.join(", ")}.`,
    );
  }
  const contentPaths = new Set(files.map((file) => file.path));
  const unlisted = manifest.artifacts
    .map((artifact) => artifact.path)
    .filter((path) => !contentPaths.has(path));
  if (unlisted.length > 0) {
    throw new AgentKitValidationError(
      `Manifest lists artifacts with no content: ${unlisted.join(", ")}.`,
    );
  }
  for (const required of [...REQUIRED_SPEC_PATHS, "README.md", AGENT_KIT_MANIFEST_PATH]) {
    if (!contentPaths.has(required)) {
      throw new AgentKitValidationError(`Assembled package is missing ${required}.`);
    }
  }

  return { files, manifest };
}
