// Specification change labels (TASK-112).
//
// Pure presentational mapping: proposal statuses pair text labels with
// text glyphs so state is never communicated through color alone
// (AGENTS.md §66). No database, no AI.
export const PROPOSAL_STATUS_LABEL: Record<string, { label: string; glyph: string }> = {
  PENDING: { label: "Pending review", glyph: "○" },
  ACCEPTED: { label: "Accepted", glyph: "✓" },
  REJECTED: { label: "Rejected", glyph: "✕" },
};

export const PROPOSAL_STATUS_FILTERS = ["Pending", "Accepted", "Rejected", "All"] as const;

export function proposalStatusLabel(status: string): { label: string; glyph: string } {
  return PROPOSAL_STATUS_LABEL[status] ?? { label: status, glyph: "?" };
}

export function filterToStatus(filter: string | undefined): string | undefined {
  switch ((filter ?? "Pending").toLowerCase()) {
    case "pending":
      return "PENDING";
    case "accepted":
      return "ACCEPTED";
    case "rejected":
      return "REJECTED";
    default:
      return undefined;
  }
}
