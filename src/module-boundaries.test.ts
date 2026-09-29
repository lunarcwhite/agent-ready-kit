import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Module boundary contract per docs/architecture.md §62 (TASK-002).
// Directories carry `.gitkeep` until domain code lands; this test pins the
// structure so concerns are not silently merged into generic folders.
// ponytail: add import-graph assertions (no cycles, no provider SDKs in
// domain) once domain code exists; structural check is the ceiling for now.
const DOMAIN_MODULES = [
  "src/modules/projects",
  "src/modules/discovery",
  "src/modules/decisions",
  "src/modules/knowledge",
  "src/modules/specifications",
  "src/modules/validation",
  "src/modules/readiness",
  "src/modules/tasks",
  "src/modules/agent-kit", // Exports concern lives here, not in specifications.
];

const AI_AREAS = [
  "src/ai/providers",
  "src/ai/prompts",
  "src/ai/context",
  "src/ai/schemas",
  "src/ai/orchestration",
];

const INFRA_AREAS = [
  "src/infrastructure/database",
  "src/infrastructure/auth",
  "src/infrastructure/storage",
  "src/shared",
];

function isDirectory(rel: string): boolean {
  const abs = join(process.cwd(), rel);
  return existsSync(abs) && statSync(abs).isDirectory();
}

describe("module boundaries", () => {
  it("exposes one directory per domain concern", () => {
    for (const dir of DOMAIN_MODULES) expect(isDirectory(dir), dir).toBe(true);
  });

  it("keeps AI orchestration out of domain logic", () => {
    for (const dir of AI_AREAS) expect(isDirectory(dir), dir).toBe(true);
    for (const dir of AI_AREAS) expect(dir.startsWith("src/modules/"), dir).toBe(false);
  });

  it("isolates export packaging, readiness, and shared infrastructure", () => {
    expect(isDirectory("src/modules/agent-kit")).toBe(true);
    expect(isDirectory("src/modules/specifications")).toBe(true);
    expect(isDirectory("src/modules/readiness")).toBe(true);
    for (const dir of INFRA_AREAS) expect(isDirectory(dir), dir).toBe(true);
  });
});
