// Task Planner service (TASK-092, agents.md A-030, FR-100–104).
//
// Transforms live specifications into an executable milestone/task plan.
// Pipeline:
//
//   live requirements + decisions + arch/screens/entities
//     → one orchestrated AI call (cost-aware)
//     → batch validation (keys, refs, cycles) BEFORE any write
//     → milestone match-or-create → task persist → edge persist
//
// AI boundary (AGENT-IMPL-INV-001): the model only proposes. Every
// reference is grounded against canonical rows, cycles are rejected on
// batch-local temp keys before persistence, and unknown requirement
// codes are dropped — never invented into scope. A provider failure
// propagates with nothing written (AG-INV-006).
//
// Noise posture (same as validators/analyzer, not compilers): one bad
// task drops with a count while valid signal persists — a single noisy
// candidate must not nuke a whole plan. Dropped and inherited counts
// are reported for the plan-review workspace (TASK-095).
//
// Lifecycle ownership: created tasks are always PENDING. READY/BLOCKED
// derivation belongs to TASK-093; the model never sets status.
// Cross-run dedupe is deliberately absent: each run is a new plan batch
// for human review (TASK-095), not an idempotent sync — a retry after a
// mid-persist crash can duplicate rows, which review discards.
import type { AppDatabase } from "../../infrastructure/database/db";
import type { EnvLike } from "../../ai/providers/config";
import type { AIProvider } from "../../ai/providers/types";
import type { MemoryCache } from "../../ai/orchestration/cache";
import { globalPrompts, PromptRegistry } from "../../ai/prompts/registry";
import {
  TASK_GENERATION_PROMPT,
  TASK_GENERATION_PROMPT_KEY,
} from "../../ai/prompts/task-generation";
import {
  TASK_GENERATION_SCHEMA,
  type PlannedTask,
  type TaskGeneration,
} from "../../ai/schemas/task-generation";
import { orchestrate } from "../../ai/orchestration/orchestrator";
import { OrchestratorError } from "../../ai/orchestration/errors";
import { requireProjectScope } from "../projects/repository";
import { listRequirements } from "../requirements/requirements";
import { listDecisions } from "../decisions/decisions";
import { listComponents } from "../architecture/components";
import { listScreens } from "../architecture/screens";
import { listEntities } from "../entities/entities";
import { createMilestone, listMilestones } from "./milestones";
import { createUserTask, normalizeTaskReferences, type TaskReferencesInput } from "./user-tasks";
import { addUserTaskDependency, wouldCreateTaskCycle } from "./dependencies";
import { UserTaskValidationError } from "./errors";

export const PLANNER_CAPABILITY = "task-generation" as const;
export const PLANNER_OPERATION_TYPE = "TASK_GENERATION";

export class PlannerError extends Error {
  readonly code: string;
  readonly operationId: string;

  constructor(code: string, operationId: string, message: string) {
    super(message);
    this.name = "PlannerError";
    this.code = code;
    this.operationId = operationId;
  }
}

export interface GeneratePlanDeps {
  provider?: AIProvider;
  prompts?: PromptRegistry;
  env?: EnvLike;
  cache?: MemoryCache | null;
  promptVersion?: string;
  model?: string;
  timeoutMs?: number;
}

export interface PlannedMilestoneResult {
  milestoneCode: string;
  title: string;
  created: boolean;
}

export interface PlannedTaskResult {
  key: string;
  taskCode: string;
  title: string;
  milestoneCode: string | null;
}

export interface PlannedDependencyResult {
  from: string;
  to: string;
}

export interface PlanReport {
  milestones: PlannedMilestoneResult[];
  tasks: PlannedTaskResult[];
  dependencies: PlannedDependencyResult[];
  droppedTasks: number;
  droppedRefs: number;
  inheritedCriteria: number;
  operationId: string;
  model: string;
  promptKey: string;
  promptVersion: string;
  repaired: boolean;
  latencyMs: number;
}

// Context budget (agents.md §49): capped canonical slices with truncated
// text so input cannot grow with project history.
const MAX_REQUIREMENTS = 60;
const MAX_DECISIONS = 60;
const MAX_CATALOG_ROWS = 100;
const MAX_TEXT_CHARS = 500;
// Runaway-plan guards: bounds keep one run reviewable; excess drops with
// a count instead of failing the batch.
const MAX_MILESTONES = 12;
const MAX_TASKS = 100;

const PLANNABLE_REQUIREMENT_STATUSES = ["DRAFT", "CONFIRMED"] as const;
const PLANNABLE_PRIORITIES = ["MUST", "SHOULD", "COULD"] as const;
const LIVE_CATALOG_STATUSES = ["DRAFT", "CONFIRMED", "DEFERRED"] as const;
const TEMP_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function truncate(text: string): string {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text;
}

function ensurePrompt(registry: PromptRegistry): void {
  try {
    registry.resolve(TASK_GENERATION_PROMPT_KEY, TASK_GENERATION_PROMPT.version);
  } catch {
    try {
      registry.register({ ...TASK_GENERATION_PROMPT });
    } catch (error) {
      registry.resolve(TASK_GENERATION_PROMPT_KEY, TASK_GENERATION_PROMPT.version);
      void error;
    }
  }
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

interface ValidatedTask {
  key: string;
  title: string;
  objective: string;
  priority: "P0" | "P1" | "P2";
  requirementCodes: string[];
  dependsOn: string[];
  references: TaskReferencesInput | null;
  implementationNotes: string | null;
  acceptanceCriteria: string[];
  definitionOfDone: string[];
  inherited: boolean;
}

interface ValidationContext {
  requirementCodes: Set<string>;
  requirementCriteria: Map<string, string[]>;
  droppedRefs: { count: number };
}

function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text !== "") out.push(text);
  }
  return out;
}

// Meaning checks the schema cannot express: temp-key shape and
// uniqueness, grounded requirement refs (unknown codes drop, never
// invent scope), acyclic dependsOn, and present criteria/DoD — with
// acceptance criteria inherited from source requirements when the model
// omits them (agents.md §40: never simplify away criteria). Returns
// null for droppable tasks; the caller counts drops.
function validateTask(
  task: PlannedTask,
  keys: { all: Set<string>; claimed: Set<string> },
  acceptedEdges: { sourceCode: string; targetCode: string }[],
  ctx: ValidationContext,
): ValidatedTask | null {
  if (typeof task !== "object" || task === null || Array.isArray(task)) return null;
  const key = String(task.key ?? "")
    .trim()
    .toLowerCase();
  // Uniqueness is first-wins in batch order; membership covers forward
  // references because all keys register before any edge validates.
  if (!TEMP_KEY_PATTERN.test(key) || !keys.all.has(key) || keys.claimed.has(key)) return null;
  const title = String(task.title ?? "").trim();
  const objective = String(task.objective ?? "").trim();
  if (title === "" || objective === "") return null;
  if (task.priority !== "P0" && task.priority !== "P1" && task.priority !== "P2") return null;

  const requirementCodes: string[] = [];
  for (const raw of task.requirementCodes ?? []) {
    const code = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!ctx.requirementCodes.has(code)) {
      ctx.droppedRefs.count += 1;
      continue;
    }
    if (!requirementCodes.includes(code)) requirementCodes.push(code);
  }

  const dependsOn: string[] = [];
  for (const raw of task.dependsOn ?? []) {
    const dep = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!TEMP_KEY_PATTERN.test(dep) || dep === key || !keys.all.has(dep)) {
      ctx.droppedRefs.count += 1;
      continue;
    }
    if (dependsOn.includes(dep)) continue;
    if (wouldCreateTaskCycle(acceptedEdges, key, dep)) {
      ctx.droppedRefs.count += 1;
      continue;
    }
    dependsOn.push(dep);
    acceptedEdges.push({ sourceCode: key, targetCode: dep });
  }

  let references: TaskReferencesInput | null = null;
  try {
    references = normalizeTaskReferences({
      requirements: undefined,
      architecture: task.architectureRefs,
      entities: task.entityRefs,
      screens: task.screenRefs,
    });
  } catch {
    return null;
  }

  // Acceptance criteria are preserved, not paraphrased away: model
  // criteria win when present; otherwise inherit the referenced
  // requirements' criteria verbatim.
  let acceptanceCriteria = cleanList(task.acceptanceCriteria);
  let inherited = false;
  if (acceptanceCriteria.length === 0) {
    const inheritedCriteria: string[] = [];
    for (const code of requirementCodes) {
      inheritedCriteria.push(...(ctx.requirementCriteria.get(code) ?? []));
    }
    const seen = new Set<string>();
    acceptanceCriteria = inheritedCriteria
      .map((criterion) => criterion.trim())
      .filter((criterion) => {
        if (criterion === "" || seen.has(criterion)) return false;
        seen.add(criterion);
        return true;
      });
    inherited = acceptanceCriteria.length > 0;
  }
  const definitionOfDone = cleanList(task.definitionOfDone);
  if (acceptanceCriteria.length === 0 || definitionOfDone.length === 0) return null;

  const implementationNotes =
    task.implementationNotes === undefined ? null : String(task.implementationNotes).trim() || null;

  keys.claimed.add(key);
  return {
    key,
    title,
    objective,
    priority: task.priority,
    requirementCodes,
    dependsOn,
    references,
    implementationNotes,
    acceptanceCriteria,
    definitionOfDone,
    inherited,
  };
}

export async function generatePlan(
  db: AppDatabase,
  userId: string,
  projectId: string,
  deps: GeneratePlanDeps = {},
): Promise<PlanReport> {
  if (userId.trim() === "") throw new UserTaskValidationError("Owner is required.");
  if (projectId.trim() === "") throw new UserTaskValidationError("projectId is required.");
  const scope = await requireProjectScope(db, userId, projectId);
  const pid = scope.projectId;

  const [requirements, decisions, components, screens, entities] = await Promise.all([
    listRequirements(db, userId, pid),
    listDecisions(db, userId, pid),
    listComponents(db, userId, pid),
    listScreens(db, userId, pid),
    listEntities(db, userId, pid),
  ]);
  const plannable = requirements.filter(
    (requirement) =>
      (PLANNABLE_REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status) &&
      (PLANNABLE_PRIORITIES as readonly string[]).includes(requirement.priority),
  );
  // Refuse to plan from nothing: with no live requirements every task
  // would be invented scope. No AI call is made (cost-aware).
  if (plannable.length === 0) {
    throw new PlannerError("VALIDATION", "pending", "No live requirements to plan from.");
  }
  const taskInput = JSON.stringify({
    requirements: plannable.slice(0, MAX_REQUIREMENTS).map((requirement) => ({
      code: requirement.requirementCode,
      type: requirement.type,
      title: requirement.title,
      description: truncate(requirement.description),
      priority: requirement.priority,
      status: requirement.status,
      acceptanceCriteria: (requirement.acceptanceCriteria ?? []).slice(0, 10),
    })),
    decisions: decisions
      .filter((decision) => decision.status === "CONFIRMED" || decision.status === "RECOMMENDED")
      .slice(0, MAX_DECISIONS)
      .map((decision) => ({
        key: decision.decisionKey,
        title: decision.title,
        status: decision.status,
        value: truncate(JSON.stringify(decision.value ?? null)),
      })),
    architecture: components
      .filter((component) =>
        (LIVE_CATALOG_STATUSES as readonly string[]).includes(component.status),
      )
      .slice(0, MAX_CATALOG_ROWS)
      .map((component) => ({ code: component.componentCode, title: component.name })),
    screens: screens
      .filter((screen) => (LIVE_CATALOG_STATUSES as readonly string[]).includes(screen.status))
      .slice(0, MAX_CATALOG_ROWS)
      .map((screen) => ({ code: screen.screenCode, title: screen.name })),
    entities: entities
      .filter((entity) => (LIVE_CATALOG_STATUSES as readonly string[]).includes(entity.status))
      .slice(0, MAX_CATALOG_ROWS)
      .map((entity) => ({ code: entity.entityCode, title: entity.name })),
  });

  const prompts = deps.prompts ?? globalPrompts;
  ensurePrompt(prompts);

  let orchestrated: Awaited<ReturnType<typeof orchestrate>>;
  try {
    orchestrated = await orchestrate(
      db,
      {
        userId,
        projectId: pid,
        capability: PLANNER_CAPABILITY,
        operationType: PLANNER_OPERATION_TYPE,
        promptKey: TASK_GENERATION_PROMPT_KEY,
        promptVersion: deps.promptVersion,
        model: deps.model,
        timeoutMs: deps.timeoutMs,
        taskInput,
        schema: TASK_GENERATION_SCHEMA,
      },
      { provider: deps.provider, prompts, env: deps.env, cache: deps.cache },
    );
  } catch (error) {
    if (error instanceof OrchestratorError) {
      throw new PlannerError(error.code, error.operationId, error.message);
    }
    throw error;
  }

  const payload = orchestrated.data as TaskGeneration;
  if (!payload || !Array.isArray(payload.milestones) || payload.milestones.length === 0) {
    throw new PlannerError(
      "VALIDATION",
      orchestrated.operationId,
      "Task proposal must contain at least one milestone.",
    );
  }

  // Phase 1 — validate the whole batch before persisting anything.
  const liveCodes = new Set(
    plannable
      .slice(0, MAX_REQUIREMENTS)
      .map((requirement) => requirement.requirementCode.toUpperCase()),
  );
  const criteriaByCode = new Map(
    plannable
      .slice(0, MAX_REQUIREMENTS)
      .map((requirement) => [
        requirement.requirementCode.toUpperCase(),
        (requirement.acceptanceCriteria ?? []).filter((criterion) => criterion.trim() !== ""),
      ]),
  );
  const ctx: ValidationContext = {
    requirementCodes: liveCodes,
    requirementCriteria: criteriaByCode,
    droppedRefs: { count: 0 },
  };
  const keys = { all: new Set<string>(), claimed: new Set<string>() };
  const acceptedEdges: { sourceCode: string; targetCode: string }[] = [];
  const batches: { title: string; description: string | null; tasks: ValidatedTask[] }[] = [];
  let droppedTasks = 0;
  let inheritedCriteria = 0;
  let totalTasks = 0;
  // Slot pass: well-formed milestones in order; untitled milestones drop
  // their tasks with a count instead of scattering them.
  const slots: { title: string; description: string | null; raw: PlannedTask[] }[] = [];
  for (const milestone of payload.milestones.slice(0, MAX_MILESTONES)) {
    if (typeof milestone !== "object" || milestone === null || Array.isArray(milestone)) {
      continue;
    }
    const title = String(milestone.title ?? "").trim();
    const raw = Array.isArray(milestone.tasks) ? milestone.tasks : [];
    if (title === "") {
      droppedTasks += raw.length;
      continue;
    }
    slots.push({
      title,
      description:
        milestone.description === undefined ? null : String(milestone.description).trim() || null,
      raw,
    });
  }
  // Key registration before any edge validates, so forward references
  // (a task depending on a later task) resolve like backward ones.
  for (const slot of slots) {
    for (const task of slot.raw) {
      if (typeof task !== "object" || task === null || Array.isArray(task)) continue;
      const key = String(task.key ?? "")
        .trim()
        .toLowerCase();
      if (TEMP_KEY_PATTERN.test(key)) keys.all.add(key);
    }
  }
  for (const slot of slots) {
    const tasks: ValidatedTask[] = [];
    for (const task of slot.raw) {
      if (totalTasks >= MAX_TASKS) {
        droppedTasks += 1;
        continue;
      }
      totalTasks += 1;
      const validated = validateTask(task, keys, acceptedEdges, ctx);
      if (!validated) {
        droppedTasks += 1;
        continue;
      }
      if (validated.inherited) inheritedCriteria += 1;
      tasks.push(validated);
    }
    if (tasks.length === 0) continue;
    batches.push({ title: slot.title, description: slot.description, tasks });
  }
  if (batches.length === 0) {
    throw new PlannerError(
      "VALIDATION",
      orchestrated.operationId,
      "Task proposal contains no valid tasks.",
    );
  }

  // Phase 2 — persist: match-or-create milestones, then tasks, then edges.
  // Milestone titles match existing rows case-insensitively so reruns
  // extend the plan instead of forking milestone rows.
  const existing = await listMilestones(db, userId, pid);
  const byTitle = new Map(existing.map((row) => [normalizeTitle(row.title), row]));
  const milestoneResults: PlannedMilestoneResult[] = [];
  const milestoneIds = new Map<string, string>();
  for (const [index, batch] of batches.entries()) {
    const match = byTitle.get(normalizeTitle(batch.title));
    if (match) {
      milestoneResults.push({
        milestoneCode: match.milestoneCode,
        title: match.title,
        created: false,
      });
      milestoneIds.set(batch.title, match.id);
      continue;
    }
    const created = await createMilestone(db, userId, pid, {
      title: batch.title,
      description: batch.description,
      sortOrder: index,
    });
    byTitle.set(normalizeTitle(created.title), created);
    milestoneResults.push({
      milestoneCode: created.milestoneCode,
      title: created.title,
      created: true,
    });
    milestoneIds.set(batch.title, created.id);
  }

  const taskResults: PlannedTaskResult[] = [];
  const codeByKey = new Map<string, { code: string; milestoneCode: string | null }>();
  for (const batch of batches) {
    const milestoneId = milestoneIds.get(batch.title) ?? null;
    const milestoneCode =
      milestoneResults.find((row) => row.title === batch.title)?.milestoneCode ?? null;
    for (const [index, task] of batch.tasks.entries()) {
      // FR codes ride the loose-references column; createUserTask
      // re-validates them same-project, so unknown codes cannot slip
      // through even if grounding above missed one.
      const references: TaskReferencesInput | null =
        task.requirementCodes.length === 0 && task.references === null
          ? null
          : { ...(task.references ?? {}), requirements: task.requirementCodes };
      const created = await createUserTask(db, userId, pid, {
        title: task.title,
        objective: task.objective,
        priority: task.priority,
        milestoneId,
        implementationNotes: task.implementationNotes,
        acceptanceCriteria: task.acceptanceCriteria,
        definitionOfDone: task.definitionOfDone,
        references,
        sortOrder: index,
      });
      codeByKey.set(task.key, { code: created.taskCode, milestoneCode });
      taskResults.push({
        key: task.key,
        taskCode: created.taskCode,
        title: created.title,
        milestoneCode,
      });
    }
  }

  const dependencies: PlannedDependencyResult[] = [];
  for (const batch of batches) {
    for (const task of batch.tasks) {
      for (const dep of task.dependsOn) {
        const from = codeByKey.get(task.key);
        const to = codeByKey.get(dep);
        if (!from || !to) continue;
        // Second cycle net: addUserTaskDependency re-validates on stable
        // codes before writing the edge.
        await addUserTaskDependency(db, userId, pid, from.code, to.code);
        dependencies.push({ from: from.code, to: to.code });
      }
    }
  }

  return {
    milestones: milestoneResults,
    tasks: taskResults,
    dependencies,
    droppedTasks,
    droppedRefs: ctx.droppedRefs.count,
    inheritedCriteria,
    operationId: orchestrated.operationId,
    model: orchestrated.model,
    promptKey: orchestrated.promptKey,
    promptVersion: orchestrated.promptVersion,
    repaired: orchestrated.repaired,
    latencyMs: orchestrated.latencyMs,
  };
}
