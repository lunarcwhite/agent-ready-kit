// Canonical knowledge taxonomy (tasks.md §18a deliverable, D-KNOW,
// database-schema.md §19, PRD FR-030).
//
// Four vocabularies describe the same concepts with different words: PRD
// FR-030 lists product-facing areas, TASK-055 lists authoring categories,
// Discovery uses interview domains, and the database stores one canonical
// domain per concept. This table resolves the synonyms so every layer
// converges on a single `KnowledgeDomain` before persistence — the column
// never stores an alias.
//
// Synonym resolutions (one canonical per concept):
// - USER ↔ Users ↔ Personas (people, not product surface)
// - ACCESS ↔ Access ↔ authentication/collaboration (who may enter)
// - DATA ↔ Entities (domain facts that later become persistence)
// - PRODUCT ↔ Vision ↔ Scope (what the product is)
// - UX ↔ Design ↔ Design Decisions (experience surface)
// - TECHNICAL ↔ Technical Decisions (how it is built)
// - NON_FUNCTIONAL ↔ Constraints ↔ NFR (limits and qualities)
import { KnowledgeValidationError } from "./errors";

export const KNOWLEDGE_DOMAINS = [
  "PRODUCT",
  "USER",
  "FEATURE",
  "BUSINESS_RULE",
  "ACCESS",
  "DATA",
  "UX",
  "TECHNICAL",
  "INTEGRATION",
  "AI",
  "NON_FUNCTIONAL",
] as const;
export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

// Human/authoring aliases accepted at the domain boundary. Keys are matched
// case-insensitively after trimming; multi-word labels use underscores or
// spaces interchangeably ("business rules" == "BUSINESS_RULES").
const DOMAIN_ALIASES: Record<string, KnowledgeDomain> = {
  // PRODUCT — vision and scope.
  PRODUCT: "PRODUCT",
  VISION: "PRODUCT",
  SCOPE: "PRODUCT",
  // USER — users and personas.
  USER: "USER",
  USERS: "USER",
  PERSONA: "USER",
  PERSONAS: "USER",
  // FEATURE.
  FEATURE: "FEATURE",
  FEATURES: "FEATURE",
  // BUSINESS_RULE.
  BUSINESS_RULE: "BUSINESS_RULE",
  BUSINESS_RULES: "BUSINESS_RULE",
  // ACCESS — auth, accounts, collaboration.
  ACCESS: "ACCESS",
  AUTHENTICATION: "ACCESS",
  COLLABORATION: "ACCESS",
  // DATA — domain entities.
  DATA: "DATA",
  ENTITIES: "DATA",
  ENTITY: "DATA",
  // UX — design surface.
  UX: "UX",
  DESIGN: "UX",
  DESIGN_DECISIONS: "UX",
  UX_DECISIONS: "UX",
  // TECHNICAL — how it is built.
  TECHNICAL: "TECHNICAL",
  TECHNICAL_DECISIONS: "TECHNICAL",
  // INTEGRATION.
  INTEGRATION: "INTEGRATION",
  INTEGRATIONS: "INTEGRATION",
  // AI — application AI behavior.
  AI: "AI",
  AI_BEHAVIOR: "AI",
  // NON_FUNCTIONAL — constraints and qualities.
  NON_FUNCTIONAL: "NON_FUNCTIONAL",
  CONSTRAINTS: "NON_FUNCTIONAL",
  CONSTRAINT: "NON_FUNCTIONAL",
  NFR: "NON_FUNCTIONAL",
  NON_FUNCTIONAL_REQUIREMENTS: "NON_FUNCTIONAL",
};

function normalizeAliasKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

// Maps any accepted vocabulary to its canonical domain. Unknown labels are a
// domain error — silently filing knowledge under the wrong concept would
// corrupt downstream compilers (TASK-056+), so the caller must choose.
export function normalizeKnowledgeDomain(raw: string): KnowledgeDomain {
  const canonical = DOMAIN_ALIASES[normalizeAliasKey(raw)];
  if (!canonical) {
    throw new KnowledgeValidationError(
      `domain must be one of ${KNOWLEDGE_DOMAINS.join(", ")} (aliases accepted, e.g. Vision→PRODUCT, Personas→USER, Entities→DATA).`,
    );
  }
  return canonical;
}
