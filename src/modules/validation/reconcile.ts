// Shared finding reconciliation (TASK-071, TASK-072, ...).
//
// Every deterministic validator keys findings by stable (rule, target)
// identity in issue metadata, and every validator follows one lifecycle:
//
// - reruns never duplicate: an OPEN or IGNORED issue for a live finding is
//   left alone (IGNORED is a human decision and is never auto-touched;
//   RESOLVED rows are frozen history);
// - fixed findings auto-resolve: an OPEN issue with no live finding resolves
//   with resolution metadata;
// - regressions reopen: a live finding whose issue was RESOLVED moves back
//   to OPEN instead of minting a second issue.
//
// Centralizing this keeps severity triage and lifecycle identical across
// validators — only rule evaluation differs per validator.
import type { AppDatabase } from "../../infrastructure/database/db";
import {
  createIssue,
  listIssues,
  resolveIssue,
  updateIssue,
  type IssueReferenceInput,
  type IssueRow,
  type IssueSeverity,
  type IssueType,
} from "./issues";
import { IssueValidationError } from "./errors";

export interface ValidatorFinding {
  rule: string;
  targetKey: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  references: IssueReferenceInput[];
}

export interface ReconcileReport {
  created: string[];
  reopened: string[];
  resolved: string[];
  unchangedOpen: string[];
}

function findingKey(validator: string, rule: string, targetKey: string): string {
  return `${validator}::${rule}::${targetKey}`;
}

function issueFindingKey(validator: string, issue: IssueRow): string | null {
  const metadata = issue.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  if (metadata["validator"] !== validator) return null;
  const rule = metadata["rule"];
  const targetKey = metadata["targetKey"];
  if (typeof rule !== "string" || typeof targetKey !== "string") return null;
  return findingKey(validator, rule, targetKey);
}

export async function reconcileFindings(
  db: AppDatabase,
  userId: string,
  projectId: string,
  validator: string,
  type: IssueType,
  findings: ValidatorFinding[],
): Promise<ReconcileReport> {
  if (userId.trim() === "") throw new IssueValidationError("Owner is required.");
  const report: ReconcileReport = { created: [], reopened: [], resolved: [], unchangedOpen: [] };
  const live = new Map(
    findings.map((finding) => [findingKey(validator, finding.rule, finding.targetKey), finding]),
  );

  const existing = await listIssues(db, userId, projectId, { type });
  for (const finding of findings) {
    const match = existing.find(
      (issue) =>
        issueFindingKey(validator, issue) ===
        findingKey(validator, finding.rule, finding.targetKey),
    );
    if (!match) {
      const created = await createIssue(db, userId, projectId, {
        type,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        metadata: { validator, rule: finding.rule, targetKey: finding.targetKey },
        references: finding.references,
      });
      report.created.push(created.issueCode);
    } else if (match.status === "RESOLVED") {
      const reopened = await updateIssue(db, userId, projectId, match.issueCode, {
        status: "OPEN",
      });
      report.reopened.push(reopened.issueCode);
    } else if (match.status === "OPEN") {
      report.unchangedOpen.push(match.issueCode);
    }
  }

  const liveKeys = new Set(live.keys());
  for (const issue of existing) {
    const key = issueFindingKey(validator, issue);
    if (key === null || liveKeys.has(key)) continue;
    if (issue.status !== "OPEN") continue;
    const resolved = await resolveIssue(
      db,
      userId,
      projectId,
      issue.issueCode,
      "Finding no longer present in canonical state.",
      "Deterministic validator",
    );
    report.resolved.push(resolved.issueCode);
  }

  for (const list of [report.created, report.reopened, report.resolved, report.unchangedOpen]) {
    list.sort();
  }
  return report;
}
