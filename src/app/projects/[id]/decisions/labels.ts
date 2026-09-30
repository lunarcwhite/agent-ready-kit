// Decision Center labels (TASK-058, design.md §31–§33).
//
// Pure presentational mapping: every decision status pairs a text label
// with a text glyph so state is never communicated through color alone
// (AGENTS.md §66). No database, no AI.
export const DECISION_STATUS_LABEL: Record<string, { label: string; glyph: string }> = {
  UNRESOLVED: { label: "Needs decision", glyph: "?" },
  RECOMMENDED: { label: "Recommended", glyph: "◇" },
  CONFIRMED: { label: "Confirmed", glyph: "✓" },
  DEFERRED: { label: "Deferred", glyph: "○" },
  NOT_APPLICABLE: { label: "Not applicable", glyph: "—" },
};

export const DECISION_STATUS_FILTERS = [
  "All",
  "Unresolved",
  "Recommended",
  "Confirmed",
  "Deferred",
] as const;
export type DecisionStatusFilter = (typeof DECISION_STATUS_FILTERS)[number];

export function decisionStatusLabel(status: string): { label: string; glyph: string } {
  return DECISION_STATUS_LABEL[status] ?? { label: status, glyph: "?" };
}

export function filterToStatus(filter: string | undefined): string | undefined {
  switch ((filter ?? "All").toLowerCase()) {
    case "unresolved":
      return "UNRESOLVED";
    case "recommended":
      return "RECOMMENDED";
    case "confirmed":
      return "CONFIRMED";
    case "deferred":
      return "DEFERRED";
    default:
      return undefined;
  }
}

export function formatDecisionValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? "—" : value;
  try {
    return JSON.stringify(value) ?? "—";
  } catch {
    return "—";
  }
}
