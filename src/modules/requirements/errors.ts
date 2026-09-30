// Requirement domain errors (TASK-023).
//
// Same two shapes as the sibling modules: RequirementValidationError for
// bad caller input, RequirementNotFoundError for a missing or inaccessible
// row. Cross-user failures surface as project-level NotFound through the
// scope gate — existence is never revealed.
export class RequirementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequirementValidationError";
  }
}

export class RequirementNotFoundError extends Error {
  constructor(message = "Requirement not found.") {
    super(message);
    this.name = "RequirementNotFoundError";
  }
}
