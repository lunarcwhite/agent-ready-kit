// Discovery workspace labels (TASK-034, design.md §24–§26).
//
// Pure presentational mapping: every status/level pairs a text label with a
// text glyph so state is never communicated through color alone (AGENTS.md
// §66, design accessibility). No database, no AI.
export const NODE_STATUS_LABEL: Record<string, { label: string; glyph: string }> = {
  UNKNOWN: { label: "Not started", glyph: "○" },
  PARTIAL: { label: "In progress", glyph: "●" },
  RESOLVED: { label: "Complete", glyph: "✓" },
  NOT_APPLICABLE: { label: "Not applicable", glyph: "—" },
};

export const DISCOVERY_LEVEL_LABEL: Record<string, string> = {
  INITIAL: "Initial",
  QUICK_DRAFT: "Quick Draft",
  DETAILED: "Detailed",
  AGENT_READY: "Agent Ready",
};

export function nodeStatusLabel(status: string): { label: string; glyph: string } {
  return NODE_STATUS_LABEL[status] ?? { label: status, glyph: "?" };
}

export function discoveryLevelLabel(level: string): string {
  return DISCOVERY_LEVEL_LABEL[level] ?? level;
}
