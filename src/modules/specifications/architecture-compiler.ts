// Architecture specification compiler (TASK-063, FR-041, agents.md A-011).
//
// Compiles canonical requirements + knowledge + architecture components into
// PROPOSED ARCHITECTURE sections. Proposal discipline (acceptance criteria),
// enforced deterministically:
//
// - ARC identifiers preserved: every componentCodes entry must resolve to a
//   live component (DRAFT/CONFIRMED/DEFERRED — never SUPERSEDED or REMOVED);
//   unknown codes abort the whole batch. Codes come from TASK-059's atomic
//   per-project counter, never LLM output, never reused.
// - FR identifiers preserved: every requirementCodes entry must resolve to
//   a live requirement; unknown codes abort the whole batch.
// - Priorities preserved BY CONSTRUCTION: structuredContent.requirements is
//   rebuilt from the requirements table ({code, title, priority, status}),
//   never trusted from model prose.
// - Unknowns explicit: unresolved architecture decisions and anything the
//   canonical state does not settle lands in the `architecture.unknowns`
//   section instead of dissolving into prose as if decided.
// - No silent technology selection: the model only receives confirmed
//   requirements, current knowledge, and live components; the prompt forbids
//   choosing major technologies/providers unless a confirmed constraint names
//   them, and prose stays PROPOSED until human review approves it.
// - Source state version: approval snapshots via createVersion, which binds
//   content to the then-current project state version.
//
// Like PRD (TASK-062): compile (proposal-only, no canonical writes — spec
// rows are derived and never bump the version) then human review then
// createVersion. Section writes are idempotent by stable key, so a retry
// after a mid-write crash converges instead of duplicating.
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  ARCHITECTURE_COMPILATION_PROMPT,
  ARCHITECTURE_COMPILATION_PROMPT_KEY,
} from "../../ai/prompts/architecture-compilation";
import {
  ARCHITECTURE_COMPILATION_SCHEMA,
  type ArchitectureCompilation,
} from "../../ai/schemas/architecture-compilation";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { architectureComponents } from "../../infrastructure/database/schema/architecture";
import { getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { listRequirements, type RequirementRow } from "../requirements/requirements";
import {
  getKnowledgeByKey,
  listCurrentKnowledge,
  type KnowledgeItemRow,
} from "../knowledge/knowledge";
import { KnowledgeNotFoundError } from "../knowledge/errors";
import { listComponents, type ComponentRow } from "../architecture/components";
import { ensureDocument, upsertSection, type SpecificationSectionRow } from "./documents";
import { setSectionDependencies } from "./dependencies";
import { assertSectionsInScope, normalizeSectionScope } from "./scope";
import { SpecificationValidationError } from "./errors";

export const ARCH_COMPILER_CAPABILITY = "architecture-compilation" as const;
export const ARCH_COMPILER_OPERATION_TYPE = "ARCHITECTURE_COMPILATION";
export const ARCH_DOCUMENT_TYPE = "ARCHITECTURE" as const;
export const ARCH_UNKNOWN_SECTION_KEY = "architecture.unknowns";

export class ArchCompilerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "ArchCompilerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface CompileArchDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
  onlySectionKeys?: string[];
}

export interface CompileArchResult {
  sections: SpecificationSectionRow[];
  unknowns: SpecificationSectionRow | null;
  operationId: string;
  model: string;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
  stateVersion: number;
}

interface ValidatedSection {
  key: string;
  title: string;
  body: string;
  requirements: RequirementRow[];
  knowledge: KnowledgeItemRow[];
  components: ComponentRow[];
}

const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const LIVE_REQUIREMENT_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;
const LIVE_COMPONENT_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(ARCHITECTURE_COMPILATION_PROMPT_KEY, ARCHITECTURE_COMPILATION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...ARCHITECTURE_COMPILATION_PROMPT });
    } catch (error) {
      registry.resolve(
        ARCHITECTURE_COMPILATION_PROMPT_KEY,
        ARCHITECTURE_COMPILATION_PROMPT.version,
      );
      void error;
    }
  }
}

function buildTaskInput(
  requirements: RequirementRow[],
  knowledge: KnowledgeItemRow[],
  components: ComponentRow[],
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
    knowledge: knowledge.map((item) => ({
      key: item.knowledgeKey,
      domain: item.domain,
      title: item.title,
      content: item.content,
      confidence: item.confidence,
    })),
    components: components.map((component) => ({
      code: component.componentCode,
      name: component.name,
      description: component.description,
      status: component.status,
    })),
  });
}

// Full deterministic validation before any section is written:
// keys well-formed and unique, every reference resolves to live canonical
// state, bodies non-empty. First failure aborts the batch.
async function validateCompilation(
  db: AppDatabase,
  userId: string,
  projectId: string,
  compilation: ArchitectureCompilation,
  operationId: string,
): Promise<{ sections: ValidatedSection[]; unknowns: { topic: string; detail: string }[] }> {
  const fail = (message: string): never => {
    throw new ArchCompilerError("VALIDATION", operationId, message);
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
        throw new ArchCompilerError(
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

    const components: ComponentRow[] = [];
    for (const [i, code] of (section.componentCodes ?? []).entries()) {
      const normalized = String(code ?? "")
        .trim()
        .toUpperCase();
      const [found] = await db
        .select()
        .from(architectureComponents)
        .where(
          and(
            eq(architectureComponents.projectId, projectId),
            eq(architectureComponents.componentCode, normalized),
          ),
        )
        .limit(1);
      if (!found) fail(`sections[${index}].componentCodes[${i}]: "${code}" does not exist.`);
      if (!(LIVE_COMPONENT_STATUSES as readonly string[]).includes(found.status)) {
        fail(`sections[${index}].componentCodes[${i}]: "${code}" is not live.`);
      }
      components.push({
        id: found.id,
        projectId: found.projectId,
        componentCode: found.componentCode,
        name: found.name,
        description: found.description,
        status: found.status as ComponentRow["status"],
        metadata: (found.metadata ?? null) as ComponentRow["metadata"],
        createdAt: found.createdAt,
        updatedAt: found.updatedAt,
      });
    }

    validated.push({ key, title, body, requirements: resolved, knowledge, components });
  }

  const unknowns = (compilation.unknowns ?? []).map((unknown, i) => {
    const topic = String(unknown.topic ?? "").trim();
    const detail = String(unknown.detail ?? "").trim();
    if (topic === "" || detail === "") fail(`unknowns[${i}]: topic and detail are required.`);
    return { topic, detail };
  });
  return { sections: validated, unknowns };
}

export async function compileArchitecture(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: CompileArchDeps = {},
): Promise<CompileArchResult> {
  if (userId.trim() === "")
    throw new ArchCompilerError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new ArchCompilerError("VALIDATION", "pending", "projectId is required.");
  }
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const versionBefore = await getStateVersion(db, userId, pid);
  let scope: string[] | null = null;
  try {
    scope = normalizeSectionScope(deps.onlySectionKeys);
  } catch (error) {
    if (error instanceof SpecificationValidationError) {
      throw new ArchCompilerError("VALIDATION", "pending", error.message);
    }
    throw error;
  }

  const [allRequirements, knowledge, allComponents] = await Promise.all([
    listRequirements(db, userId, pid),
    listCurrentKnowledge(db, userId, pid),
    listComponents(db, userId, pid),
  ]);
  const live = allRequirements.filter((requirement) =>
    (LIVE_REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status),
  );
  const liveComponents = allComponents.filter((component) =>
    (LIVE_COMPONENT_STATUSES as readonly string[]).includes(component.status),
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
        capability: ARCH_COMPILER_CAPABILITY,
        operationType: ARCH_COMPILER_OPERATION_TYPE,
        promptKey: ARCHITECTURE_COMPILATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: buildTaskInput(live, knowledge, liveComponents, scope),
        schema: ARCHITECTURE_COMPILATION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new ArchCompilerError(error.code, error.operationId, error.message);
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
    if (error instanceof ArchCompilerError) throw error;
    if (error instanceof SpecificationValidationError) {
      throw new ArchCompilerError("VALIDATION", orchestrated.operationId, error.message);
    }
    throw error;
  }
  assertSectionsInScope(
    validated.sections.map((section) => section.key),
    scope,
    (message) => {
      throw new ArchCompilerError("VALIDATION", orchestrated.operationId, message);
    },
  );

  await ensureDocument(db, userId, pid, ARCH_DOCUMENT_TYPE);
  const sections: SpecificationSectionRow[] = [];
  for (const section of validated.sections) {
    // Priorities + ARC codes preserved by construction: structured content
    // is rebuilt from the tables, never trusted from model output.
    const written = await upsertSection(db, userId, pid, ARCH_DOCUMENT_TYPE, {
      sectionKey: section.key,
      title: section.title,
      renderedContent: section.body,
      structuredContent: {
        requirements: section.requirements.map((requirement) => ({
          code: requirement.requirementCode,
          title: requirement.title,
          priority: requirement.priority,
          status: requirement.status,
        })),
        knowledgeKeys: section.knowledge.map((item) => item.knowledgeKey),
        components: section.components.map((component) => ({
          code: component.componentCode,
          name: component.name,
          status: component.status,
        })),
      },
      status: "PROPOSED",
    });
    await setSectionDependencies(db, userId, pid, ARCH_DOCUMENT_TYPE, section.key, [
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
    unknowns = await upsertSection(db, userId, pid, ARCH_DOCUMENT_TYPE, {
      sectionKey: ARCH_UNKNOWN_SECTION_KEY,
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
    throw new ArchCompilerError(
      "STATE_MUTATED",
      orchestrated.operationId,
      "Architecture compilation must not change canonical project state.",
    );
  }

  return {
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

function assertCompilationShape(data: unknown): asserts data is ArchitectureCompilation {
  const compilation = data as ArchitectureCompilation;
  if (!Array.isArray(compilation.sections) || !Array.isArray(compilation.unknowns)) {
    throw new ArchCompilerError(
      "VALIDATION",
      "pending",
      "Architecture proposal must contain sections and unknowns arrays.",
    );
  }
}
