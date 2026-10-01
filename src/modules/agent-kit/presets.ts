// Limited vendor export presets (TASK-145, P2).
//
// Initial presets for selected coding-agent environments. Each preset
// adds exactly one small pointer file naming the target and its entry
// points — instruction placement, never specification content. The
// adaptAgentKit boundary (adapters.ts) verifies afterwards that every
// canonical file is still present byte-identical, so a preset
// physically cannot modify product intent, decisions, requirements,
// or architecture. Generic stays canonical; unsupported targets keep
// falling back to it explicitly at the call site.
//
// Registration is idempotent so test and route modules can ensure
// presets without caring who ran first.
import { registerTargetAdapter, supportedTargets } from "./adapters";
import type { AgentKitFile } from "./compiler";
import { getTasteSkillFiles } from "./taste-skill";
import { getUaafFiles } from "./uaaf";

function pointerFile(filename: string, target: string): AgentKitFile {
  return {
    path: filename,
    content: [
      `# ${target} entry point`,
      ``,
      `This Agent Kit targets ${target}. It is a thin preset over the`,
      `canonical vendor-neutral package — product intent lives in the`,
      `canonical files, never here.`,
      ``,
      `Reading order:`,
      ``,
      `1. AGENTS.md — how to work on this project`,
      `2. context.md — project bootstrap`,
      `3. docs/tasks.md — executable work`,
      ``,
    ].join("\n"),
  };
}

export const CODEX_TARGET = "codex" as const;
export const CLAUDE_CODE_TARGET = "claude-code" as const;
export const TASTE_SKILL_TARGET = "taste-skill" as const;
export const UAAF_TARGET = "uaaf" as const;

export function registerVendorPresets(): string[] {
  const registered: string[] = [];
  const ensure = (target: string, description: string, file: AgentKitFile): void => {
    if (supportedTargets().includes(target)) return;
    registerTargetAdapter({
      target,
      description,
      adapt: (files) => [...files.map((entry) => ({ ...entry })), file],
    });
    registered.push(target);
  };
  ensure(
    CODEX_TARGET,
    "Muse preset: adds a CODEX.md entry pointer; canonical files untouched.",
    pointerFile("CODEX.md", "Muse"),
  );
  ensure(
    CLAUDE_CODE_TARGET,
    "Claude Code preset: adds a CLAUDE.md entry pointer; canonical files untouched.",
    pointerFile("CLAUDE.md", "Claude Code"),
  );
  if (!supportedTargets().includes(TASTE_SKILL_TARGET)) {
    registerTargetAdapter({
      target: TASTE_SKILL_TARGET,
      description:
        "Taste Skill preset: adds anti-slop frontend skill files (MIT License); canonical files untouched.",
      adapt: (files) => [...files.map((entry) => ({ ...entry })), ...getTasteSkillFiles()],
    });
    registered.push(TASTE_SKILL_TARGET);
  }
  if (!supportedTargets().includes(UAAF_TARGET)) {
    registerTargetAdapter({
      target: UAAF_TARGET,
      description:
        "UAAF preset: adds AI governance scaffold with task contracts and evidence receipts (MIT License); canonical files untouched.",
      adapt: (files) => [...files.map((entry) => ({ ...entry })), ...getUaafFiles()],
    });
    registered.push(UAAF_TARGET);
  }
  return registered;
}
