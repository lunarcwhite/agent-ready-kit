// Specification domain errors (TASK-060).
//
// Same two shapes as the sibling modules: SpecificationValidationError for
// bad caller input, SpecificationNotFoundError for a missing or
// inaccessible row. Cross-user failures surface as project-level NotFound
// through the scope gate — existence is never revealed.
export class SpecificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecificationValidationError";
  }
}

export class SpecificationNotFoundError extends Error {
  constructor(message = "Specification not found.") {
    super(message);
    this.name = "SpecificationNotFoundError";
  }
}
