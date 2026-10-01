// Readiness domain errors (TASK-080).
export class ReadinessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessValidationError";
  }
}
