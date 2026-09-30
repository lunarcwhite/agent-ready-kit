// Prompt registry (TASK-041, architecture.md §20).
//
// Central versioned store: registerPrompt adds immutable definitions,
// resolvePrompt returns an exact version or the latest for a key. Same
// key + new version supersedes for future lookups while the old definition
// object stays intact — historical ai_operations rows keep pointing at
// content that can never change underneath them.
import {
  PromptNotFoundError,
  PromptValidationError,
  definePrompt,
  type PromptDefinition,
} from "./types";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class PromptRegistry {
  private readonly versions = new Map<string, Map<string, PromptDefinition>>();

  register(raw: PromptDefinition): PromptDefinition {
    const definition = definePrompt(raw);
    let keyVersions = this.versions.get(definition.key);
    if (!keyVersions) {
      keyVersions = new Map();
      this.versions.set(definition.key, keyVersions);
    }
    if (keyVersions.has(definition.version)) {
      throw new PromptValidationError(
        `Prompt "${definition.key}" version ${definition.version} is already registered.`,
      );
    }
    keyVersions.set(definition.version, definition);
    return definition;
  }

  resolve(key: string, version?: string): PromptDefinition {
    const normalized = key.trim().toLowerCase();
    const keyVersions = this.versions.get(normalized);
    if (!keyVersions || keyVersions.size === 0) {
      throw new PromptNotFoundError(`Prompt "${key}" is not registered.`);
    }
    if (version !== undefined) {
      const exact = keyVersions.get(version.trim());
      if (!exact) {
        throw new PromptNotFoundError(`Prompt "${key}" version ${version} is not registered.`);
      }
      return exact;
    }
    const latest = [...keyVersions.values()].sort((a, b) => compareVersions(a.version, b.version));
    const top = latest[latest.length - 1];
    if (!top) throw new PromptNotFoundError(`Prompt "${key}" is not registered.`);
    return top;
  }

  listKeys(): string[] {
    return [...this.versions.keys()].sort();
  }

  listVersions(key: string): string[] {
    const keyVersions = this.versions.get(key.trim().toLowerCase());
    if (!keyVersions) throw new PromptNotFoundError(`Prompt "${key}" is not registered.`);
    return [...keyVersions.keys()].sort(compareVersions);
  }
}

// Process-wide registry for production wiring; tests construct their own
// PromptRegistry to stay isolated.
export const globalPrompts = new PromptRegistry();
