// Coding-agent instruction compiler (TASK-101, FR-111, agents.md A-041).
//
// Compiles approved project state into PROPOSED AGENT_INSTRUCTIONS sections
// — the export root `AGENTS.md`: how the EXTERNAL coding agent works on
// this project. Distinct from docs/agents.md (the target product's own AI,
// written via PRODUCT_AGENTS/SOUL): this document never describes product
// agents, roles, or personalities — the prompt boundary plus PROPOSED
// status plus human review enforce that split.
//
// Fixed section vocabulary (task "Required Sections" + FR-111), all eight
// required on a full compile:
//
// - agents.orientation, agents.reading_order, agents.sources,
//   agents.workflow, agents.boundaries, agents.requirement_changes,
//   agents.testing, agents.completion.
// - agents.unknowns: undecided workflow questions, written only when
//   non-empty.
//
// Proposal discipline, enforced BEFORE any section is written:
//
// - Completeness: a full compile aborts unless all eight sections are
//   present (required sections are a contract, not a suggestion).
// - Spec locations KNOWN (AC, full compiles): the proposal text must name the core
//   specification paths (docs/PRD.md, docs/architecture.md,
//   docs/database-schema.md, docs/design.md, docs/tasks.md) — an
//   instruction set that never points at authoritative specs fails the
//   batch instead of shipping vague directions.
// - Workflow EXPLICIT (AC): the workflow section must reference the task
//   system (UTASK codes or tasks.md) — a workflow that never names how
//   tasks are identified is not a workflow.
// - References resolve: every requirementCodes entry must hit a live
//   requirement, every knowledgeKeys entry a non-superseded item; unknown
//   codes abort the whole batch.
// - Unknowns explicit: undecided questions land in `agents.unknowns`
//   instead of prose as if decided.
// - Source state version: compilation must not change canonical state
//   (version guard); section writes are derived and idempotent by key.
//
// Like the sibling compilers: compile (proposal-only) then human review
// then createVersion.
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  AGENT_INSTRUCTIONS_COMPILATION_PROMPT,
  AGENT_INSTRUCTIONS_COMPILATION_PROMPT_KEY,
} from "../../ai/prompts/agent-instructions-compilation";
import {
  AGENT_INSTRUCTIONS_COMPILATION_SCHEMA,
  MAX_AGENT_INSTRUCTIONS_SECTION_BODY_LENGTH,
  type AgentInstructionsCompilation,
} from "../../ai/schemas/agent-instructions-compilation";
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
import { listMilestones } from "../tasks/milestones";
import { listUserTasks, USER_TASK_STATUSES } from "../tasks/user-tasks";
import {
  ensureDocument,
  listSections,
  upsertSection,
  type SpecificationSectionRow,
} from "./documents";
import { setSectionDependencies } from "./dependencies";
import { assertSectionsInScope, normalizeSectionScope } from "./scope";
import { SpecificationNotFoundError, SpecificationValidationError } from "./errors";

export const AGENT_INSTRUCTIONS_COMPILER_CAPABILITY = "instruction-compilation" as const;
export const AGENT_INSTRUCTIONS_COMPILER_OPERATION_TYPE = "INSTRUCTION_COMPILATION";
export const AGENT_INSTRUCTIONS_DOCUMENT_TYPE = "AGENT_INSTRUCTIONS" as const;
export const AGENT_INSTRUCTIONS_UNKNOWN_SECTION_KEY = "agents.unknowns";
export const AGENT_INSTRUCTIONS_WORKFLOW_SECTION_KEY = "agents.workflow";

// Titles are fixed so downstream renderers (TASK-102) and readers get a
// stable contract — the model writes bodies only.
export const AGENT_INSTRUCTIONS_SECTION_TITLES: Record<string, string> = {
  "agents.orientation": "Project Orientation",
  "agents.reading_order": "Reading Order",
  "agents.sources": "Sources of Truth",
  "agents.workflow": "Task Workflow",
  "agents.boundaries": "Architecture Boundaries",
  "agents.requirement_changes": "Requirement Changes",
  "agents.testing": "Testing Expectations",
  "agents.completion": "Completion Rules",
};
const AGENT_INSTRUCTIONS_KEYS = Object.keys(AGENT_INSTRUCTIONS_SECTION_TITLES);

// AC "coding agent knows where authoritative specs live", enforced
// deterministically: these paths must appear somewhere in the proposal.
const REQUIRED_SPEC_PATHS = [
  "docs/PRD.md",
  "docs/architecture.md",
  "docs/database-schema.md",
  "docs/design.md",
  "docs/tasks.md",
] as const;

export class AgentInstructionsCompilerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "AgentInstructionsCompilerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface CompileAgentInstructionsDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
  onlySectionKeys?: string[];
}

export interface CompileAgentInstructionsResult {
  sections: SpecificationSectionRow[];
  unknowns: SpecificationSectionRow | null;
  operationId: string;
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
// Token budget per approved architecture section: boundaries need shape,
// not full prose.
const MAX_ARCH_SECTION_CHARS = 2000;

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(
      AGENT_INSTRUCTIONS_COMPILATION_PROMPT_KEY,
      AGENT_INSTRUCTIONS_COMPILATION_PROMPT.version,
    );
  } catch {
    try {
      registry.register({ ...AGENT_INSTRUCTIONS_COMPILATION_PROMPT });
    } catch (error) {
      registry.resolve(
        AGENT_INSTRUCTIONS_COMPILATION_PROMPT_KEY,
        AGENT_INSTRUCTIONS_COMPILATION_PROMPT.version,
      );
      void error;
    }
  }
}

interface AgentInstructionsTaskInput {
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
  tasks: {
    summary: { total: number; byStatus: Record<string, number> };
    statuses: readonly string[];
    milestones: { code: string; title: string; status: string }[];
  };
}

// Capability-specific input (TASK-044 context discipline): project facts,
// current knowledge, live requirements, approved architecture shape, and
// the live task system (UTASK counts, status vocabulary, milestones) the
// workflow section must describe. Full prose stays out by construction.
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

  let architectureSections: AgentInstructionsTaskInput["architectureSections"] = [];
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
  const milestones = await listMilestones(db, userId, projectId);

  const input: AgentInstructionsTaskInput = {
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
    tasks: {
      summary: { total: tasks.length, byStatus },
      statuses: USER_TASK_STATUSES,
      milestones: milestones.map((milestone) => ({
        code: milestone.milestoneCode,
        title: milestone.title,
        status: milestone.status,
      })),
    },
  };
  return JSON.stringify(input);
}

// Full deterministic validation before any section is written: keys known
// and unique, bodies non-empty and within cap, spec paths named, workflow
// explicit, every reference resolves to live canonical state. First
// failure aborts.
async function validateCompilation(
  db: AppDatabase,
  userId: string,
  projectId: string,
  compilation: AgentInstructionsCompilation,
  operationId: string,
  scope: string[] | null,
): Promise<{ sections: ValidatedSection[]; unknowns: { topic: string; detail: string }[] }> {
  const fail = (message: string): never => {
    throw new AgentInstructionsCompilerError("VALIDATION", operationId, message);
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
    if (!AGENT_INSTRUCTIONS_KEYS.includes(key)) {
      fail(`sections[${index}]: unknown agents section "${key}".`);
    }
    if (seen.has(key)) fail(`sections[${index}]: duplicate key "${key}".`);
    seen.add(key);
    const body = String(section.body ?? "");
    if (body.trim() === "") fail(`sections[${index}]: body is required.`);
    if (body.length > MAX_AGENT_INSTRUCTIONS_SECTION_BODY_LENGTH) {
      fail(
        `sections[${index}]: body exceeds ${MAX_AGENT_INSTRUCTIONS_SECTION_BODY_LENGTH} characters.`,
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
        throw new AgentInstructionsCompilerError(
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

  // AC "knows where authoritative specs live", enforced deterministically
  // on FULL compiles only: a scoped single-section recompile cannot name
  // every path. An instruction set that never points at authoritative
  // specs fails the batch instead of shipping vague directions.
  if (scope === null) {
    const proposalText = [
      ...validated.map((section) => section.body),
      ...(compilation.unknowns ?? []).map((unknown) => String(unknown.detail ?? "")),
    ].join("\n");
    const missingPaths = REQUIRED_SPEC_PATHS.filter((path) => !proposalText.includes(path));
    if (missingPaths.length > 0) {
      fail(`Proposal must name authoritative spec locations: missing ${missingPaths.join(", ")}.`);
    }
  }

  // AC "active task workflow is explicit": the workflow section must name
  // the task system it describes.
  const workflow = validated.find(
    (section) => section.key === AGENT_INSTRUCTIONS_WORKFLOW_SECTION_KEY,
  );
  if (workflow !== undefined && !/UTASK|tasks\.md/.test(workflow.body)) {
    fail("agents.workflow must reference the task system (UTASK codes or tasks.md).");
  }

  const unknowns = (compilation.unknowns ?? []).map((unknown, i) => {
    const topic = String(unknown.topic ?? "").trim();
    const detail = String(unknown.detail ?? "").trim();
    if (topic === "" || detail === "") fail(`unknowns[${i}]: topic and detail are required.`);
    return { topic, detail };
  });
  return { sections: validated, unknowns };
}

export async function compileAgentInstructions(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: CompileAgentInstructionsDeps = {},
): Promise<CompileAgentInstructionsResult> {
  if (userId.trim() === "")
    throw new AgentInstructionsCompilerError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new AgentInstructionsCompilerError("VALIDATION", "pending", "projectId is required.");
  }
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const versionBefore = await getStateVersion(db, userId, pid);
  let scope: string[] | null = null;
  try {
    scope = normalizeSectionScope(deps.onlySectionKeys);
  } catch (error) {
    if (error instanceof SpecificationValidationError) {
      throw new AgentInstructionsCompilerError("VALIDATION", "pending", error.message);
    }
    throw error;
  }

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId: pid,
        capability: AGENT_INSTRUCTIONS_COMPILER_CAPABILITY,
        operationType: AGENT_INSTRUCTIONS_COMPILER_OPERATION_TYPE,
        promptKey: AGENT_INSTRUCTIONS_COMPILATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: await buildTaskInput(db, userId, pid, scope),
        schema: AGENT_INSTRUCTIONS_COMPILATION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new AgentInstructionsCompilerError(error.code, error.operationId, error.message);
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
      scope,
    );
  } catch (error) {
    if (error instanceof AgentInstructionsCompilerError) throw error;
    if (error instanceof SpecificationValidationError) {
      throw new AgentInstructionsCompilerError(
        "VALIDATION",
        orchestrated.operationId,
        error.message,
      );
    }
    throw error;
  }
  // Capture for the closure: narrowing resets inside callbacks.
  const operationId: string = orchestrated.operationId;
  assertSectionsInScope(
    validated.sections.map((section) => section.key),
    scope,
    (message) => {
      throw new AgentInstructionsCompilerError("VALIDATION", operationId, message);
    },
  );
  if (scope === null) {
    const missing = AGENT_INSTRUCTIONS_KEYS.filter(
      (key) => !validated.sections.some((section) => section.key === key),
    );
    if (missing.length > 0) {
      throw new AgentInstructionsCompilerError(
        "VALIDATION",
        operationId,
        `Full agents compile is missing required sections: ${missing.join(", ")}.`,
      );
    }
  }

  await ensureDocument(db, userId, pid, AGENT_INSTRUCTIONS_DOCUMENT_TYPE);
  const sections: SpecificationSectionRow[] = [];
  for (const section of validated.sections) {
    const written = await upsertSection(db, userId, pid, AGENT_INSTRUCTIONS_DOCUMENT_TYPE, {
      sectionKey: section.key,
      title: AGENT_INSTRUCTIONS_SECTION_TITLES[section.key] ?? section.key,
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
    await setSectionDependencies(db, userId, pid, AGENT_INSTRUCTIONS_DOCUMENT_TYPE, section.key, [
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
    unknowns = await upsertSection(db, userId, pid, AGENT_INSTRUCTIONS_DOCUMENT_TYPE, {
      sectionKey: AGENT_INSTRUCTIONS_UNKNOWN_SECTION_KEY,
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
    throw new AgentInstructionsCompilerError(
      "STATE_MUTATED",
      operationId,
      "Agent-instructions compilation must not change canonical project state.",
    );
  }

  return {
    sections,
    unknowns,
    operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
    stateVersion: versionBefore,
  };
}

function assertCompilationShape(data: unknown): asserts data is AgentInstructionsCompilation {
  const compilation = data as AgentInstructionsCompilation;
  if (!Array.isArray(compilation.sections) || !Array.isArray(compilation.unknowns)) {
    throw new AgentInstructionsCompilerError(
      "VALIDATION",
      "pending",
      "Agents proposal must contain sections and unknowns arrays.",
    );
  }
}
