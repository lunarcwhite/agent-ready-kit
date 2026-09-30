// User-task domain errors (TASK-090).
//
// Same two shapes as the sibling modules: UserTaskValidationError for bad
// caller input, UserTaskNotFoundError for a missing or inaccessible row.
// Cross-user failures surface as project-level NotFound through the scope
// gate — existence is never revealed.
export class UserTaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserTaskValidationError";
  }
}

export class UserTaskNotFoundError extends Error {
  constructor(message = "Task not found.") {
    super(message);
    this.name = "UserTaskNotFoundError";
  }
}
