// AI operation labels (TASK-115, AGENTS.md §62).
//
// One central map from operation/capability keys to the human sentence
// the UI shows while it runs. §62 requires describing the ACTUAL
// operation ("Checking specification consistency..."), never a generic
// "AI is thinking..." — and §62 forbids fake percentages, so labels are
// plain sentences with no numeric progress. Unknown keys fall back to a
// neutral sentence rather than leaking internal key names.
//
// Pure data + lookup: no database, no AI.
const OPERATION_LABELS: Record<string, string> = {
  IDEA_ANALYSIS: "Analyzing your idea…",
  "idea-analysis": "Analyzing your idea…",
  DISCOVERY_QUESTION: "Formulating the next question…",
  "discovery-question": "Formulating the next question…",
  ANSWER_EXTRACTION: "Understanding your answer…",
  "answer-extraction": "Understanding your answer…",
  KNOWLEDGE_CURATION: "Updating project knowledge…",
  "knowledge-curation": "Updating project knowledge…",
  PRODUCT_COMPILATION: "Writing the product specification…",
  "product-compilation": "Writing the product specification…",
  ARCHITECTURE_COMPILATION: "Writing the architecture specification…",
  "architecture-compilation": "Writing the architecture specification…",
  DATA_COMPILATION: "Writing the data model…",
  "data-compilation": "Writing the data model…",
  DESIGN_COMPILATION: "Writing the design specification…",
  "design-compilation": "Writing the design specification…",
  PRODUCT_AGENT_COMPILATION: "Designing product agents…",
  "product-agents-compilation": "Designing product agents…",
  SOUL_COMPILATION: "Describing AI behavior…",
  "soul-compilation": "Describing AI behavior…",
  SEMANTIC_VALIDATION: "Checking specification consistency…",
  "semantic-validation": "Checking specification consistency…",
  ASSUMPTION_DETECTION: "Looking for hidden assumptions…",
  "assumption-detection": "Looking for hidden assumptions…",
  TASK_GENERATION: "Planning implementation tasks…",
  "task-generation": "Planning implementation tasks…",
  CONTEXT_COMPILATION: "Writing the project bootstrap…",
  "context-compilation": "Writing the project bootstrap…",
  INSTRUCTION_COMPILATION: "Writing coding-agent instructions…",
  "instruction-compilation": "Writing coding-agent instructions…",
};

export const FALLBACK_OPERATION_LABEL = "Working on your request…";

export function operationLabel(key: string): string {
  const normalized = key.trim();
  if (normalized === "") return FALLBACK_OPERATION_LABEL;
  return (
    OPERATION_LABELS[normalized] ??
    OPERATION_LABELS[normalized.toLowerCase()] ??
    OPERATION_LABELS[normalized.toUpperCase()] ??
    FALLBACK_OPERATION_LABEL
  );
}
