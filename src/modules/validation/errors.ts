// Validation issue domain errors (TASK-070) and assumption domain errors
// (TASK-074).
//
// Same two shapes per domain: *ValidationError for bad caller input,
// *NotFoundError for a missing or inaccessible row. Cross-user failures
// surface as project-level NotFound through the scope gate — existence is
// never revealed.
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

export class AssumptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssumptionValidationError";
  }
}

export class AssumptionNotFoundError extends Error {
  constructor(message = "Assumption not found.") {
    super(message);
    this.name = "AssumptionNotFoundError";
  }
}
