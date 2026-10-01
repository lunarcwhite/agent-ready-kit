// Soul specification compiler (TASK-067, FR-045, agents.md A-015).
//
// Compiles confirmed project intent into PROPOSED SOUL sections — the TARGET
// product's behavioral principles and interaction character (the export
// `soul.md`), never its technical instructions. Soul is optional: projects
// without explicitly confirmed AI-behavior intent omit the file entirely
// (soul.md §80–§81: never optimize for document count; prefer explicit
// absence over invented personality).
//
// Applicability gate (acceptance criterion), enforced deterministically
// BEFORE any AI call, in two layers:
//
// 1. Product agents must be applicable (TASK-066): soul without product
//    agents is meaningless — there is no AI behavior to characterize.
// 2. At least one CURRENT AI-domain knowledge item must carry EXPLICIT
//    confidence. INFERRED intent supports technical agent roles but not
//    personality: inventing character from implication would fabricate
//    certainty (soul §6 truth over completion).
//
// Non-applicable projects return applicable:false with zero sections and
// zero provider calls.
//
// Proposal discipline for applicable projects, enforced deterministically:
//
// - Behavior, not tooling: every section must declare at least one
//   behavioral principle; the schema carries no technical fields (no
//   inputs, outputs, tools), so agents.md content cannot satisfy this
//   contract structurally. Residual semantic overlap is review-time:
//   sections stay PROPOSED until a human approves them.
// - References resolve: every requirementCodes entry must hit a live
//   requirement, every knowledgeKeys entry a non-superseded item; unknown
//   codes abort the whole batch.
// - Unknowns explicit: undecided behavioral questions land in the
//   `soul.unknowns` section instead of prose as if decided.
// - Source state version: approval snapshots via createVersion.
//
// Like the other compilers: compile (proposal-only, no canonical writes)
// then human review then createVersion. Section writes are idempotent by
// stable key.
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  SOUL_COMPILATION_PROMPT,
  SOUL_COMPILATION_PROMPT_KEY,
} from "../../ai/prompts/soul-compilation";
import { SOUL_COMPILATION_SCHEMA, type SoulCompilation } from "../../ai/schemas/soul-compilation";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { type RequirementRow } from "../requirements/requirements";
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
import { evaluateProductAgentsApplicability } from "./product-agents-compiler";

export const SOUL_COMPILER_CAPABILITY = "soul-compilation" as const;
export const SOUL_COMPILER_OPERATION_TYPE = "SOUL_COMPILATION";
export const SOUL_DOCUMENT_TYPE = "SOUL" as const;
export const SOUL_UNKNOWN_SECTION_KEY = "soul.unknowns";

export class SoulCompilerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "SoulCompilerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface CompileSoulDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
  onlySectionKeys?: string[];
}

export interface SoulApplicability {
  applicable: boolean;
  agentsApplicable: boolean;
  explicitAiKnowledgeCount: number;
  reasons: string[];
}

export interface CompileSoulResult {
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
  principles: string[];
  requirements: RequirementRow[];
  knowledge: KnowledgeItemRow[];
}

const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const LIVE_REQUIREMENT_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(SOUL_COMPILATION_PROMPT_KEY, SOUL_COMPILATION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...SOUL_COMPILATION_PROMPT });
    } catch (error) {
      registry.resolve(SOUL_COMPILATION_PROMPT_KEY, SOUL_COMPILATION_PROMPT.version);
      void error;
    }
  }
}

export async function evaluateSoulApplicability(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<SoulApplicability> {
  if (userId.trim() === "")
    throw new SoulCompilerError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new SoulCompilerError("VALIDATION", "pending", "projectId is required.");
  }
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;

  const agents = await evaluateProductAgentsApplicability(db, userId, pid);
  if (!agents.applicable) {
    return {
      applicable: false,
      agentsApplicable: false,
      explicitAiKnowledgeCount: 0,
      reasons: [
        "Soul needs product agents to characterize; product agents are not applicable.",
        ...agents.reasons,
      ],
    };
  }

  const knowledge = await listCurrentKnowledge(db, userId, pid);
  const explicit = knowledge.filter(
    (item) => item.domain === "AI" && item.confidence === "EXPLICIT",
  );
  if (explicit.length === 0) {
    return {
      applicable: false,
      agentsApplicable: true,
      explicitAiKnowledgeCount: 0,
      reasons: [
        "No EXPLICIT AI-behavior knowledge: personality cannot be grounded in implication alone.",
      ],
    };
  }
  return {
    applicable: true,
    agentsApplicable: true,
    explicitAiKnowledgeCount: explicit.length,
    reasons: [
      `${explicit.length} explicitly confirmed AI-behavior item(s) ground behavioral principles.`,
    ],
  };
}

// Capability-specific input (TASK-044 context discipline): soul derives from
// behavioral knowledge, not the full project. AI, USER, and UX domains carry
// interaction character; technical and data knowledge stays out.
function buildTaskInput(knowledge: KnowledgeItemRow[], scope: string[] | null): string {
  return JSON.stringify({
    scope,
    knowledge: knowledge
      .filter((item) => item.domain === "AI" || item.domain === "USER" || item.domain === "UX")
      .map((item) => ({
        key: item.knowledgeKey,
        domain: item.domain,
        title: item.title,
        content: item.content,
        confidence: item.confidence,
      })),
  });
}

// Full deterministic validation before any section is written:
// keys well-formed and unique, every section principled, every reference
// resolves to live canonical state, bodies non-empty. First failure aborts.
async function validateCompilation(
  db: AppDatabase,
  userId: string,
  projectId: string,
  compilation: SoulCompilation,
  operationId: string,
): Promise<{ sections: ValidatedSection[]; unknowns: { topic: string; detail: string }[] }> {
  const fail = (message: string): never => {
    throw new SoulCompilerError("VALIDATION", operationId, message);
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
    if (!Array.isArray(section.principles)) fail(`sections[${index}].principles must be an array.`);
    const principles = section.principles
      .map((principle) => String(principle ?? "").trim())
      .filter((principle) => principle !== "");
    if (principles.length === 0) {
      fail(`sections[${index}].principles needs at least 1 behavioral principle.`);
    }

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
        throw new SoulCompilerError(
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
    validated.push({ key, title, body, principles, requirements: resolved, knowledge });
  }

  const unknowns = (compilation.unknowns ?? []).map((unknown, i) => {
    const topic = String(unknown.topic ?? "").trim();
    const detail = String(unknown.detail ?? "").trim();
    if (topic === "" || detail === "") fail(`unknowns[${i}]: topic and detail are required.`);
    return { topic, detail };
  });
  return { sections: validated, unknowns };
}

function skipped(reasons: string[], stateVersion: number): CompileSoulResult {
  return {
    applicable: false,
    reasons,
    sections: [],
    unknowns: null,
    operationId: null,
    model: null,
    promptKey: SOUL_COMPILATION_PROMPT_KEY,
    promptVersion: null,
    repaired: false,
    latencyMs: 0,
    stateVersion,
  };
}

export async function compileSoul(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: CompileSoulDeps = {},
): Promise<CompileSoulResult> {
  if (userId.trim() === "")
    throw new SoulCompilerError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new SoulCompilerError("VALIDATION", "pending", "projectId is required.");
  }
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const versionBefore = await getStateVersion(db, userId, pid);
  let scope: string[] | null = null;
  try {
    scope = normalizeSectionScope(deps.onlySectionKeys);
  } catch (error) {
    if (error instanceof SpecificationValidationError) {
      throw new SoulCompilerError("VALIDATION", "pending", error.message);
    }
    throw error;
  }

  const applicability = await evaluateSoulApplicability(db, userId, pid);
  if (!applicability.applicable) {
    return skipped(applicability.reasons, versionBefore);
  }

  const knowledge = await listCurrentKnowledge(db, userId, pid);

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId: pid,
        capability: SOUL_COMPILER_CAPABILITY,
        operationType: SOUL_COMPILER_OPERATION_TYPE,
        promptKey: SOUL_COMPILATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: buildTaskInput(knowledge, scope),
        schema: SOUL_COMPILATION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new SoulCompilerError(error.code, error.operationId, error.message);
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
    if (error instanceof SoulCompilerError) throw error;
    if (error instanceof SpecificationValidationError) {
      throw new SoulCompilerError("VALIDATION", orchestrated.operationId, error.message);
    }
    throw error;
  }
  assertSectionsInScope(
    validated.sections.map((section) => section.key),
    scope,
    (message) => {
      throw new SoulCompilerError("VALIDATION", orchestrated.operationId, message);
    },
  );

  await ensureDocument(db, userId, pid, SOUL_DOCUMENT_TYPE);
  const sections: SpecificationSectionRow[] = [];
  for (const section of validated.sections) {
    const written = await upsertSection(db, userId, pid, SOUL_DOCUMENT_TYPE, {
      sectionKey: section.key,
      title: section.title,
      renderedContent: section.body,
      structuredContent: {
        principles: section.principles,
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
    await setSectionDependencies(db, userId, pid, SOUL_DOCUMENT_TYPE, section.key, [
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
    unknowns = await upsertSection(db, userId, pid, SOUL_DOCUMENT_TYPE, {
      sectionKey: SOUL_UNKNOWN_SECTION_KEY,
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
    throw new SoulCompilerError(
      "STATE_MUTATED",
      orchestrated.operationId,
      "Soul compilation must not change canonical project state.",
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

function assertCompilationShape(data: unknown): asserts data is SoulCompilation {
  const compilation = data as SoulCompilation;
  if (!Array.isArray(compilation.sections) || !Array.isArray(compilation.unknowns)) {
    throw new SoulCompilerError(
      "VALIDATION",
      "pending",
      "Soul proposal must contain sections and unknowns arrays.",
    );
  }
}
