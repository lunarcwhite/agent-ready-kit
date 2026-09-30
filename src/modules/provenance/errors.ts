// Provenance errors (TASK-025).
export class ProvenanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceValidationError";
  }
}
