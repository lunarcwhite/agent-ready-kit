// Project domain errors (TASK-011).
//
// Only two shapes: ProjectValidationError for bad caller input (empty name,
// bad language enum, unreadable references) and ProjectNotFoundError for a
// missing or inaccessible row. Authorization failures surface as NotFound —
// the domain never reveals whether another user's project exists.
export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(message = "Project not found.") {
    super(message);
    this.name = "ProjectNotFoundError";
  }
}
