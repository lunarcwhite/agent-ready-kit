// Export target adapters (TASK-106, FR-122, agents.md §48, AGENTS.md §24).
//
// Boundary between the canonical generic package (TASK-104) and
// vendor-specific presets (Codex, Claude Code, Cursor, Gemini CLI).
// MVP rule: generic is canonical and never depends on adapters; vendor
// adapters may only ADD instruction placement, vendor configuration, or
// compatible metadata — never rewrite or drop canonical content.
//
// The framework enforces that boundary deterministically: after an
// adapter runs, every input file must still be present byte-identical,
// output paths must be unique kit-relative locations, and unknown targets
// are rejected with the supported list (no silent fallback that could
// ship the wrong shape). Only the generic identity adapter ships in MVP;
// vendor presets register through the same interface later.
import type { AgentKitFile } from "./compiler";
import { AgentKitValidationError } from "./errors";

export const GENERIC_TARGET = "generic" as const;

export interface TargetAdapter {
  target: string;
  description: string;
  adapt: (files: AgentKitFile[]) => AgentKitFile[];
}

const TARGET_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

const adapters = new Map<string, TargetAdapter>();

function requireTarget(raw: string): string {
  const target = raw.trim().toLowerCase();
  if (!TARGET_PATTERN.test(target)) {
    throw new AgentKitValidationError(
      "target must be lowercase kebab-case, 2-32 characters (e.g. claude-code).",
    );
  }
  return target;
}

function requireFiles(raw: AgentKitFile[], role: string): void {
  const seen = new Set<string>();
  for (const [i, file] of raw.entries()) {
    const path = typeof file?.path === "string" ? file.path : "";
    if (path === "" || path.startsWith("/") || path.split("/").includes("..")) {
      throw new AgentKitValidationError(`${role}[${i}].path must be a kit-relative path.`);
    }
    if (typeof file?.content !== "string") {
      throw new AgentKitValidationError(`${role}[${i}].content must be a string.`);
    }
    if (seen.has(path)) {
      throw new AgentKitValidationError(`${role} has a duplicated path: "${path}".`);
    }
    seen.add(path);
  }
}

function genericAdapter(): TargetAdapter {
  return {
    target: GENERIC_TARGET,
    description: "Canonical vendor-neutral package (identity transform).",
    adapt: (files) => files.map((file) => ({ ...file })),
  };
}

adapters.set(GENERIC_TARGET, genericAdapter());

export function supportedTargets(): string[] {
  return [...adapters.keys()].sort();
}

// Register a vendor preset. The interface is the deliverable — presets
// themselves arrive separately. Re-registration of a target is rejected so
// adapter behavior stays stable once published.
export function registerTargetAdapter(adapter: TargetAdapter): void {
  if (typeof adapter !== "object" || adapter === null || Array.isArray(adapter)) {
    throw new AgentKitValidationError("adapter must be an object.");
  }
  const target = requireTarget(String(adapter.target ?? ""));
  if (typeof adapter.description !== "string" || adapter.description.trim() === "") {
    throw new AgentKitValidationError("adapter description is required.");
  }
  if (typeof adapter.adapt !== "function") {
    throw new AgentKitValidationError("adapter.adapt must be a function.");
  }
  if (adapters.has(target)) {
    throw new AgentKitValidationError(`Export target "${target}" is already registered.`);
  }
  adapters.set(target, { target, description: adapter.description.trim(), adapt: adapter.adapt });
}

// Adapt an assembled generic package for a target. Unknown targets are
// rejected (callers fall back to generic explicitly); canonical content
// is verified byte-identical afterwards, so an adapter physically cannot
// modify specifications — only add vendor files around them.
export function adaptAgentKit(files: AgentKitFile[], target: string): AgentKitFile[] {
  requireFiles(files, "files");
  const name = requireTarget(target);
  const adapter = adapters.get(name);
  if (!adapter) {
    throw new AgentKitValidationError(
      `Unsupported export target "${target}". Supported: ${supportedTargets().join(", ")}.`,
    );
  }
  const adapted = adapter.adapt(files.map((file) => ({ ...file })));
  requireFiles(adapted, "adapted files");
  const adaptedByPath = new Map(adapted.map((file) => [file.path, file.content]));
  for (const file of files) {
    const content = adaptedByPath.get(file.path);
    if (content === undefined) {
      throw new AgentKitValidationError(`Adapter "${name}" dropped canonical file "${file.path}".`);
    }
    if (content !== file.content) {
      throw new AgentKitValidationError(
        `Adapter "${name}" modified canonical file "${file.path}".`,
      );
    }
  }
  return adapted;
}
