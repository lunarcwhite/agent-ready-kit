// Traceability domain errors (TASK-024).
//
// TraceabilityValidationError for bad caller input (unknown node types,
// malformed relationships, duplicates, links to withdrawn rows).
// TraceabilityNotFoundError for missing links or nodes. Cross-project
// attempts fail at the project scope gate as project-level NotFound.
export class TraceabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceabilityValidationError";
  }
}

export class TraceabilityNotFoundError extends Error {
  constructor(message = "Traceability link not found.") {
    super(message);
    this.name = "TraceabilityNotFoundError";
  }
}
