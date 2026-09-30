// Bounded repair policy (TASK-042, agents.md §53).
//
// One repair attempt, then failure: the orchestrator (TASK-045) re-presents
// the validation issues to the model exactly once. A second failure marks
// the operation FAILED with canonical state untouched. This module owns the
// policy constants and the repair-prompt fragment — execution stays with
// the orchestrator.
import type { ValidationIssue } from "./schema";

export const MAX_REPAIR_ATTEMPTS = 1;

export function shouldAttemptRepair(attemptsUsed: number, issues: ValidationIssue[]): boolean {
  return attemptsUsed < MAX_REPAIR_ATTEMPTS && issues.length > 0;
}

export function buildRepairPrompt(originalText: string, issues: ValidationIssue[]): string {
  const lines = issues.map((issue) => `- ${issue.path}: ${issue.message}`);
  return [
    "Your previous output failed validation. Return corrected JSON only.",
    "Problems:",
    ...lines,
    "Previous output:",
    originalText,
  ].join("\n");
}
