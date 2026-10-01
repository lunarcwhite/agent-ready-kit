// Context compiler (TASK-100, FR-110, agents.md A-040).
//
// Compiles approved project state into PROPOSED CONTEXT sections — the
// export `context.md`, a compact coding-agent bootstrap (agents.md §41:
// entry point, not a duplicate PRD).
//
// Fixed section vocabulary (task "Required Content" + FR-110), enforced
// deterministically:
//
// - AI-authored (grounded summaries, always all seven on a full compile):
//   context.mission, context.users, context.scope, context.capabilities,
//   context.architecture, context.stack, context.constraints.
// - Deterministic facts (never model output — the model cannot misstate
//   what the application already knows):
//   context.phase (lifecycle + discovery + task counts),
//   context.sources (static source-of-truth map).
// - context.unknowns: undecided questions from the AI proposal, written
//   only when non-empty.
//
// Proposal discipline, enforced BEFORE any section is written:
//
// - Completeness: a full compile aborts unless all seven AI sections are
//   present (required content is a contract, not a suggestion).
// - Conciseness BY CONSTRUCTION: bodies are capped at 2000 characters in
//   the schema AND re-checked here, so context.md cannot become a second
//   PRD even if the model is verbose.
// - References resolve: every requirementCodes entry must hit a live
//   requirement, every knowledgeKeys entry a non-superseded item; unknown
//   codes abort the whole batch (AC "uses current approved project
//   state", never invented links).
// - Unknowns explicit: undecided questions land in `context.unknowns`
//   instead of prose as if decided.
// - Source state version: compilation must not change canonical state
//   (version guard); section writes are derived and idempotent by key.
//
// Like the sibling compilers: compile (proposal-only) then human review
// then createVersion. Scoped recompiles via onlySectionKeys skip the
// provider entirely when no AI section is requested.
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  CONTEXT_COMPILATION_PROMPT,
  CONTEXT_COMPILATION_PROMPT_KEY,
} from "../../ai/prompts/context-compilation";
import {
  CONTEXT_COMPILATION_SCHEMA,
  MAX_CONTEXT_SECTION_BODY_LENGTH,
  type ContextCompilation,
} from "../../ai/schemas/context-compilation";
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
import { listUserTasks } from "../tasks/user-tasks";
import {
  ensureDocument,
  listSections,
  upsertSection,
  type SpecificationSectionRow,
} from "./documents";
import { setSectionDependencies } from "./dependencies";
import { assertSectionsInScope, normalizeSectionScope } from "./scope";
import { SpecificationNotFoundError, SpecificationValidationError } from "./errors";

export const CONTEXT_COMPILER_CAPABILITY = "context-compilation" as const;
export const CONTEXT_COMPILER_OPERATION_TYPE = "CONTEXT_COMPILATION";
export const CONTEXT_DOCUMENT_TYPE = "CONTEXT" as const;
export const CONTEXT_UNKNOWN_SECTION_KEY = "context.unknowns";
export const CONTEXT_PHASE_SECTION_KEY = "context.phase";
export const CONTEXT_SOURCES_SECTION_KEY = "context.sources";

// AI-authored sections: the seven grounded summaries. Titles are fixed so
// downstream renderers (TASK-102) and readers get a stable contract — the
// model writes bodies only.
export const CONTEXT_AI_SECTION_TITLES: Record<string, string> = {
  "context.mission": "Mission",
  "context.users": "Target Users",
  "context.scope": "Scope",
  "context.capabilities": "Core Capabilities",
  "context.architecture": "Architecture",
  "context.stack": "Technology Stack",
  "context.constraints": "Constraints",
};
const CONTEXT_AI_KEYS = Object.keys(CONTEXT_AI_SECTION_TITLES);

// Static source-of-truth map (FR-110 "specification locations"). A constant,
// not model output: locations do not depend on project state. Agents/soul
// are marked conditional so absent files are never implied present.
const SOURCES_BODY = [
  "- Product requirements → docs/PRD.md",
  "- Architecture → docs/architecture.md",
  "- Database schema → docs/database-schema.md",
  "- Design → docs/design.md",
  "- Product agents → docs/agents.md (when the product has AI agents)",
  "- Soul → docs/soul.md (when AI behavior is defined)",
  "- Implementation tasks → docs/tasks.md",
].join("\n");

export class ContextCompilerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "ContextCompilerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface CompileContextDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
  onlySectionKeys?: string[];
}

export interface CompileContextResult {
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
  body: string;
  requirements: RequirementRow[];
  knowledge: KnowledgeItemRow[];
}

const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const LIVE_REQUIREMENT_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;
// Token budget per approved architecture section: the summary needs shape,
// not full prose (AC "does not duplicate full PRD").
const MAX_ARCH_SECTION_CHARS = 2000;

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(CONTEXT_COMPILATION_PROMPT_KEY, CONTEXT_COMPILATION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...CONTEXT_COMPILATION_PROMPT });
    } catch (error) {
      registry.resolve(CONTEXT_COMPILATION_PROMPT_KEY, CONTEXT_COMPILATION_PROMPT.version);
      void error;
    }
  }
}

interface ContextTaskInput {
  scope: string[] | null;
  project: {
    name: string;
    idea: string;
    targetUsers: string | null;
    constraints: string | null;
    preferredStack: string | null;
    lifecycleState: string;
    discoveryLevel: string;
  };
  knowledge: {
    key: string;
    domain: string;
    title: string;
    content: unknown;
    confidence: string;
  }[];
  requirements: {
    code: string;
    type: string;
    title: string;
    priority: string;
    status: string;
  }[];
  architectureSections: { key: string; title: string; body: string }[];
  taskSummary: { total: number; byStatus: Record<string, number> };
}

// Capability-specific input (TASK-044 context discipline): the bootstrap
// distills project facts + current knowledge + live requirements +
// approved architecture shape + task counts. Full PRD prose and full
// architecture bodies stay out by construction (capped/truncated).
async function buildTaskInput(
  db: AppDatabase,
  userId: string,
  projectId: string,
  scope: string[] | null,
): Promise<string> {
  const detail = await getProject(db, userId, projectId);
  const settings = (detail.settings.settings ?? {}) as Record<string, unknown>;
  const preferredStack =
    typeof settings["preferred_stack"] === "string"
      ? (settings["preferred_stack"] as string)
      : null;

  const knowledge = await listCurrentKnowledge(db, userId, projectId);
  const allRequirements = await listRequirements(db, userId, projectId);
  const liveRequirements = allRequirements.filter((requirement) =>
    (LIVE_REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status),
  );

  let architectureSections: ContextTaskInput["architectureSections"] = [];
  try {
    const sections = await listSections(db, userId, projectId, "ARCHITECTURE");
    architectureSections = sections
      .filter((section) => section.status === "CURRENT")
      .map((section) => {
        const body = section.renderedContent;
        return {
          key: section.sectionKey,
          title: section.title,
          body:
            body.length > MAX_ARCH_SECTION_CHARS
              ? `${body.slice(0, MAX_ARCH_SECTION_CHARS)}\n[truncated for budget]`
              : body,
        };
      });
  } catch (error) {
    if (!(error instanceof SpecificationNotFoundError)) throw error;
  }

  const tasks = await listUserTasks(db, userId, projectId);
  const byStatus: Record<string, number> = {};
  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
  }

  const input: ContextTaskInput = {
    scope,
    project: {
      name: detail.project.name,
      idea: detail.input.idea,
      targetUsers: detail.input.targetUsers,
      constraints: detail.input.constraints,
      preferredStack,
      lifecycleState: detail.project.lifecycleState,
      discoveryLevel: detail.project.discoveryLevel,
    },
    knowledge: knowledge.map((item) => ({
      key: item.knowledgeKey,
      domain: item.domain,
      title: item.title,
      content: item.content,
      confidence: item.confidence,
    })),
    requirements: liveRequirements.map((requirement) => ({
      code: requirement.requirementCode,
      type: requirement.type,
      title: requirement.title,
      priority: requirement.priority,
      status: requirement.status,
    })),
    architectureSections,
    taskSummary: { total: tasks.length, byStatus },
  };
  return JSON.stringify(input);
}

// Full deterministic validation before any section is written: keys known
// and unique, bodies non-empty and within the conciseness cap, every
// reference resolves to live canonical state. First failure aborts.
async function validateCompilation(
  db: AppDatabase,
  userId: string,
  projectId: string,
  compilation: ContextCompilation,
  operationId: string,
): Promise<{ sections: ValidatedSection[]; unknowns: { topic: string; detail: string }[] }> {
  const fail = (message: string): never => {
    throw new ContextCompilerError("VALIDATION", operationId, message);
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
    if (!CONTEXT_AI_KEYS.includes(key)) {
      fail(`sections[${index}]: unknown context section "${key}".`);
    }
    if (seen.has(key)) fail(`sections[${index}]: duplicate key "${key}".`);
    seen.add(key);
    const body = String(section.body ?? "");
    if (body.trim() === "") fail(`sections[${index}]: body is required.`);
    if (body.length > MAX_CONTEXT_SECTION_BODY_LENGTH) {
      fail(
        `sections[${index}]: body exceeds ${MAX_CONTEXT_SECTION_BODY_LENGTH} characters — keep context compact.`,
      );
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
        throw new ContextCompilerError(
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
    validated.push({ key, body, requirements: resolved, knowledge });
  }

  const unknowns = (compilation.unknowns ?? []).map((unknown, i) => {
    const topic = String(unknown.topic ?? "").trim();
    const detail = String(unknown.detail ?? "").trim();
    if (topic === "" || detail === "") fail(`unknowns[${i}]: topic and detail are required.`);
    return { topic, detail };
  });
  return { sections: validated, unknowns };
}

// Deterministic phase statement: lifecycle + discovery + live task counts.
// Facts the application owns — never model prose.
function buildPhaseBody(
  lifecycleState: string,
  discoveryLevel: string,
  taskSummary: { total: number; byStatus: Record<string, number> },
): string {
  const breakdown = Object.keys(taskSummary.byStatus)
    .sort()
    .map((status) => `${taskSummary.byStatus[status]} ${status}`)
    .join(", ");
  const tasks = taskSummary.total === 0 ? "No implementation tasks yet." : `Tasks: ${breakdown}.`;
  return `Lifecycle: ${lifecycleState}. Discovery: ${discoveryLevel}. ${tasks}`;
}

export async function compileContext(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: CompileContextDeps = {},
): Promise<CompileContextResult> {
  if (userId.trim() === "")
    throw new ContextCompilerError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new ContextCompilerError("VALIDATION", "pending", "projectId is required.");
  }
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const versionBefore = await getStateVersion(db, userId, pid);
  let scope: string[] | null = null;
  try {
    scope = normalizeSectionScope(deps.onlySectionKeys);
  } catch (error) {
    if (error instanceof SpecificationValidationError) {
      throw new ContextCompilerError("VALIDATION", "pending", error.message);
    }
    throw error;
  }

  const wantsAi = scope === null || scope.some((key) => CONTEXT_AI_KEYS.includes(key));
  const wantsPhase = scope === null || scope.includes(CONTEXT_PHASE_SECTION_KEY);
  const wantsSources = scope === null || scope.includes(CONTEXT_SOURCES_SECTION_KEY);

  let validated: { sections: ValidatedSection[]; unknowns: { topic: string; detail: string }[] } = {
    sections: [],
    unknowns: [],
  };
  let orchestrated: Awaited<ReturnType<typeof orchestrate>> | null = null;
  if (wantsAi) {
    const prompts = deps.prompts ?? globalPrompts;
    ensurePrompt(prompts);
    try {
      orchestrated = await orchestrate(
        db,
        {
          userId,
          projectId: pid,
          capability: CONTEXT_COMPILER_CAPABILITY,
          operationType: CONTEXT_COMPILER_OPERATION_TYPE,
          promptKey: CONTEXT_COMPILATION_PROMPT_KEY,
          promptVersion: deps.promptVersion,
          model: deps.model,
          timeoutMs: deps.timeoutMs,
          taskInput: await buildTaskInput(db, userId, pid, scope),
          schema: CONTEXT_COMPILATION_SCHEMA,
        },
        { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
      );
    } catch (error) {
      if (error instanceof OrchestratorError) {
        throw new ContextCompilerError(error.code, error.operationId, error.message);
      }
      throw error;
    }

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
      if (error instanceof ContextCompilerError) throw error;
      if (error instanceof SpecificationValidationError) {
        throw new ContextCompilerError("VALIDATION", orchestrated.operationId, error.message);
      }
      throw error;
    }
    // Straight-line narrowing holds here (the catch above always throws),
    // but closures below reset it — capture once.
    const operationId: string = orchestrated.operationId;
    assertSectionsInScope(
      validated.sections.map((section) => section.key),
      scope,
      (message) => {
        throw new ContextCompilerError("VALIDATION", operationId, message);
      },
    );
    if (scope === null) {
      const missing = CONTEXT_AI_KEYS.filter(
        (key) => !validated.sections.some((section) => section.key === key),
      );
      if (missing.length > 0) {
        throw new ContextCompilerError(
          "VALIDATION",
          operationId,
          `Full context compile is missing required sections: ${missing.join(", ")}.`,
        );
      }
    }
  }

  await ensureDocument(db, userId, pid, CONTEXT_DOCUMENT_TYPE);
  const sections: SpecificationSectionRow[] = [];
  for (const section of validated.sections) {
    const written = await upsertSection(db, userId, pid, CONTEXT_DOCUMENT_TYPE, {
      sectionKey: section.key,
      title: CONTEXT_AI_SECTION_TITLES[section.key] ?? section.key,
      renderedContent: section.body,
      structuredContent: {
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
    await setSectionDependencies(db, userId, pid, CONTEXT_DOCUMENT_TYPE, section.key, [
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

  // Deterministic sections carry no canonical deps: lifecycle/discovery and
  // the doc map are project-level facts, not DECISION/KNOWLEDGE/
  // REQUIREMENT/ENTITY rows. Empty dep sets keep the hash contract exact.
  if (wantsPhase) {
    const tasks = await listUserTasks(db, userId, pid);
    const byStatus: Record<string, number> = {};
    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    }
    const phase = await upsertSection(db, userId, pid, CONTEXT_DOCUMENT_TYPE, {
      sectionKey: CONTEXT_PHASE_SECTION_KEY,
      title: "Project Phase",
      renderedContent: buildPhaseBody(
        detail.project.lifecycleState,
        detail.project.discoveryLevel,
        {
          total: tasks.length,
          byStatus,
        },
      ),
      status: "PROPOSED",
    });
    await setSectionDependencies(
      db,
      userId,
      pid,
      CONTEXT_DOCUMENT_TYPE,
      CONTEXT_PHASE_SECTION_KEY,
      [],
    );
    sections.push(phase);
  }
  if (wantsSources) {
    const sources = await upsertSection(db, userId, pid, CONTEXT_DOCUMENT_TYPE, {
      sectionKey: CONTEXT_SOURCES_SECTION_KEY,
      title: "Sources of Truth",
      renderedContent: SOURCES_BODY,
      status: "PROPOSED",
    });
    await setSectionDependencies(
      db,
      userId,
      pid,
      CONTEXT_DOCUMENT_TYPE,
      CONTEXT_SOURCES_SECTION_KEY,
      [],
    );
    sections.push(sources);
  }

  let unknowns: SpecificationSectionRow | null = null;
  if (validated.unknowns.length > 0) {
    unknowns = await upsertSection(db, userId, pid, CONTEXT_DOCUMENT_TYPE, {
      sectionKey: CONTEXT_UNKNOWN_SECTION_KEY,
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
    throw new ContextCompilerError(
      "STATE_MUTATED",
      orchestrated?.operationId ?? "pending",
      "Context compilation must not change canonical project state.",
    );
  }

  return {
    sections,
    unknowns,
    operationId: orchestrated?.operationId ?? null,
    model: orchestrated?.model ?? null,
    promptKey: CONTEXT_COMPILATION_PROMPT_KEY,
    promptVersion: orchestrated?.promptVersion ?? null,
    repaired: orchestrated?.repaired ?? false,
    latencyMs: orchestrated?.latencyMs ?? 0,
    stateVersion: versionBefore,
  };
}

function assertCompilationShape(data: unknown): asserts data is ContextCompilation {
  const compilation = data as ContextCompilation;
  if (!Array.isArray(compilation.sections) || !Array.isArray(compilation.unknowns)) {
    throw new ContextCompilerError(
      "VALIDATION",
      "pending",
      "Context proposal must contain sections and unknowns arrays.",
    );
  }
}
