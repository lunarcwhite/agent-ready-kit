// Product agent specification compiler (TASK-066, FR-044, agents.md A-014).
//
// Compiles canonical requirements + AI knowledge into PROPOSED PRODUCT_AGENTS
// sections — the TARGET product's own agents, never Agent Ready Kit
// internals (the internal catalog lives in docs/agents.md; this writes the
// export `agents.md` via the PRODUCT_AGENTS document type).
//
// Applicability gate (acceptance criterion), enforced deterministically
// BEFORE any AI call: the project must hold at least one CURRENT AI-domain
// knowledge item with EXPLICIT or INFERRED confidence. ASSUMED-only AI
// knowledge means the AI behavior is a guess, and generating agent roles
// from guesses would fabricate architecture (soul §6 truth over completion).
// Non-applicable projects return applicable:false with zero sections and
// zero provider calls — no cost, no invented agents.
//
// Proposal discipline for applicable projects, enforced deterministically:
//
// - Agent boundaries explicit: every section must declare its agent's name,
//   objective, non-empty boundaries, inputs, and outputs; a role without
//   stated boundaries aborts the whole batch.
// - FR identifiers preserved: every requirementCodes entry must resolve to
//   a live requirement; unknown codes abort the whole batch.
// - Priorities preserved BY CONSTRUCTION: structuredContent.requirements is
//   rebuilt from the requirements table, never trusted from model prose.
// - Unknowns explicit: undecided agent-design questions land in the
//   `agents.unknowns` section instead of prose as if decided.
// - Source state version: approval snapshots via createVersion, which binds
//   content to the then-current project state version.
//
// Like PRD (TASK-062) et al: compile (proposal-only, no canonical writes —
// spec rows are derived and never bump the version) then human review then
// createVersion. Section writes are idempotent by stable key.
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  PRODUCT_AGENTS_COMPILATION_PROMPT,
  PRODUCT_AGENTS_COMPILATION_PROMPT_KEY,
} from "../../ai/prompts/product-agents-compilation";
import {
  PRODUCT_AGENTS_COMPILATION_SCHEMA,
  type ProductAgentDefinition,
  type ProductAgentsCompilation,
} from "../../ai/schemas/product-agents-compilation";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { listRequirements, type RequirementRow } from "../requirements/requirements";
import {
  getKnowledgeByKey,
  listCurrentKnowledge,
  type KnowledgeItemRow,
} from "../knowledge/knowledge";
import { KnowledgeNotFoundError } from "../knowledge/errors";
import { ensureDocument, upsertSection, type SpecificationSectionRow } from "./documents";
import { setSectionDependencies } from "./dependencies";
import { assertSectionsInScope, normalizeSectionScope } from "./scope";
import { SpecificationValidationError } from "./errors";

export const PRODUCT_AGENTS_COMPILER_CAPABILITY = "product-agents-compilation" as const;
export const PRODUCT_AGENTS_COMPILER_OPERATION_TYPE = "PRODUCT_AGENT_COMPILATION";
export const PRODUCT_AGENTS_DOCUMENT_TYPE = "PRODUCT_AGENTS" as const;
export const PRODUCT_AGENTS_UNKNOWN_SECTION_KEY = "agents.unknowns";

export class ProductAgentsCompilerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "ProductAgentsCompilerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface CompileProductAgentsDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
  onlySectionKeys?: string[];
}

export interface ProductAgentsApplicability {
  applicable: boolean;
  aiKnowledgeCount: number;
  confirmedAiKnowledgeCount: number;
  reasons: string[];
}

export interface CompileProductAgentsResult {
  applicable: boolean;
  reasons: string[];
  sections: SpecificationSectionRow[];
  unknowns: SpecificationSectionRow | null;
  operationId: string | null;
  model: string | null;
  promptKey: string;
  promptVersion: string | null;
  repaired: boolean;
  latencyMs: number;
  stateVersion: number;
}

interface ValidatedSection {
  key: string;
  title: string;
  body: string;
  agent: ProductAgentDefinition;
  requirements: RequirementRow[];
  knowledge: KnowledgeItemRow[];
}

const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const LIVE_REQUIREMENT_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;
// Grounding bar for agent design: only user-confirmed AI knowledge counts.
// ASSUMED AI knowledge is a guess about product behavior, not a mandate to
// invent agent roles from.
const GROUNDING_CONFIDENCES = ["EXPLICIT", "INFERRED"] as const;

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(
      PRODUCT_AGENTS_COMPILATION_PROMPT_KEY,
      PRODUCT_AGENTS_COMPILATION_PROMPT.version,
    );
  } catch {
    try {
      registry.register({ ...PRODUCT_AGENTS_COMPILATION_PROMPT });
    } catch (error) {
      registry.resolve(
        PRODUCT_AGENTS_COMPILATION_PROMPT_KEY,
        PRODUCT_AGENTS_COMPILATION_PROMPT.version,
      );
      void error;
    }
  }
}

export async function evaluateProductAgentsApplicability(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<ProductAgentsApplicability> {
  if (userId.trim() === "")
    throw new ProductAgentsCompilerError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new ProductAgentsCompilerError("VALIDATION", "pending", "projectId is required.");
  }
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const knowledge = await listCurrentKnowledge(db, userId, pid);
  const ai = knowledge.filter((item) => item.domain === "AI");
  const confirmed = ai.filter((item) =>
    (GROUNDING_CONFIDENCES as readonly string[]).includes(item.confidence),
  );
  if (confirmed.length === 0) {
    const reasons =
      ai.length === 0
        ? ["No CURRENT AI-domain knowledge: the target product has no confirmed AI behavior."]
        : ["AI-domain knowledge is ASSUMED-only: agent roles cannot be grounded in guesses."];
    return {
      applicable: false,
      aiKnowledgeCount: ai.length,
      confirmedAiKnowledgeCount: 0,
      reasons,
    };
  }
  return {
    applicable: true,
    aiKnowledgeCount: ai.length,
    confirmedAiKnowledgeCount: confirmed.length,
    reasons: [
      `${confirmed.length} confirmed AI knowledge item(s) describe target-product AI behavior.`,
    ],
  };
}

function buildTaskInput(
  requirements: RequirementRow[],
  knowledge: KnowledgeItemRow[],
  scope: string[] | null,
): string {
  return JSON.stringify({
    scope,
    requirements: requirements.map((requirement) => ({
      code: requirement.requirementCode,
      type: requirement.type,
      title: requirement.title,
      description: requirement.description,
      priority: requirement.priority,
      status: requirement.status,
      acceptanceCriteria: requirement.acceptanceCriteria,
    })),
    aiKnowledge: knowledge
      .filter((item) => item.domain === "AI")
      .map((item) => ({
        key: item.knowledgeKey,
        title: item.title,
        content: item.content,
        confidence: item.confidence,
      })),
  });
}

// Full deterministic validation before any section is written:
// keys well-formed and unique, every agent bounded, every reference resolves
// to live canonical state, bodies non-empty. First failure aborts the batch.
async function validateCompilation(
  db: AppDatabase,
  userId: string,
  projectId: string,
  compilation: ProductAgentsCompilation,
  operationId: string,
): Promise<{ sections: ValidatedSection[]; unknowns: { topic: string; detail: string }[] }> {
  const fail = (message: string): never => {
    throw new ProductAgentsCompilerError("VALIDATION", operationId, message);
  };
  if (!Array.isArray(compilation.sections)) fail("Proposal sections must be an array.");
  if (!Array.isArray(compilation.unknowns)) fail("Proposal unknowns must be an array.");

  const seen = new Set<string>();
  const validated: ValidatedSection[] = [];
  for (const [index, section] of compilation.sections.entries()) {
    const key = String(section.key ?? "")
      .trim()
      .toLowerCase();
    if (!KEY_PATTERN.test(key)) fail(`sections[${index}]: key must be lowercase dot-notation.`);
    if (seen.has(key)) fail(`sections[${index}]: duplicate key "${key}".`);
    seen.add(key);
    const title = String(section.title ?? "").trim();
    if (title === "") fail(`sections[${index}]: title is required.`);
    const body = String(section.body ?? "");
    if (body.trim() === "") fail(`sections[${index}]: body is required.`);

    const raw = (section.agent ?? {}) as Partial<ProductAgentDefinition>;
    const name = String(raw.name ?? "").trim();
    const objective = String(raw.objective ?? "").trim();
    if (name === "") fail(`sections[${index}].agent: name is required.`);
    if (objective === "") fail(`sections[${index}].agent: objective is required.`);
    const list = (value: unknown, field: string, min: number): string[] => {
      if (!Array.isArray(value)) fail(`sections[${index}].agent.${field} must be an array.`);
      const cleaned = (value as unknown[])
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry !== "");
      if (cleaned.length < min) {
        fail(`sections[${index}].agent.${field} needs at least ${min} entry(s).`);
      }
      return cleaned;
    };
    const agent: ProductAgentDefinition = {
      name,
      objective,
      boundaries: list(raw.boundaries, "boundaries", 1),
      inputs: list(raw.inputs, "inputs", 1),
      outputs: list(raw.outputs, "outputs", 1),
    };

    const resolved: RequirementRow[] = [];
    for (const [i, code] of (section.requirementCodes ?? []).entries()) {
      const normalized = String(code ?? "")
        .trim()
        .toUpperCase();
      const [found] = await db
        .select()
        .from(requirements)
        .where(
          and(eq(requirements.projectId, projectId), eq(requirements.requirementCode, normalized)),
        )
        .limit(1);
      if (!found) fail(`sections[${index}].requirementCodes[${i}]: "${code}" does not exist.`);
      if (!(LIVE_REQUIREMENT_STATUSES as readonly string[]).includes(found.status)) {
        fail(`sections[${index}].requirementCodes[${i}]: "${code}" is not live.`);
      }
      resolved.push({
        ...found,
        type: found.type as RequirementRow["type"],
        priority: found.priority as RequirementRow["priority"],
        status: found.status as RequirementRow["status"],
        acceptanceCriteria: (found.acceptanceCriteria ?? null) as string[] | null,
        metadata: (found.metadata ?? null) as RequirementRow["metadata"],
      });
    }

    const knowledge: KnowledgeItemRow[] = [];
    for (const [i, rawKey] of (section.knowledgeKeys ?? []).entries()) {
      const knowledgeKey = String(rawKey ?? "")
        .trim()
        .toLowerCase();
      let item: KnowledgeItemRow | null = null;
      try {
        item = await getKnowledgeByKey(db, userId, projectId, knowledgeKey);
      } catch (error) {
        if (!(error instanceof KnowledgeNotFoundError)) throw error;
      }
      if (item === null) {
        throw new ProductAgentsCompilerError(
          "VALIDATION",
          operationId,
          `sections[${index}].knowledgeKeys[${i}]: "${rawKey}" does not exist.`,
        );
      }
      if (item.status === "SUPERSEDED") {
        fail(`sections[${index}].knowledgeKeys[${i}]: "${rawKey}" is superseded.`);
      }
      knowledge.push(item);
    }
    validated.push({ key, title, body, agent, requirements: resolved, knowledge });
  }

  const unknowns = (compilation.unknowns ?? []).map((unknown, i) => {
    const topic = String(unknown.topic ?? "").trim();
    const detail = String(unknown.detail ?? "").trim();
    if (topic === "" || detail === "") fail(`unknowns[${i}]: topic and detail are required.`);
    return { topic, detail };
  });
  return { sections: validated, unknowns };
}

function skipped(reasons: string[], stateVersion: number): CompileProductAgentsResult {
  return {
    applicable: false,
    reasons,
    sections: [],
    unknowns: null,
    operationId: null,
    model: null,
    promptKey: PRODUCT_AGENTS_COMPILATION_PROMPT_KEY,
    promptVersion: null,
    repaired: false,
    latencyMs: 0,
    stateVersion,
  };
}

export async function compileProductAgents(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: CompileProductAgentsDeps = {},
): Promise<CompileProductAgentsResult> {
  if (userId.trim() === "")
    throw new ProductAgentsCompilerError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new ProductAgentsCompilerError("VALIDATION", "pending", "projectId is required.");
  }
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const versionBefore = await getStateVersion(db, userId, pid);
  let scope: string[] | null = null;
  try {
    scope = normalizeSectionScope(deps.onlySectionKeys);
  } catch (error) {
    if (error instanceof SpecificationValidationError) {
      throw new ProductAgentsCompilerError("VALIDATION", "pending", error.message);
    }
    throw error;
  }

  const applicability = await evaluateProductAgentsApplicability(db, userId, pid);
  if (!applicability.applicable) {
    return skipped(applicability.reasons, versionBefore);
  }

  const [allRequirements, knowledge] = await Promise.all([
    listRequirements(db, userId, pid),
    listCurrentKnowledge(db, userId, pid),
  ]);
  const live = allRequirements.filter((requirement) =>
    (LIVE_REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status),
  );

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId: pid,
        capability: PRODUCT_AGENTS_COMPILER_CAPABILITY,
        operationType: PRODUCT_AGENTS_COMPILER_OPERATION_TYPE,
        promptKey: PRODUCT_AGENTS_COMPILATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: buildTaskInput(live, knowledge, scope),
        schema: PRODUCT_AGENTS_COMPILATION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new ProductAgentsCompilerError(error.code, error.operationId, error.message);
    }
    throw error;
  }

  let validated: Awaited<ReturnType<typeof validateCompilation>>;
  try {
    assertCompilationShape(orchestrated.data);
    validated = await validateCompilation(
      db,
      userId,
      pid,
      orchestrated.data,
      orchestrated.operationId,
    );
  } catch (error) {
    if (error instanceof ProductAgentsCompilerError) throw error;
    if (error instanceof SpecificationValidationError) {
      throw new ProductAgentsCompilerError("VALIDATION", orchestrated.operationId, error.message);
    }
    throw error;
  }
  assertSectionsInScope(
    validated.sections.map((section) => section.key),
    scope,
    (message) => {
      throw new ProductAgentsCompilerError("VALIDATION", orchestrated.operationId, message);
    },
  );

  await ensureDocument(db, userId, pid, PRODUCT_AGENTS_DOCUMENT_TYPE);
  const sections: SpecificationSectionRow[] = [];
  for (const section of validated.sections) {
    // Priorities preserved by construction: structured content is rebuilt
    // from the requirements table, never trusted from model output. The
    // agent role itself is the generated content under review.
    const written = await upsertSection(db, userId, pid, PRODUCT_AGENTS_DOCUMENT_TYPE, {
      sectionKey: section.key,
      title: section.title,
      renderedContent: section.body,
      structuredContent: {
        agent: section.agent,
        requirements: section.requirements.map((requirement) => ({
          code: requirement.requirementCode,
          title: requirement.title,
          priority: requirement.priority,
          status: requirement.status,
        })),
        knowledgeKeys: section.knowledge.map((item) => item.knowledgeKey),
      },
      status: "PROPOSED",
    });
    await setSectionDependencies(db, userId, pid, PRODUCT_AGENTS_DOCUMENT_TYPE, section.key, [
      ...section.requirements.map((requirement) => ({
        sourceType: "REQUIREMENT" as const,
        sourceId: requirement.id,
      })),
      ...section.knowledge.map((item) => ({
        sourceType: "KNOWLEDGE" as const,
        sourceId: item.id,
      })),
    ]);
    sections.push(written);
  }

  let unknowns: SpecificationSectionRow | null = null;
  if (validated.unknowns.length > 0) {
    unknowns = await upsertSection(db, userId, pid, PRODUCT_AGENTS_DOCUMENT_TYPE, {
      sectionKey: PRODUCT_AGENTS_UNKNOWN_SECTION_KEY,
      title: "Open Questions",
      renderedContent: validated.unknowns
        .map((unknown) => `- **${unknown.topic}**: ${unknown.detail}`)
        .join("\n"),
      structuredContent: { unknowns: validated.unknowns },
      status: "PROPOSED",
    });
  }

  const versionAfter = await getStateVersion(db, userId, pid);
  if (versionAfter !== versionBefore) {
    throw new ProductAgentsCompilerError(
      "STATE_MUTATED",
      orchestrated.operationId,
      "Product agent compilation must not change canonical project state.",
    );
  }

  return {
    applicable: true,
    reasons: applicability.reasons,
    sections,
    unknowns,
    operationId: orchestrated.operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
    stateVersion: versionBefore,
  };
}

function assertCompilationShape(data: unknown): asserts data is ProductAgentsCompilation {
  const compilation = data as ProductAgentsCompilation;
  if (!Array.isArray(compilation.sections) || !Array.isArray(compilation.unknowns)) {
    throw new ProductAgentsCompilerError(
      "VALIDATION",
      "pending",
      "Product agents proposal must contain sections and unknowns arrays.",
    );
  }
}
