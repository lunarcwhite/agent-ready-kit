// Knowledge domain errors (TASK-055).
//
// Same two shapes as the sibling modules: KnowledgeValidationError for bad
// caller input, KnowledgeNotFoundError for a missing or inaccessible row.
// Cross-user failures surface as project-level NotFound through the scope
// gate — existence is never revealed.
export class KnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeValidationError";
  }
}

export class KnowledgeNotFoundError extends Error {
  constructor(message = "Knowledge item not found.") {
    super(message);
    this.name = "KnowledgeNotFoundError";
  }
}
