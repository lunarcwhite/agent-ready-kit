// Export README compiler (TASK-059, spec-decisions.md D-A07).
//
// PURE module: no database, no LLM, no I/O. renderAgentReadme turns caller-
// supplied project metadata into the `README.md` that orients coding agents
// opening an exported Agent Kit (architecture.md §38–§41).
//
// The README states the reading order (context first, then the active task
// and its referenced sections) and the source-of-truth locations —
// canonical structured state versus compiled Markdown artifacts (AGENTS.md
// §16, architecture.md §2) — so an agent knows which documents to read and
// which system of record each answers to. Catalogs of ARC-*/SCREEN-* codes
// give the agent stable handles without duplicating specification prose.
import { ArchitectureValidationError } from "./errors";

export interface ReadmeDocument {
  /** Human label, e.g. "Product specification". */
  name: string;
  /** Path inside the kit, e.g. "docs/PRD.md". */
  path: string;
  /** System of record this document answers to, e.g. "Requirements (FR-*)". */
  sourceOfTruth: string;
}

export interface ReadmeCatalogEntry {
  code: string;
  name: string;
  status: string;
}

export interface RenderAgentReadmeInput {
  projectName: string;
  lifecycleState: string;
  stateVersion: number;
  /** Ordered by intended reading order: first entry is read first. */
  documents: ReadmeDocument[];
  components?: ReadmeCatalogEntry[];
  screens?: ReadmeCatalogEntry[];
}

const MAX_NAME_LENGTH = 255;
const MAX_FIELD_LENGTH = 500;

function requireText(raw: unknown, field: string, max: number): string {
  if (typeof raw !== "string") {
    throw new ArchitectureValidationError(`${field} must be a string.`);
  }
  const text = raw.trim();
  if (text === "") throw new ArchitectureValidationError(`${field} is required.`);
  if (text.length > max) {
    throw new ArchitectureValidationError(`${field} must be at most ${max} characters.`);
  }
  return text;
}

function requireDocuments(raw: unknown): ReadmeDocument[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArchitectureValidationError("documents must be a non-empty array.");
  }
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ArchitectureValidationError(
        `documents[${i}] must be { name, path, sourceOfTruth }.`,
      );
    }
    const entry = item as Record<string, unknown>;
    return {
      name: requireText(entry.name, `documents[${i}].name`, MAX_NAME_LENGTH),
      path: requireText(entry.path, `documents[${i}].path`, MAX_FIELD_LENGTH),
      sourceOfTruth: requireText(
        entry.sourceOfTruth,
        `documents[${i}].sourceOfTruth`,
        MAX_FIELD_LENGTH,
      ),
    };
  });
}

function requireCatalog(raw: unknown, field: string): ReadmeCatalogEntry[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ArchitectureValidationError(`${field} must be an array when provided.`);
  }
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ArchitectureValidationError(`${field}[${i}] must be { code, name, status }.`);
    }
    const entry = item as Record<string, unknown>;
    return {
      code: requireText(entry.code, `${field}[${i}].code`, MAX_FIELD_LENGTH),
      name: requireText(entry.name, `${field}[${i}].name`, MAX_NAME_LENGTH),
      status: requireText(entry.status, `${field}[${i}].status`, MAX_FIELD_LENGTH),
    };
  });
}

function renderCatalog(title: string, entries: ReadmeCatalogEntry[]): string {
  const lines = [`## ${title}`, ""];
  if (entries.length === 0) {
    lines.push("None recorded yet.", "");
    return lines.join("\n");
  }
  for (const entry of entries) {
    lines.push(`- \`${entry.code}\` — ${entry.name} (${entry.status})`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderAgentReadme(raw: RenderAgentReadmeInput): string {
  if (typeof raw !== "object" || raw === null) {
    throw new ArchitectureValidationError("input must be an object.");
  }
  const projectName = requireText(raw.projectName, "projectName", MAX_NAME_LENGTH);
  const lifecycleState = requireText(raw.lifecycleState, "lifecycleState", MAX_FIELD_LENGTH);
  if (!Number.isInteger(raw.stateVersion) || (raw.stateVersion as number) < 0) {
    throw new ArchitectureValidationError("stateVersion must be a non-negative integer.");
  }
  const documents = requireDocuments(raw.documents);
  const components = requireCatalog(raw.components, "components");
  const screens = requireCatalog(raw.screens, "screens");

  const lines: string[] = [
    `# ${projectName} — Agent Kit README`,
    "",
    `> Lifecycle: ${lifecycleState} · state version: ${raw.stateVersion}`,
    ">",
    "> This kit orients a coding agent. Canonical project state lives in",
    "> structured records; the Markdown documents below are compiled",
    "> artifacts — never treat them as the source of truth.",
    "",
    "## Reading order",
    "",
    "Read in this order; each document builds on the previous ones.",
    "",
  ];
  documents.forEach((doc, i) => {
    lines.push(`${i + 1}. \`${doc.path}\` — ${doc.name} (source of truth: ${doc.sourceOfTruth})`);
  });
  lines.push("", "## Source-of-truth locations", "");
  for (const doc of documents) {
    lines.push(`- ${doc.sourceOfTruth} → \`${doc.path}\``);
  }
  lines.push(
    "",
    renderCatalog("Architecture components", components),
    renderCatalog("Screens", screens),
    "## Implementation rules",
    "",
    "- Do not silently change confirmed requirements or architecture.",
    "- Implement only the active task scope; respect task dependencies.",
    "- Verify every acceptance criterion before marking work done.",
    "- Do not mark incomplete work DONE.",
    "",
  );
  return lines.join("\n");
}
