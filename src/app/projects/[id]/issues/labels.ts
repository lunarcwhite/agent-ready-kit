// Validation workspace labels (TASK-077).
//
// Pure presentational mapping: severities and issue types pair text
// labels with text glyphs so state is never communicated through color
// alone (AGENTS.md §66). Assumptions (unverified beliefs to confirm)
// and contradictions (specs that disagree) get distinct glyphs and
// explainers so the two are never confused. No database, no AI.
export const ISSUE_SEVERITY_LABEL: Record<string, { label: string; glyph: string }> = {
  BLOCKER: { label: "Blocker", glyph: "■" },
  HIGH: { label: "High", glyph: "▲" },
  MEDIUM: { label: "Medium", glyph: "●" },
  LOW: { label: "Low", glyph: "○" },
  INFO: { label: "Info", glyph: "ℹ" },
};

export const ISSUE_TYPE_LABEL: Record<string, { label: string; glyph: string; hint: string }> = {
  COMPLETENESS: { label: "Gap", glyph: "○", hint: "Something required is missing." },
  CONSISTENCY: {
    label: "Contradiction",
    glyph: "≠",
    hint: "Approved specs disagree — reconcile them.",
  },
  DEPENDENCY: { label: "Dependency", glyph: "⤳", hint: "A reference does not resolve." },
  IMPLEMENTATION_COVERAGE: {
    label: "Coverage",
    glyph: "◍",
    hint: "A requirement has no downstream mapping.",
  },
  ASSUMPTION: {
    label: "Assumption",
    glyph: "?",
    hint: "Unverified belief — confirm, replace, or reject it.",
  },
  ORPHAN: { label: "Orphan", glyph: "∅", hint: "Nothing references this artifact." },
  SECURITY: { label: "Security", glyph: "⚠", hint: "Needs a security decision." },
};

export const ISSUE_STATUS_FILTERS = ["Open", "Resolved", "Ignored", "All"] as const;
export const ISSUE_SEVERITY_FILTERS = ["All", "Blocker", "High", "Medium", "Low", "Info"] as const;

export function issueSeverityLabel(severity: string): { label: string; glyph: string } {
  return ISSUE_SEVERITY_LABEL[severity] ?? { label: severity, glyph: "?" };
}

export function issueTypeLabel(type: string): { label: string; glyph: string; hint: string } {
  return ISSUE_TYPE_LABEL[type] ?? { label: type, glyph: "?", hint: "Needs triage." };
}

export function severityToFilter(value: string | undefined): string | undefined {
  switch ((value ?? "All").toLowerCase()) {
    case "blocker":
      return "BLOCKER";
    case "high":
      return "HIGH";
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
    case "info":
      return "INFO";
    default:
      return undefined;
  }
}

export function statusToFilter(value: string | undefined): string | undefined {
  switch ((value ?? "Open").toLowerCase()) {
    case "open":
      return "OPEN";
    case "resolved":
      return "RESOLVED";
    case "ignored":
      return "IGNORED";
    default:
      return undefined;
  }
}
