// Prompt definition contract (TASK-041, agents.md §50–51).
//
// Every production AI capability carries a versioned prompt with a stable
// key. Definitions live in source control, not the database
// (database-schema.md §59); ai_operations records the used key+version
// (TASK-043) so output-quality regressions stay traceable. Updates are
// new versions — historical definitions are frozen, never rewritten.
export interface PromptDefinition {
  key: string;
  version: string;
  role: string;
  objective: string;
  boundaries: string[];
  outputSchema: string;
  qualityCriteria: string[];
}

const KEY_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+(\.\d+)?$/;
const MAX_TEXT_LENGTH = 20000;

function requireText(value: string, field: string): string {
  const text = value.trim();
  if (text === "") throw new PromptValidationError(`${field} is required.`);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new PromptValidationError(`${field} must be at most ${MAX_TEXT_LENGTH} characters.`);
  }
  return text;
}

export class PromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptValidationError";
  }
}

export class PromptNotFoundError extends Error {
  constructor(message = "Prompt not found.") {
    super(message);
    this.name = "PromptNotFoundError";
  }
}

// Validates shape and returns a frozen copy: registered prompts are
// immutable, so a held reference can never observe a later "update".
export function definePrompt(raw: PromptDefinition): PromptDefinition {
  const key = raw.key.trim().toLowerCase();
  if (!KEY_PATTERN.test(key)) {
    throw new PromptValidationError(
      "key must be lowercase dot-notation (e.g. discovery.extract-answer).",
    );
  }
  const version = raw.version.trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new PromptValidationError("version must be MAJOR.MINOR with optional .PATCH (e.g. 1.2).");
  }
  const role = requireText(raw.role, "role");
  const objective = requireText(raw.objective, "objective");
  const outputSchema = requireText(raw.outputSchema, "outputSchema");
  if (!Array.isArray(raw.boundaries) || raw.boundaries.length === 0) {
    throw new PromptValidationError("boundaries must be a non-empty array of strings.");
  }
  if (!Array.isArray(raw.qualityCriteria) || raw.qualityCriteria.length === 0) {
    throw new PromptValidationError("qualityCriteria must be a non-empty array of strings.");
  }
  const boundaries = raw.boundaries.map((item) => requireText(String(item), "boundaries[]"));
  const qualityCriteria = raw.qualityCriteria.map((item) =>
    requireText(String(item), "qualityCriteria[]"),
  );
  return Object.freeze({
    key,
    version,
    role,
    objective,
    boundaries: Object.freeze(boundaries) as string[],
    outputSchema,
    qualityCriteria: Object.freeze(qualityCriteria) as string[],
  });
}
