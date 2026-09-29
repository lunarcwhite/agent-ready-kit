// Identity abstraction (TASK-010, architecture.md §4 + AGENTS.md §13).
//
// Domain modules call THIS — never Auth.js directly:
//   requireUser()  → { id, email, name, image? } or throws AuthRequiredError
//   getSessionUser() → same shape, or null when unauthenticated
//
// The provider (Auth.js v5, JWT sessions, Credentials + Google) lives in
// src/auth.ts behind it, so swapping providers means rewriting one file.
// JWT sessions are deliberate: the Credentials provider forbids database
// sessions, and OAuth accounts link fine without a sessions table.
//
// User identity flows from JWT `sub` + email, not from a users-table read:
// the session must stay valid without per-request DB round-trips, and
// project-counters precedent (TASK-004) keeps users.id as an unconstrained
// uuid until FKs land in TASK-011. Auth-owned fields (passwordHash,
// emailVerified) never cross this boundary — this returns only the
// AppSessionUser projection, so secrets cannot leak into domain logic.

import { auth } from "@/auth";

export interface AppSessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export async function getSessionUser(): Promise<AppSessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}

export async function requireUser(): Promise<AppSessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthRequiredError();
  return user;
}
