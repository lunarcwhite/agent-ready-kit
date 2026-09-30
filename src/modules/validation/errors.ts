// Validation issue domain errors (TASK-070).
//
// Same two shapes as the sibling modules: IssueValidationError for bad
// caller input, IssueNotFoundError for a missing or inaccessible row.
// Cross-user failures surface as project-level NotFound through the scope
// gate — existence is never revealed.
export class IssueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueValidationError";
  }
}

export class IssueNotFoundError extends Error {
  constructor(message = "Issue not found.") {
    super(message);
    this.name = "IssueNotFoundError";
  }
}
