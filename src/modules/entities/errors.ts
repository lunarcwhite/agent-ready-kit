// Entity domain errors (TASK-064).
//
// Same two shapes as the sibling modules: EntityValidationError for bad
// caller input, EntityNotFoundError for a missing or inaccessible row.
// Cross-user failures surface as project-level NotFound through the scope
// gate — existence is never revealed.
export class EntityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntityValidationError";
  }
}

export class EntityNotFoundError extends Error {
  constructor(message = "Entity record not found.") {
    super(message);
    this.name = "EntityNotFoundError";
  }
}
