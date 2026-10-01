// TASK-106 acceptance: generic independent of adapters, adapters cannot
// modify canonical specs, unsupported targets rejected, interface
// independently testable. Pure unit tests — no database, no AI.
import { describe, expect, it } from "vitest";
import { AgentKitValidationError } from "./errors";
import {
  adaptAgentKit,
  registerTargetAdapter,
  supportedTargets,
} from "./adapters";
import type { AgentKitFile } from "./compiler";

const FILES: AgentKitFile[] = [
  { path: "AGENTS.md", content: "Work this way." },
  { path: "context.md", content: "Mission FR-001." },
];

describe("export target adapters", () => {
  it("ships a generic identity adapter with no dependency on vendors", () => {
    expect(supportedTargets()).toEqual(["generic"]);
    const adapted = adaptAgentKit(FILES, "generic");
    expect(adapted).toEqual(FILES);
    expect(adapted).not.toBe(FILES);
  });

  it("rejects unknown targets with the supported list", () => {
    expect(() => adaptAgentKit(FILES, "codex")).toThrow(AgentKitValidationError);
    expect(() => adaptAgentKit(FILES, "codex")).toThrow(/Supported: generic/);
    expect(() => adaptAgentKit(FILES, "  ")).toThrow(AgentKitValidationError);
  });

  it("lets adapters add vendor files but never touch canonical content", () => {
    registerTargetAdapter({
      target: "test-ide",
      description: "Test-only vendor preset.",
      adapt: (files) => [...files, { path: ".test-ide/config.json", content: "{}" }],
    });
    expect(supportedTargets()).toContain("test-ide");
    const adapted = adaptAgentKit(FILES, "test-ide");
    expect(adapted.map((file) => file.path)).toEqual([
      "AGENTS.md",
      "context.md",
      ".test-ide/config.json",
    ]);

    registerTargetAdapter({
      target: "dropper",
      description: "Drops a file.",
      adapt: (files) => files.slice(1),
    });
    expect(() => adaptAgentKit(FILES, "dropper")).toThrow(/dropped canonical file/);

    registerTargetAdapter({
      target: "rewriter",
      description: "Rewrites a file.",
      adapt: (files) => files.map((file) => ({ ...file, content: `${file.content} (edited)` })),
    });
    expect(() => adaptAgentKit(FILES, "rewriter")).toThrow(/modified canonical file/);
  });

  it("validates registration and file shapes", () => {
    expect(() =>
      registerTargetAdapter({ target: "test-ide", description: "Dupe.", adapt: (files) => files }),
    ).toThrow(/already registered/);
    expect(() =>
      registerTargetAdapter({ target: "Bad Name", description: "x", adapt: (files) => files }),
    ).toThrow(AgentKitValidationError);
    expect(() => adaptAgentKit([{ path: "../evil.md", content: "x" }], "generic")).toThrow(
      AgentKitValidationError,
    );
  });
});
