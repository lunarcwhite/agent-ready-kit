// Discovery domain errors (TASK-030).
//
// Same two shapes as decisions/requirements: ValidationError for bad caller
// input, NotFoundError for a missing or inaccessible row. Authorization
// failures surface as NotFound — the domain never reveals whether another
// user's Discovery Map exists.
export class DiscoveryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryValidationError";
  }
}

export class DiscoveryNotFoundError extends Error {
  constructor(message = "Discovery node not found.") {
    super(message);
    this.name = "DiscoveryNotFoundError";
  }
}
