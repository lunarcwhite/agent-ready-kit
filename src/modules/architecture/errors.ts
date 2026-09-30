// Architecture domain errors (TASK-059).
//
// Same two shapes as the sibling modules: ArchitectureValidationError for
// bad caller input, ArchitectureNotFoundError for a missing or inaccessible
// row. Cross-user failures surface as project-level NotFound through the
// scope gate — existence is never revealed.
export class ArchitectureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchitectureValidationError";
  }
}

export class ArchitectureNotFoundError extends Error {
  constructor(message = "Architecture record not found.") {
    super(message);
    this.name = "ArchitectureNotFoundError";
  }
}
