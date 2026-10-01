// Agent Kit manifest builder (TASK-103, FR-121, AGENTS.md §96).
//
// Builds the `.agent-ready/manifest.json` object identifying exactly what
// an export package contains and which project state it corresponds to.
// The manifest is the §96 integrity anchor: paths listed here must match
// the package contents (checked by the assembler, TASK-104), and
// sourceStateVersion names the canonical state the package was generated
// from — never an uncontrolled mixture.
//
// Field notes:
// - readiness carries the project's stored lifecycleState + readinessScore
//   (deterministic current values). Scoring itself belongs to the engine
//   (TASK-081); the manifest only records.
// - target names the export adapter; the canonical package is always
//   "generic" (TASK-106 adapters derive from it, never the reverse).
// - generatedAt defaults to now (spec-mandated metadata) and is
//   injectable so tests stay deterministic.
// - Per-artifact snapshot versions ride along, so a package mixing
//   snapshots approved at different states stays identifiable per file.
import type { AppDatabase } from "../../infrastructure/database/db";
import { getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { AgentKitValidationError } from "./errors";

export const AGENT_KIT_MANIFEST_SCHEMA_VERSION = "1.0";
export const AGENT_KIT_MANIFEST_PATH = ".agent-ready/manifest.json";
export const GENERIC_EXPORT_TARGET = "generic" as const;

export interface ManifestArtifactInput {
  /** Kit-relative path, e.g. docs/PRD.md. Must be unique. */
  path: string;
  /** Specification document type when the artifact is one (absent for README). */
  documentType?: string;
  /** Approved snapshot number the content was rendered from. */
  version: number;
  /** Project state version that snapshot was approved from. */
  projectStateVersion: number;
}

export interface ManifestArtifact {
  path: string;
  documentType: string | null;
  version: number;
  projectStateVersion: number;
}

export interface ManifestReadiness {
  lifecycleState: string;
  readinessScore: number;
}

export interface AgentKitManifest {
  schemaVersion: string;
  projectId: string;
  projectName: string;
  generatedAt: string;
  sourceStateVersion: number;
  readiness: ManifestReadiness;
  target: string;
  artifacts: ManifestArtifact[];
}

export interface GenerateManifestOptions {
  target?: string;
  generatedAt?: string;
}

function requirePositiveInt(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new AgentKitValidationError(`${field} must be a positive integer.`);
  }
}

function normalizeArtifacts(raw: ManifestArtifactInput[] | undefined): ManifestArtifact[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AgentKitValidationError("artifacts must be a non-empty array.");
  }
  const seen = new Set<string>();
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new AgentKitValidationError(`artifacts[${i}] must be an object.`);
    }
    const path = String(item.path ?? "").trim();
    if (path === "" || path.startsWith("/")) {
      throw new AgentKitValidationError(
        `artifacts[${i}].path must be a non-empty kit-relative path.`,
      );
    }
    if (seen.has(path)) {
      throw new AgentKitValidationError(`artifacts[${i}].path "${path}" is duplicated.`);
    }
    seen.add(path);
    const documentType =
      item.documentType === undefined ? null : String(item.documentType).trim() || null;
    requirePositiveInt(item.version, `artifacts[${i}].version`);
    requirePositiveInt(item.projectStateVersion, `artifacts[${i}].projectStateVersion`);
    return {
      path,
      documentType,
      version: item.version,
      projectStateVersion: item.projectStateVersion,
    };
  });
}

// Manifest for an export package. Project identity, readiness snapshot,
// and source state version resolve inside the caller's scope (never
// trusted from arguments); the artifact list is validated structurally —
// path↔content correspondence is the assembler's check (TASK-104).
export async function generateManifest(
  db: AppDatabase,
  userId: string,
  projectId: string,
  artifacts: ManifestArtifactInput[],
  options: GenerateManifestOptions = {},
): Promise<AgentKitManifest> {
  if (userId.trim() === "") throw new AgentKitValidationError("Owner is required.");
  const files = normalizeArtifacts(artifacts);
  const target = String(options.target ?? GENERIC_EXPORT_TARGET).trim();
  if (target === "") throw new AgentKitValidationError("target is required.");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new AgentKitValidationError("generatedAt must be a valid timestamp.");
  }

  const detail = await getProject(db, userId, projectId);
  const sourceStateVersion = await getStateVersion(db, userId, detail.project.id);
  return {
    schemaVersion: AGENT_KIT_MANIFEST_SCHEMA_VERSION,
    projectId: detail.project.id,
    projectName: detail.project.name,
    generatedAt,
    sourceStateVersion,
    readiness: {
      lifecycleState: detail.project.lifecycleState,
      readinessScore: detail.project.readinessScore,
    },
    target,
    artifacts: files,
  };
}
