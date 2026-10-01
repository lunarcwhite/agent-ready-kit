// Change impact domain errors (TASK-113).
//
// Same two shapes as the sibling modules: ChangeImpactValidationError for
// bad caller input (including unacknowledged high-impact propagation),
// ChangeImpactNotFoundError for missing rows. Cross-project misses surface
// as NotFound through the scope gates of the composed domains — existence
// is never revealed.
export class ChangeImpactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeImpactValidationError";
  }
}

export class ChangeImpactNotFoundError extends Error {
  constructor(message = "Change impact target not found.") {
    super(message);
    this.name = "ChangeImpactNotFoundError";
  }
}
