// Orchestrator errors (TASK-045).
export class OrchestratorError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
    this.operationId = operationId;
  }
}
