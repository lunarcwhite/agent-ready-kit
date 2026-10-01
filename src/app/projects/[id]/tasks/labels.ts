// Task plan labels (TASK-095).
//
// Pure presentational mapping: every task status pairs a text label with
// a text glyph so state is never communicated through color alone
// (AGENTS.md §66). No database, no AI.
export const TASK_STATUS_LABEL: Record<string, { label: string; glyph: string }> = {
  PENDING: { label: "Pending", glyph: "○" },
  READY: { label: "Ready", glyph: "◇" },
  BLOCKED: { label: "Blocked", glyph: "!" },
  REVIEW_REQUIRED: { label: "Needs review", glyph: "◐" },
  DONE: { label: "Done", glyph: "✓" },
};

export const TASK_STATUS_FILTERS = [
  "All",
  "Pending",
  "Ready",
  "Blocked",
  "Needs review",
  "Done",
] as const;
export type TaskStatusFilter = (typeof TASK_STATUS_FILTERS)[number];

export function taskStatusLabel(status: string): { label: string; glyph: string } {
  return TASK_STATUS_LABEL[status] ?? { label: status, glyph: "?" };
}

export function filterToStatus(filter: string | undefined): string | undefined {
  switch ((filter ?? "All").toLowerCase()) {
    case "pending":
      return "PENDING";
    case "ready":
      return "READY";
    case "blocked":
      return "BLOCKED";
    case "needs review":
      return "REVIEW_REQUIRED";
    case "done":
      return "DONE";
    default:
      return undefined;
  }
}
