// Boundary contract for the identity abstraction (TASK-010):
// domain code depends on AppSessionUser + getSessionUser/requireUser,
// never on Auth.js session shapes. Auth.js itself is provider behavior —
// covered by live OAuth/manual login, not unit tests (AGENTS.md §74).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { AuthRequiredError, getSessionUser, requireUser } from "./identity";

// `auth` is overloaded (session accessor + middleware wrapper); narrow to
// the no-arg session signature this module actually calls.
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

describe("identity abstraction", () => {
  it("returns the session user projection", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "u-1", email: "a@example.com", name: "A", image: null },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    await expect(getSessionUser()).resolves.toEqual({
      id: "u-1",
      email: "a@example.com",
      name: "A",
      image: null,
    });
  });

  it("returns null for missing, id-less, or email-less sessions", async () => {
    mockAuth.mockResolvedValueOnce(null);
    await expect(getSessionUser()).resolves.toBeNull();
    mockAuth.mockResolvedValueOnce({ user: { email: "a@example.com" }, expires: "" });
    await expect(getSessionUser()).resolves.toBeNull();
    mockAuth.mockResolvedValueOnce({ user: { id: "u-1" }, expires: "" });
    await expect(getSessionUser()).resolves.toBeNull();
  });

  it("requireUser throws AuthRequiredError when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    await expect(requireUser()).rejects.toBeInstanceOf(AuthRequiredError);
    mockAuth.mockResolvedValueOnce({
      user: { id: "u-1", email: "a@example.com" },
      expires: "",
    });
    await expect(requireUser()).resolves.toMatchObject({ id: "u-1" });
  });
});
