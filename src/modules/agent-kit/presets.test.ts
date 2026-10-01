// TASK-145 acceptance: presets adjust placement only, canonical specs
// identical, unsupported targets rejected, preset recorded. Pure unit
// tests — no database, no AI.
import { describe, expect, it } from "vitest";
import { AgentKitValidationError } from "./errors";
import { adaptAgentKit, supportedTargets } from "./adapters";
import {
  CLAUDE_CODE_TARGET,
  CODEX_TARGET,
  TASTE_SKILL_TARGET,
  UAAF_TARGET,
  registerVendorPresets,
} from "./presets";
import type { AgentKitFile } from "./compiler";

const FILES: AgentKitFile[] = [
  { path: "AGENTS.md", content: "Work this way." },
  { path: "context.md", content: "Mission FR-001." },
];

describe("vendor export presets (pure, no database)", () => {
  it("registers codex, claude-code, taste-skill, and uaaf idempotently", () => {
    const first = registerVendorPresets();
    const second = registerVendorPresets();
    expect(new Set(first)).toEqual(
      new Set([CODEX_TARGET, CLAUDE_CODE_TARGET, TASTE_SKILL_TARGET, UAAF_TARGET]),
    );
    expect(second).toEqual([]);
    expect(supportedTargets()).toEqual(
      expect.arrayContaining([
        "generic",
        CODEX_TARGET,
        CLAUDE_CODE_TARGET,
        TASTE_SKILL_TARGET,
        UAAF_TARGET,
      ]),
    );
  });

  it("adds one pointer file per preset and keeps canonical bytes identical", () => {
    registerVendorPresets();
    for (const [target, pointer] of [
      [CODEX_TARGET, "CODEX.md"],
      [CLAUDE_CODE_TARGET, "CLAUDE.md"],
    ] as const) {
      const adapted = adaptAgentKit(FILES, target);
      const byPath = new Map(adapted.map((file) => [file.path, file.content]));
      expect(byPath.get("AGENTS.md")).toBe("Work this way.");
      expect(byPath.get("context.md")).toBe("Mission FR-001.");
      const pointerContent = byPath.get(pointer);
      expect(pointerContent).toContain("AGENTS.md");
      expect(pointerContent).toContain("context.md");
      expect(pointerContent).not.toContain("FR-001");
    }
  });

  it("taste-skill preset adds skill files and keeps canonical bytes identical", () => {
    registerVendorPresets();
    const adapted = adaptAgentKit(FILES, TASTE_SKILL_TARGET);
    const byPath = new Map(adapted.map((file) => [file.path, file.content]));
    expect(byPath.get("AGENTS.md")).toBe("Work this way.");
    expect(byPath.get("context.md")).toBe("Mission FR-001.");
    const skillPaths = [
      "skills/taste-skill/SKILL.md",
      "skills/taste-skill-v1/SKILL.md",
      "skills/gpt-tasteskill/SKILL.md",
      "skills/image-to-code-skill/SKILL.md",
      "skills/redesign-skill/SKILL.md",
      "skills/soft-skill/SKILL.md",
      "skills/minimalist-skill/SKILL.md",
      "skills/brutalist-skill/SKILL.md",
      "skills/output-skill/SKILL.md",
      "skills/stitch-skill/SKILL.md",
      "skills/imagegen-frontend-web/SKILL.md",
      "skills/imagegen-frontend-mobile/SKILL.md",
      "skills/brandkit/SKILL.md",
      "skills/LICENSE",
    ];
    for (const path of skillPaths) {
      const content = byPath.get(path);
      expect(content, `missing skill file: ${path}`).toBeDefined();
      expect(content!.length, `empty skill file: ${path}`).toBeGreaterThan(0);
    }
    const license = byPath.get("skills/LICENSE");
    expect(license).toContain("MIT License");
    expect(license).toContain("Leonxlnx");
  });

  it("uaaf preset adds governance scaffold and keeps canonical bytes identical", () => {
    registerVendorPresets();
    const adapted = adaptAgentKit(FILES, UAAF_TARGET);
    const byPath = new Map(adapted.map((file) => [file.path, file.content]));
    expect(byPath.get("AGENTS.md")).toBe("Work this way.");
    expect(byPath.get("context.md")).toBe("Mission FR-001.");
    const uaafPaths = [
      ".ai/manifest.yaml",
      ".ai/INDEX.md",
      ".ai/anti-slop/GATES.md",
      ".ai/AGENTS.md",
      "templates/task-contract.yaml",
      "templates/evidence-receipt.yaml",
      "uaaf/LICENSE",
    ];
    for (const path of uaafPaths) {
      const content = byPath.get(path);
      expect(content, `missing uaaf file: ${path}`).toBeDefined();
      expect(content!.length, `empty uaaf file: ${path}`).toBeGreaterThan(0);
    }
    const license = byPath.get("uaaf/LICENSE");
    expect(license).toContain("MIT License");
    expect(license).toContain("lunarcwhite");
    const gates = byPath.get(".ai/anti-slop/GATES.md");
    expect(gates).toContain("HARD GATE");
    expect(gates).toContain("PURPOSE GATE");
    expect(gates).toContain("QUALITY LOCK");
  });

  it("still rejects unknown targets", () => {
    registerVendorPresets();
    expect(() => adaptAgentKit(FILES, "not-an-ide")).toThrow(AgentKitValidationError);
    expect(() => adaptAgentKit(FILES, "not-an-ide")).toThrow(/Supported: /);
  });
});
