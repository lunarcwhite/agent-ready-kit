// Decision domain errors (TASK-021).
//
// Same two shapes as the projects module: DecisionValidationError for bad
// caller input, DecisionNotFoundError for a missing or inaccessible row.
// Authorization failures surface as NotFound — the domain never reveals
// whether another user's decision exists.
export class DecisionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionValidationError";
  }
}

export class DecisionNotFoundError extends Error {
  constructor(message = "Decision not found.") {
    super(message);
    this.name = "DecisionNotFoundError";
  }
}
