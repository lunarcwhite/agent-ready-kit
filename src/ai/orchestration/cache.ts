// AI result cache (TASK-047, architecture.md §46).
//
// Avoids repeating equivalent AI work: a dependency fingerprint over the
// capability, project scope, state version, prompt version, task input, and
// built context identifies equivalent requests. Changed dependencies miss
// automatically (the fingerprint moves with them); prompt updates miss
// (version participates in the key); cross-project or cross-user hits are
// unrepresentable (scope participates in the key).
//
// Safety properties:
// - Hits return validated structured DATA only. The orchestrator never
//   writes canonical state (TASK-045 guarantee), so cached data cannot
//   overwrite newer confirmed state — and the state version inside the key
//   means newer state never even hits.
// - Only SUCCEEDED validations are stored; failures and refusals never are.
// - Process-local memory (no new table, no new infra for MVP): a miss
//   recomputes correctly, so eviction and restarts cost money, never
//   correctness. Callers disable with `cache: null` (tests stay hermetic).
import { createHash } from "node:crypto";

export interface FingerprintInput {
  capability: string;
  userId: string;
  projectId: string;
  stateVersion: number;
  promptKey: string;
  promptVersion: string;
  taskInput: string;
  contextJson: string;
}

export function buildFingerprint(input: FingerprintInput): string {
  const canonical = [
    input.capability,
    input.userId,
    input.projectId,
    String(input.stateVersion),
    input.promptKey,
    input.promptVersion,
    input.taskInput,
    input.contextJson,
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface CachedValue {
  data: unknown;
  model: string;
}

interface CacheEntry {
  value: CachedValue;
  expiresAt: number;
}

function cloneData(data: unknown): unknown {
  // Cache isolation: validated output is JSON-safe by construction
  // (orchestrator parses it from JSON text), so a round-trip clone keeps
  // one caller from mutating another caller's result through the cache.
  return JSON.parse(JSON.stringify(data) as string) as unknown;
}

export class MemoryCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly maxEntries: number = 500,
    private readonly ttlMs: number = 10 * 60 * 1000,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer.");
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("ttlMs must be positive.");
    }
  }

  get(key: string, now: number = Date.now()): CachedValue | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return { model: entry.value.model, data: cloneData(entry.value.data) };
  }

  set(key: string, value: CachedValue, now: number = Date.now()): void {
    if (this.entries.has(key)) this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, {
      value: { model: value.model, data: cloneData(value.data) },
      expiresAt: now + this.ttlMs,
    });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

// Process-wide cache for production wiring; tests construct their own
// MemoryCache (or pass null) to stay isolated.
export const globalCache = new MemoryCache();
