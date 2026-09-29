// Protected placeholder (TASK-012 owns the real list).
// Exists in TASK-010 so the middleware gate and post-login redirect have
// a real target to prove against, plus a logout action for acceptance.
// Shows the session user (identity projection only — no auth internals).
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getSessionUser } from "@/infrastructure/auth/identity";

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Your Projects</h1>
      <p className="text-sm text-zinc-600">Signed in as {user.email}.</p>
      <p className="text-sm text-zinc-500">No projects yet — project creation lands in TASK-013.</p>
      <form action={logout}>
        <button
          type="submit"
          className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
