// Project persistence (TASK-011) + centralized authorization (TASK-014).
//
// Every query carries (id, user_id) plus deleted_at IS NULL: cross-user
// access fails at the WHERE clause, not in a later check, so forgetting a
// caller-side comparison is harmless. The ownership RULE itself lives in
// authorization.ts — getProject asserts it on every loaded row as a backstop.
// Update/delete go through getProject first and refuse to touch lifecycle_state, discovery_level,
// readiness_score, state_version, user_id — those columns belong to
// TASK-020 / readiness, never to a generic update.
//
// createProject is intentionally NOT transactional: TASK-005's job runner is
// synchronous and the initial insert has no companion write worth rolling
// back with it (transaction boundaries: AGENTS.md §51). updateProject below
// IS transactional — its version bump (TASK-020) must commit with the data.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AppDatabase } from "../../infrastructure/database/db";
import { projectInputs, projects, projectSettings } from "../../infrastructure/database/schema";
import { assertProjectOwnership } from "./authorization";
import { ProjectNotFoundError, ProjectValidationError } from "./errors";
import { deriveSlug } from "./slugs";
import { incrementStateVersion } from "./state-version";

export const MAX_NAME_LENGTH = 255;
const MAX_IDEA_LENGTH = 20000;
const MAX_OPTIONAL_TEXT_LENGTH = 20000;
export const SUPPORTED_LANGUAGES = ["en", "id"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

export type ProjectLifecycleState = "DISCOVERY" | "DRAFT" | "NEEDS_REVIEW" | "IMPLEMENTATION_READY";
export type ProjectDiscoveryLevel = "INITIAL" | "QUICK_DRAFT" | "DETAILED" | "AGENT_READY";

export interface ProjectRow {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  lifecycleState: ProjectLifecycleState;
  discoveryLevel: ProjectDiscoveryLevel;
  readinessScore: number;
  stateVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archivedAt: Date | null;
}

export interface ProjectInputRow {
  id: string;
  projectId: string;
  idea: string;
  targetUsers: string | null;
  constraints: string | null;
  references: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSettingsRow {
  id: string;
  projectId: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  name: string;
  idea: string;
  description?: string | null;
  targetUsers?: string | null;
  constraints?: string | null;
  references?: unknown;
  preferredStack?: string | null;
  preferredLanguage?: string | null;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requireNonEmpty(value: string, field: "name" | "idea", maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new ProjectValidationError(`${field} is required.`);
  if (trimmed.length > maxLength) {
    throw new ProjectValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function optionalText(value: string | null | undefined, field: string): string | null {
  const trimmed = trimOrNull(value);
  if (trimmed !== null && trimmed.length > MAX_OPTIONAL_TEXT_LENGTH) {
    throw new ProjectValidationError(
      `${field} must be at most ${MAX_OPTIONAL_TEXT_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

// references is jsonb: array-of-strings, one string, or null. Objects are
// rejected — callers pass URL lists, not documents (D-C06: no structured doc
// ingestion in MVP). undefined means "not provided" for partial updates.
function normalizeReferences(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : [trimmed];
  }
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "string" && item.trim() !== "")) {
      throw new ProjectValidationError(
        "references must be a string or an array of non-empty strings.",
      );
    }
    return value.map((item) => (item as string).trim());
  }
  throw new ProjectValidationError("references must be a string or an array of non-empty strings.");
}

function normalizePreferredLanguage(value: string | null | undefined): SupportedLanguage {
  const trimmed = trimOrNull(value);
  if (trimmed === null) return DEFAULT_LANGUAGE;
  const lowered = trimmed.toLowerCase();
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(lowered)) {
    throw new ProjectValidationError(
      `preferred_language must be one of ${SUPPORTED_LANGUAGES.join(", ")}.`,
    );
  }
  return lowered as SupportedLanguage;
}

function buildSettings(preferredStack: string | null, preferredLanguage: SupportedLanguage) {
  return { preferred_stack: preferredStack, preferred_language: preferredLanguage };
}

export interface CreateProjectResult {
  project: ProjectRow;
  input: ProjectInputRow;
  settings: ProjectSettingsRow;
}

export type ProjectDetail = CreateProjectResult;

export async function createProject(
  db: AppDatabase,
  userId: string,
  raw: CreateProjectInput,
): Promise<CreateProjectResult> {
  if (userId.trim() === "") throw new ProjectValidationError("Owner is required.");
  const name = requireNonEmpty(raw.name, "name", MAX_NAME_LENGTH);
  const idea = requireNonEmpty(raw.idea, "idea", MAX_IDEA_LENGTH);
  const description = optionalText(raw.description, "description");
  const targetUsers = optionalText(raw.targetUsers, "target_users");
  const constraints = optionalText(raw.constraints, "constraints");
  const references = normalizeReferences(raw.references) ?? null;
  const preferredStack = trimOrNull(raw.preferredStack);
  const preferredLanguage = normalizePreferredLanguage(raw.preferredLanguage);

  const [project] = await db
    .insert(projects)
    .values({ userId, name, slug: deriveSlug(name), description })
    .returning();
  if (!project) throw new ProjectNotFoundError("Project creation failed.");
  const [input] = await db
    .insert(projectInputs)
    .values({ projectId: project.id, idea, targetUsers, constraints, references })
    .returning();
  if (!input) throw new ProjectNotFoundError("Project creation failed.");
  const [settings] = await db
    .insert(projectSettings)
    .values({ projectId: project.id, settings: buildSettings(preferredStack, preferredLanguage) })
    .returning();
  if (!settings) throw new ProjectNotFoundError("Project creation failed.");
  return {
    project: project as ProjectRow,
    input: input as unknown as ProjectInputRow,
    settings: settings as unknown as ProjectSettingsRow,
  };
}

function toDetail(
  project: ProjectRow,
  input: ProjectInputRow | null,
  settings: ProjectSettingsRow | null,
): ProjectDetail {
  // input/settings rows are written by createProject and have no delete path
  // in TASK-011 — their absence means the project predates the aggregate or
  // suffered a partial legacy write, not "no idea yet".
  if (!input || !settings) throw new ProjectNotFoundError("Project is missing its initial input.");
  return { project, input, settings };
}

export async function getProject(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<ProjectDetail> {
  const project = (await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)),
  })) as ProjectRow | undefined;
  if (!project) throw new ProjectNotFoundError();
  // Central policy (TASK-014): the WHERE clause above is the primary
  // enforcement, this assert is the semantic backstop — it denies a row
  // whose owner differs even if a future refactor drops the SQL scoping.
  assertProjectOwnership(project.userId, userId);
  const input = (await db.query.projectInputs.findFirst({
    where: eq(projectInputs.projectId, projectId),
  })) as unknown as ProjectInputRow | undefined;
  const settings = (await db.query.projectSettings.findFirst({
    where: eq(projectSettings.projectId, projectId),
  })) as unknown as ProjectSettingsRow | undefined;
  return toDetail(project, input ?? null, settings ?? null);
}

// Project list for SCREEN-003 (TASK-012): owned, non-deleted projects only,
// most recently updated first. Archived (read-only) projects are INCLUDED
// with archivedAt set — the UI gates editing off that flag (TASK-130).
// Returns lean rows — no input/settings joins
// (AGENTS.md §91): the list shows name/state/readiness/updated, nothing more.
export async function listProjects(db: AppDatabase, userId: string): Promise<ProjectRow[]> {
  if (userId.trim() === "") throw new ProjectValidationError("Owner is required.");
  const rows = await db.query.projects.findMany({
    where: and(eq(projects.userId, userId), isNull(projects.deletedAt)),
    orderBy: [desc(projects.updatedAt)],
  });
  return rows as ProjectRow[];
}

export interface UpdateProjectInput {
  name?: string | null;
  description?: string | null | undefined;
  idea?: string | null;
  targetUsers?: string | null | undefined;
  constraints?: string | null | undefined;
  references?: unknown;
  preferredStack?: string | null | undefined;
  preferredLanguage?: string | null | undefined;
}

// Scope handle for nested resources (TASK-014): decisions, knowledge, tasks,
// and every future project child must resolve ownership through HERE and
// carry the returned projectId into their own scoped queries — never trust
// a client-provided project_id directly (architecture.md §51, §63).
export interface ProjectScope {
  projectId: string;
  ownerId: string;
}

export async function requireProjectScope(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<ProjectScope> {
  const { project } = await getProject(db, userId, projectId);
  return { projectId: project.id, ownerId: project.userId };
}

// Soft-delete per database-schema.md §63: the row stays for retention, but
// every read path filters deleted_at IS NULL so it becomes inaccessible.
// One atomic scoped UPDATE — missing, foreign, or already-archived rows all
// surface as NotFound without revealing which case applied. The version bump
// rides the same statement (TASK-020): archival is a canonical change too.
//
// TASK-130 archive vs soft-delete, side by side:
// - archiveProject (deleted_at): project VANISHES from reads. Kept as-is for
//   existing callers/tests; do not rename it.
// - setProjectArchived (archived_at): project stays VISIBLE but READ-ONLY —
//   updateProject rejects it until restoreProject clears the marker.
// restoreProject clears BOTH markers, so one call recovers from either state.
// Re-archiving an archived project is an idempotent no-op: it returns the
// current row WITHOUT a version bump (archiving twice is not a change).
// Restoring a live project (neither marker) is NotFound, mirroring the
// archive-twice rule above.
//
// Scope notes (MVP): read-only is enforced at updateProject level only.
// Nested modules (decisions/knowledge/...) enter through
// requireProjectScope, which does not know about archived_at — blocking
// nested writes on archived projects is follow-up work. Retention likewise
// has no cleanup job: rows are kept indefinitely (deferrable per TASK-130).
export async function archiveProject(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<void> {
  if (userId.trim() === "") throw new ProjectValidationError("Owner is required.");
  const [archived] = await db
    .update(projects)
    .set({ deletedAt: new Date(), stateVersion: sql`${projects.stateVersion} + 1` })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .returning({ id: projects.id });
  if (!archived) throw new ProjectNotFoundError();
}

// Read-only predicate for the TASK-130 archive marker (pure: no DB touch,
// so UI gating and tests can use it without a database).
export function isProjectArchived(project: Pick<ProjectRow, "archivedAt">): boolean {
  return project.archivedAt !== null;
}

// Archive (read-only) per TASK-130: sets archived_at and bumps the version
// atomically. The project stays visible in getProject/listProjects but
// updateProject rejects it until restoreProject. Soft-deleted rows are out
// of reach (deleted_at IS NULL scope): archiving them is NotFound, and
// cross-user attempts are NotFound without revealing existence (TASK-014).
export async function setProjectArchived(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<ProjectRow> {
  if (userId.trim() === "") throw new ProjectValidationError("Owner is required.");
  const current = (await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)),
  })) as ProjectRow | undefined;
  if (!current) throw new ProjectNotFoundError();
  assertProjectOwnership(current.userId, userId);
  // Idempotent re-archive: already archived returns the current row with no
  // extra version bump — a repeated archive is not a canonical change.
  if (isProjectArchived(current)) return current;
  const [archived] = await db
    .update(projects)
    .set({ archivedAt: new Date(), stateVersion: sql`${projects.stateVersion} + 1` })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.userId, userId),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt),
      ),
    )
    .returning();
  if (!archived) throw new ProjectNotFoundError();
  return archived as ProjectRow;
}

// Restore per TASK-130: clears BOTH archived_at and deleted_at, so one call
// recovers from archive or soft-delete, then bumps the version atomically —
// the project becomes editable again. The lookup deliberately ignores the
// deleted_at filter (a soft-deleted row must be findable to be restored).
// Missing, foreign, or already-live rows surface as NotFound.
export async function restoreProject(
  db: AppDatabase,
  userId: string,
  projectId: string,
): Promise<ProjectRow> {
  if (userId.trim() === "") throw new ProjectValidationError("Owner is required.");
  const current = (await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
  })) as ProjectRow | undefined;
  if (!current) throw new ProjectNotFoundError();
  assertProjectOwnership(current.userId, userId);
  if (current.deletedAt === null && current.archivedAt === null) {
    throw new ProjectNotFoundError("Project is not archived or deleted.");
  }
  const [restored] = await db
    .update(projects)
    .set({ deletedAt: null, archivedAt: null, stateVersion: sql`${projects.stateVersion} + 1` })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning();
  if (!restored) throw new ProjectNotFoundError();
  return restored as ProjectRow;
}

export async function updateProject(
  db: AppDatabase,
  userId: string,
  projectId: string,
  raw: UpdateProjectInput,
): Promise<ProjectDetail> {
  // Malformed input fails before any database round-trip (same fail-fast
  // rule as the stable-ID allocator: never touch the DB for invalid calls).
  if (raw.name === null) throw new ProjectValidationError("name is required.");
  if (raw.idea === null) throw new ProjectValidationError("idea is required.");
  const current = await getProject(db, userId, projectId);
  // TASK-130 read-only enforcement: archived projects reject EVERY update —
  // canonical, settings-only, and even no-op calls — until restoreProject.
  // Soft-deleted rows never reach here (getProject filters them to NotFound).
  if (isProjectArchived(current.project)) {
    throw new ProjectValidationError("Project is archived and read-only.");
  }

  const patch: Partial<{ name: string; slug: string; description: string | null }> = {};
  if (raw.name !== undefined && raw.name !== null) {
    const name = requireNonEmpty(raw.name, "name", MAX_NAME_LENGTH);
    patch.name = name;
    patch.slug = deriveSlug(name);
  }
  if (raw.description !== undefined)
    patch.description = optionalText(raw.description, "description");

  const inputPatch: Partial<{
    idea: string;
    targetUsers: string | null;
    constraints: string | null;
    references: string[] | null;
  }> = {};
  if (raw.idea !== undefined && raw.idea !== null) {
    inputPatch.idea = requireNonEmpty(raw.idea, "idea", MAX_IDEA_LENGTH);
  }
  if (raw.targetUsers !== undefined)
    inputPatch.targetUsers = optionalText(raw.targetUsers, "target_users");
  if (raw.constraints !== undefined)
    inputPatch.constraints = optionalText(raw.constraints, "constraints");
  const references = normalizeReferences(raw.references);
  if (references !== undefined) inputPatch.references = references;

  const settingsPatch: { settings: Record<string, unknown> } | null = (() => {
    if (raw.preferredStack === undefined && raw.preferredLanguage === undefined) return null;
    const previous = isPlainObject(current.settings.settings) ? current.settings.settings : {};
    const next: Record<string, unknown> = { ...previous };
    if (raw.preferredStack !== undefined) next.preferred_stack = trimOrNull(raw.preferredStack);
    if (raw.preferredLanguage !== undefined) {
      next.preferred_language =
        raw.preferredLanguage === null
          ? DEFAULT_LANGUAGE
          : normalizePreferredLanguage(raw.preferredLanguage);
    }
    return { settings: next };
  })();

  const touchesCanonical = Object.keys(patch).length > 0 || Object.keys(inputPatch).length > 0;
  // No-op calls return current state untouched: no writes, no version bump,
  // and no empty-SET update (which some drivers reject).
  if (!touchesCanonical && !settingsPatch) return current;

  if (touchesCanonical) {
    // Canonical edits and their version bump commit atomically (TASK-020):
    // data and version number can never diverge, and a failed apply leaves
    // the approved version untouched — including AI-driven failures, which
    // never reach this path unvalidated (agents.md AG-INV-001/006).
    await db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        const [updated] = await tx
          .update(projects)
          .set({ ...patch })
          .where(
            and(
              eq(projects.id, projectId),
              eq(projects.userId, userId),
              isNull(projects.deletedAt),
            ),
          )
          .returning({ id: projects.id });
        if (!updated) throw new ProjectNotFoundError();
      }
      if (Object.keys(inputPatch).length > 0) {
        await tx
          .update(projectInputs)
          .set(inputPatch)
          .where(eq(projectInputs.id, current.input.id));
      }
      await incrementStateVersion(tx, userId, projectId);
    });
  }
  if (settingsPatch) {
    // Preferences ride a single statement with no version bump: they are
    // not canonical state (see state-version.ts).
    await db
      .update(projectSettings)
      .set(settingsPatch)
      .where(eq(projectSettings.id, current.settings.id));
  }
  return getProject(db, userId, projectId);
}

// Canonical-state columns (lifecycle_state, discovery_level, readiness_score,
// state_version, user_id, slug) are deliberately absent from UpdateProjectInput:
// domain writes like confirmDecision (TASK-020) or slug derivation own them.
// Casting to a wider shape here would silently accept them from UI callers.
