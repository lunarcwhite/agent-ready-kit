// Design specification compiler (TASK-065, FR-043, agents.md A-013).
//
// Compiles canonical requirements + knowledge + screens into PROPOSED DESIGN
// sections. Proposal discipline (acceptance criteria), enforced
// deterministically:
//
// - SCREEN identifiers preserved: every screenCodes entry must resolve to a
//   live screen (DRAFT/CONFIRMED/DEFERRED — never SUPERSEDED or REMOVED);
//   unknown codes abort the whole batch. Codes come from TASK-059's atomic
//   per-project counter, never LLM output, never reused.
// - FR identifiers preserved: every requirementCodes entry must resolve to
//   a live requirement; unknown codes abort the whole batch.
// - Priorities preserved BY CONSTRUCTION: structuredContent.requirements is
//   rebuilt from the requirements table ({code, title, priority, status}),
//   never trusted from model prose. Screens likewise rebuilt from the table.
// - Unknowns explicit: unresolved design questions and anything the
//   canonical state does not settle lands in the `design.unknowns` section
//   instead of dissolving into prose as if decided.
// - No invented behavior: the model only receives confirmed requirements,
//   current knowledge, and live screens; the prompt forbids inventing
//   product behavior, workflows, or screens, and prose stays PROPOSED until
//   human review approves it.
// - Source state version: approval snapshots via createVersion, which binds
//   content to the then-current project state version.
//
// Like PRD (TASK-062) / ARCH (TASK-063) / DATA (TASK-064): compile
// (proposal-only, no canonical writes — spec rows are derived and never
// bump the version) then human review then createVersion. Section writes are
// idempotent by stable key, so a retry after a mid-write crash converges
// instead of duplicating.
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  DESIGN_COMPILATION_PROMPT,
  DESIGN_COMPILATION_PROMPT_KEY,
} from "../../ai/prompts/design-compilation";
import {
  DESIGN_COMPILATION_SCHEMA,
  type DesignCompilation,
} from "../../ai/schemas/design-compilation";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { requirements } from "../../infrastructure/database/schema/requirements";
import { screens } from "../../infrastructure/database/schema/architecture";
import { getProject } from "../projects/repository";
import { getStateVersion } from "../projects/state-version";
import { listRequirements, type RequirementRow } from "../requirements/requirements";
import {
  getKnowledgeByKey,
  listCurrentKnowledge,
  type KnowledgeItemRow,
} from "../knowledge/knowledge";
import { KnowledgeNotFoundError } from "../knowledge/errors";
import { listScreens, type ScreenRow } from "../architecture/screens";
import { ensureDocument, upsertSection, type SpecificationSectionRow } from "./documents";
import { setSectionDependencies } from "./dependencies";
import { SpecificationValidationError } from "./errors";

export const DESIGN_COMPILER_CAPABILITY = "design-compilation" as const;
export const DESIGN_COMPILER_OPERATION_TYPE = "DESIGN_COMPILATION";
export const DESIGN_DOCUMENT_TYPE = "DESIGN" as const;
export const DESIGN_UNKNOWN_SECTION_KEY = "design.unknowns";

export class DesignCompilerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "DesignCompilerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface CompileDesignDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
}

export interface CompileDesignResult {
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
  screens: ScreenRow[];
}

const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const LIVE_REQUIREMENT_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;
const LIVE_SCREEN_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(DESIGN_COMPILATION_PROMPT_KEY, DESIGN_COMPILATION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...DESIGN_COMPILATION_PROMPT });
    } catch (error) {
      registry.resolve(DESIGN_COMPILATION_PROMPT_KEY, DESIGN_COMPILATION_PROMPT.version);
      void error;
    }
  }
}

function buildTaskInput(
  requirements: RequirementRow[],
  knowledge: KnowledgeItemRow[],
  screens: ScreenRow[],
): string {
  return JSON.stringify({
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
    screens: screens.map((screen) => ({
      code: screen.screenCode,
      name: screen.name,
      description: screen.description,
      routeHint: screen.routeHint,
      status: screen.status,
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
  compilation: DesignCompilation,
  operationId: string,
): Promise<{ sections: ValidatedSection[]; unknowns: { topic: string; detail: string }[] }> {
  const fail = (message: string): never => {
    throw new DesignCompilerError("VALIDATION", operationId, message);
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
        throw new DesignCompilerError(
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

    const referencedScreens: ScreenRow[] = [];
    for (const [i, code] of (section.screenCodes ?? []).entries()) {
      const normalized = String(code ?? "")
        .trim()
        .toUpperCase();
      const [found] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.projectId, projectId), eq(screens.screenCode, normalized)))
        .limit(1);
      if (!found) fail(`sections[${index}].screenCodes[${i}]: "${code}" does not exist.`);
      if (!(LIVE_SCREEN_STATUSES as readonly string[]).includes(found.status)) {
        fail(`sections[${index}].screenCodes[${i}]: "${code}" is not live.`);
      }
      referencedScreens.push({
        id: found.id,
        projectId: found.projectId,
        screenCode: found.screenCode,
        name: found.name,
        description: found.description,
        routeHint: found.routeHint,
        status: found.status as ScreenRow["status"],
        metadata: (found.metadata ?? null) as ScreenRow["metadata"],
        createdAt: found.createdAt,
        updatedAt: found.updatedAt,
      });
    }

    validated.push({
      key,
      title,
      body,
      requirements: resolved,
      knowledge,
      screens: referencedScreens,
    });
  }

  const unknowns = (compilation.unknowns ?? []).map((unknown, i) => {
    const topic = String(unknown.topic ?? "").trim();
    const detail = String(unknown.detail ?? "").trim();
    if (topic === "" || detail === "") fail(`unknowns[${i}]: topic and detail are required.`);
    return { topic, detail };
  });
  return { sections: validated, unknowns };
}

export async function compileDesign(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: CompileDesignDeps = {},
): Promise<CompileDesignResult> {
  if (userId.trim() === "")
    throw new DesignCompilerError("VALIDATION", "pending", "Owner is required.");
  if (projectId.trim() === "") {
    throw new DesignCompilerError("VALIDATION", "pending", "projectId is required.");
  }
  const detail = await getProject(db, userId, projectId);
  const pid = detail.project.id;
  const versionBefore = await getStateVersion(db, userId, pid);

  const [allRequirements, knowledge, allScreens] = await Promise.all([
    listRequirements(db, userId, pid),
    listCurrentKnowledge(db, userId, pid),
    listScreens(db, userId, pid),
  ]);
  const live = allRequirements.filter((requirement) =>
    (LIVE_REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status),
  );
  const liveScreens = allScreens.filter((screen) =>
    (LIVE_SCREEN_STATUSES as readonly string[]).includes(screen.status),
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
        capability: DESIGN_COMPILER_CAPABILITY,
        operationType: DESIGN_COMPILER_OPERATION_TYPE,
        promptKey: DESIGN_COMPILATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput: buildTaskInput(live, knowledge, liveScreens),
        schema: DESIGN_COMPILATION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new DesignCompilerError(error.code, error.operationId, error.message);
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
    if (error instanceof DesignCompilerError) throw error;
    if (error instanceof SpecificationValidationError) {
      throw new DesignCompilerError("VALIDATION", orchestrated.operationId, error.message);
    }
    throw error;
  }

  await ensureDocument(db, userId, pid, DESIGN_DOCUMENT_TYPE);
  const sections: SpecificationSectionRow[] = [];
  for (const section of validated.sections) {
    // Priorities + SCREEN codes preserved by construction: structured content
    // is rebuilt from the tables, never trusted from model output.
    const written = await upsertSection(db, userId, pid, DESIGN_DOCUMENT_TYPE, {
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
        screens: section.screens.map((screen) => ({
          code: screen.screenCode,
          name: screen.name,
          status: screen.status,
        })),
      },
      status: "PROPOSED",
    });
    await setSectionDependencies(db, userId, pid, DESIGN_DOCUMENT_TYPE, section.key, [
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
    unknowns = await upsertSection(db, userId, pid, DESIGN_DOCUMENT_TYPE, {
      sectionKey: DESIGN_UNKNOWN_SECTION_KEY,
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
    throw new DesignCompilerError(
      "STATE_MUTATED",
      orchestrated.operationId,
      "Design compilation must not change canonical project state.",
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

function assertCompilationShape(data: unknown): asserts data is DesignCompilation {
  const compilation = data as DesignCompilation;
  if (!Array.isArray(compilation.sections) || !Array.isArray(compilation.unknowns)) {
    throw new DesignCompilerError(
      "VALIDATION",
      "pending",
      "Design proposal must contain sections and unknowns arrays.",
    );
  }
}
