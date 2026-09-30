// Capability-specific context builder (TASK-044, agents.md §48–§49).
//
// Each AI capability declares what it needs; the builder loads exactly that
// and nothing else — unrelated history is excluded by default, which keeps
// relevance high and cost/hallucination surface low. Layers follow the
// Essential → Recommended → Optional budget: callers take essential plus
// recommended unless they opt into (or out of) a layer.
//
// Confirmed-vs-assumed distinguishability rides provenance (TASK-025):
// every decision entry carries its derived provenance, so consumers can
// tell "Confirmed by you" from "Assumed by AI" without extra lookups.
// Everything resolves inside the caller's project scope (TASK-014).
import type { AppDatabase } from "../../infrastructure/database/db";
import { getProject, requireProjectScope } from "../../modules/projects/repository";
import { listDecisions } from "../../modules/decisions/decisions";
import { listRequirements } from "../../modules/requirements/requirements";
import { withProvenance } from "../../modules/provenance/provenance";
import { listDecisionNodes } from "../../modules/discovery/discovery";
import { getDiscoveryMap } from "../../modules/discovery/discovery";
import { listDiscoveryMessages } from "../../modules/discovery/conversation";
import { DiscoveryValidationError } from "../../modules/discovery/errors";

export const CAPABILITIES = [
  "idea-analysis",
  "discovery-question",
  "answer-extraction",
  "knowledge-curation",
  "product-compilation",
  "architecture-compilation",
  "data-compilation",
  "design-compilation",
  "semantic-validation",
  "assumption-detection",
  "task-generation",
  "context-compilation",
  "instruction-compilation",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type ContextPriority = "essential" | "recommended" | "optional";

export interface ContextSection {
  name: string;
  priority: ContextPriority;
  data: unknown;
}

export interface BuiltContext {
  capability: Capability;
  projectId: string;
  stateVersion: number;
  sections: ContextSection[];
}

export interface BuildContextOptions {
  maxLayer?: ContextPriority;
  nodeKey?: string;
  sessionId?: string;
  messageLimit?: number;
}

const DECISION_LIMIT = 200;
const REQUIREMENT_LIMIT = 200;
const DEFAULT_MESSAGE_LIMIT = 20;

function requireCapability(raw: string): Capability {
  if (!(CAPABILITIES as readonly string[]).includes(raw)) {
    throw new DiscoveryValidationError(`capability must be one of ${CAPABILITIES.join(", ")}.`);
  }
  return raw as Capability;
}

function layerRank(priority: ContextPriority): number {
  return priority === "essential" ? 0 : priority === "recommended" ? 1 : 2;
}

interface Loaded {
  project: Awaited<ReturnType<typeof getProject>>;
  decisions: Awaited<ReturnType<typeof listDecisions>>;
  requirements: Awaited<ReturnType<typeof listRequirements>>;
  nodes: Awaited<ReturnType<typeof getDiscoveryMap>>;
}

function confirmedDecisions(loaded: Loaded) {
  return loaded.decisions
    .filter((decision) => decision.status === "CONFIRMED")
    .slice(0, DECISION_LIMIT)
    .map((decision) => ({
      decisionKey: decision.decisionKey,
      decisionCode: decision.decisionCode,
      title: decision.title,
      value: decision.value,
      status: decision.status,
      provenance: withProvenance({
        sourceType: decision.sourceType,
        confidence: decision.confidence,
      }).provenance,
    }));
}

function discoverySummary(loaded: Loaded) {
  return loaded.nodes.map((node) => ({
    nodeKey: node.nodeKey,
    title: node.title,
    status: node.status,
  }));
}

async function loadBase(
  db: AppDatabase,
  userId: string,
  projectId: string,
  needs: { decisions?: boolean; requirements?: boolean; nodes?: boolean },
): Promise<Loaded> {
  const scope = await requireProjectScope(db, userId, projectId);
  const [project, decisions, requirements, nodes] = await Promise.all([
    getProject(db, userId, scope.projectId),
    needs.decisions ? listDecisions(db, userId, scope.projectId) : Promise.resolve([]),
    needs.requirements ? listRequirements(db, userId, scope.projectId) : Promise.resolve([]),
    needs.nodes ? getDiscoveryMap(db, userId, scope.projectId) : Promise.resolve([]),
  ]);
  return {
    project,
    decisions: decisions.slice(0, DECISION_LIMIT),
    requirements: requirements.slice(0, REQUIREMENT_LIMIT),
    nodes,
  };
}

export async function buildContext(
  db: AppDatabase,
  userId: string,
  projectId: string,
  capabilityRaw: string,
  opts: BuildContextOptions = {},
): Promise<BuiltContext> {
  if (userId.trim() === "") throw new DiscoveryValidationError("Owner is required.");
  const capability = requireCapability(capabilityRaw);
  const maxLayer = opts.maxLayer ?? "recommended";
  const keep = (priority: ContextPriority): boolean => layerRank(priority) <= layerRank(maxLayer);

  const needsDecisions = capability !== "idea-analysis" && capability !== "context-compilation";
  const needsRequirements = [
    "knowledge-curation",
    "product-compilation",
    "architecture-compilation",
    "data-compilation",
    "design-compilation",
    "semantic-validation",
    "assumption-detection",
    "task-generation",
  ].includes(capability);
  const needsNodes = [
    "discovery-question",
    "answer-extraction",
    "knowledge-curation",
    "product-compilation",
    "design-compilation",
    "assumption-detection",
  ].includes(capability);
  const loaded = await loadBase(db, userId, projectId, {
    decisions: needsDecisions,
    requirements: needsRequirements,
    nodes: needsNodes,
  });

  const sections: ContextSection[] = [];
  const push = (name: string, priority: ContextPriority, data: unknown): void => {
    if (keep(priority)) sections.push({ name, priority, data });
  };

  const projectSummary = {
    name: loaded.project.project.name,
    idea: loaded.project.input.idea,
    targetUsers: loaded.project.input.targetUsers,
    constraints: loaded.project.input.constraints,
    lifecycleState: loaded.project.project.lifecycleState,
    discoveryLevel: loaded.project.project.discoveryLevel,
  };

  switch (capability) {
    case "idea-analysis": {
      push("projectInput", "essential", {
        idea: loaded.project.input.idea,
        targetUsers: loaded.project.input.targetUsers,
        constraints: loaded.project.input.constraints,
        references: loaded.project.input.references,
      });
      break;
    }
    case "discovery-question": {
      push("projectSummary", "essential", projectSummary);
      if (opts.nodeKey !== undefined) {
        const node = loaded.nodes.find((row) => row.nodeKey === opts.nodeKey);
        if (node) {
          push("topic", "essential", {
            nodeKey: node.nodeKey,
            title: node.title,
            description: node.description,
            status: node.status,
          });
        }
      }
      push("confirmedDecisions", "recommended", confirmedDecisions(loaded));
      break;
    }
    case "answer-extraction": {
      push("projectSummary", "essential", projectSummary);
      if (opts.nodeKey !== undefined) {
        const node = loaded.nodes.find((row) => row.nodeKey === opts.nodeKey);
        if (node) {
          push("topic", "essential", {
            nodeKey: node.nodeKey,
            title: node.title,
            status: node.status,
          });
        }
        const linked = await listDecisionNodes(
          db,
          userId,
          loaded.project.project.id,
          opts.nodeKey,
        ).catch(() => []);
        const linkedKeys = new Set(linked.map((row) => row.nodeKey));
        push(
          "relatedDecisions",
          "essential",
          loaded.decisions
            .filter((decision) => linkedKeys.has(decision.decisionKey))
            .map((decision) => ({
              decisionKey: decision.decisionKey,
              title: decision.title,
              value: decision.value,
              status: decision.status,
            })),
        );
      }
      if (opts.sessionId !== undefined) {
        const messages = await listDiscoveryMessages(
          db,
          userId,
          loaded.project.project.id,
          opts.sessionId,
        );
        const limit = opts.messageLimit ?? DEFAULT_MESSAGE_LIMIT;
        const scoped =
          opts.nodeKey === undefined
            ? messages
            : messages.filter((row) => row.metadata?.nodeKey === opts.nodeKey);
        push(
          "recentMessages",
          "essential",
          scoped.slice(-limit).map((row) => ({ role: row.role, content: row.content })),
        );
      }
      break;
    }
    case "knowledge-curation": {
      push("confirmedDecisions", "essential", confirmedDecisions(loaded));
      push("requirements", "recommended", loaded.requirements);
      push("discoverySummary", "recommended", discoverySummary(loaded));
      break;
    }
    case "product-compilation":
    case "design-compilation": {
      push("projectSummary", "essential", projectSummary);
      push("requirements", "essential", loaded.requirements);
      push("confirmedDecisions", "essential", confirmedDecisions(loaded));
      push("discoverySummary", "recommended", discoverySummary(loaded));
      break;
    }
    case "architecture-compilation":
    case "data-compilation":
    case "semantic-validation":
    case "assumption-detection":
    case "task-generation": {
      push("requirements", "essential", loaded.requirements);
      push("confirmedDecisions", "essential", confirmedDecisions(loaded));
      if (capability === "assumption-detection") {
        push("discoverySummary", "recommended", discoverySummary(loaded));
      } else {
        push("projectSummary", "recommended", projectSummary);
      }
      break;
    }
    case "context-compilation":
    case "instruction-compilation": {
      push("projectSummary", "essential", projectSummary);
      push("discoverySummary", "recommended", discoverySummary(loaded));
      break;
    }
  }

  // context-compilation never loads nodes; still report the stored level.
  if (capability === "context-compilation" && keep("recommended")) {
    sections.push({
      name: "discoveryLevel",
      priority: "recommended",
      data: loaded.project.project.discoveryLevel,
    });
  }

  return {
    capability,
    projectId: loaded.project.project.id,
    stateVersion: loaded.project.project.stateVersion,
    sections,
  };
}
