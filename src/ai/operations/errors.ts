// AI operation ledger errors (TASK-043).
export class OperationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationValidationError";
  }
}

export class OperationNotFoundError extends Error {
  constructor(message = "AI operation not found.") {
    super(message);
    this.name = "OperationNotFoundError";
  }
}
