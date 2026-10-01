// Agent Kit domain errors (TASK-102).
//
// Same two shapes as the sibling modules: AgentKitValidationError for bad
// caller input, AgentKitNotFoundError for missing or inaccessible rows.
// Cross-user misses surface as NotFound through the scope gates of the
// composed domains — existence is never revealed.
export class AgentKitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentKitValidationError";
  }
}

export class AgentKitNotFoundError extends Error {
  constructor(message = "Agent Kit artifact not found.") {
    super(message);
    this.name = "AgentKitNotFoundError";
  }
}
