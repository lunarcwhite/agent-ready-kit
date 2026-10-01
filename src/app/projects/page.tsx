// Project list (SCREEN-003 per screen-blueprint.md §3; TASK-012).
// Server component: owner-scoped list via listProjects, empty state with
// Create Project action, card per project with lifecycle status, readiness
// when available, and last-updated info. Loading/error states live in
// loading.tsx / error.tsx beside this file.
import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/auth";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { listProjects, type ProjectRow } from "@/modules/projects/repository";

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

function statusText(project: ProjectRow): string {
  switch (project.lifecycleState) {
    case "DISCOVERY":
      return "Discovery in progress";
    case "DRAFT":
      return "Draft in progress";
    case "NEEDS_REVIEW":
      return "Needs review";
    case "IMPLEMENTATION_READY":
      return "Implementation Ready ✓";
  }
}

function formatUpdated(at: Date): string {
  const minutes = Math.max(0, Math.floor((Date.now() - at.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return at.toLocaleDateString();
}

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const projects = await listProjects(getDb(), user.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your Projects</h1>
          <p className="mt-1 text-sm text-zinc-600">Signed in as {user.email}.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/projects/new"
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            + New
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="rounded border border-zinc-200 p-8 text-center">
          <p className="text-lg font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-zinc-600">
            Let&apos;s turn your first idea into an Agent Ready project.
          </p>
          <Link
            href="/projects/new"
            className="mt-4 inline-block rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Create Project
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {projects.map((project) => (
            <li key={project.id} className="rounded border border-zinc-200 p-4">
              <p className="font-medium">{project.name}</p>
              {project.description && (
                <p className="mt-1 text-sm text-zinc-600">{project.description}</p>
              )}
              <p className="mt-2 text-sm text-zinc-500">
                {statusText(project)}
                {project.readinessScore > 0 && ` · Readiness ${project.readinessScore}%`} · Updated{" "}
                {formatUpdated(project.updatedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
