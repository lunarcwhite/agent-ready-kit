// Central project authorization policies (TASK-014).
//
// Every project-scoped access decision flows through here. The rule lives in
// ONE function — "only the owner, and never reveal that another user's
// project exists" — so future modules cannot invent their own comparison.
// Repository queries keep their (id, user_id) WHERE scoping as defense in
// depth; the assert below is the semantic backstop, pinned by stub-db tests
// that bypass SQL scoping entirely.
//
// Nested resources (decisions, tasks, ...) must enter through
// requireProjectScope() in repository.ts — never a raw client project_id.
import { ProjectNotFoundError, ProjectValidationError } from "./errors";

// Throws when sessionUserId may not touch a row owned by projectUserId.
// Mismatch surfaces as NotFound, not Forbidden: the domain never confirms
// or denies the existence of another user's project (see errors.ts).
export function assertProjectOwnership(projectUserId: string, sessionUserId: string): void {
  if (sessionUserId.trim() === "") throw new ProjectValidationError("Owner is required.");
  if (projectUserId !== sessionUserId) throw new ProjectNotFoundError();
}

// Non-throwing counterpart for UI gating (button visibility, empty states).
// Never a substitute for assertProjectOwnership on the server path.
export function isProjectOwner(projectUserId: string, sessionUserId: string): boolean {
  if (sessionUserId.trim() === "") return false;
  return projectUserId === sessionUserId;
}
