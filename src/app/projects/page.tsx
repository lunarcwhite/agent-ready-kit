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
import {
  Badge,
  LifecycleSteps,
  PageHeader,
  btnPrimary,
  btnSecondary,
  cardCls,
  faintText,
} from "@/app/components/ui";
import { EmptyState } from "@/app/components/empty-state";

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
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

function readinessNote(project: ProjectRow): string | null {
  if (project.readinessScore > 0) return `${project.readinessScore}% ready`;
  return null;
}

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const projects = await listProjects(getDb(), user.id);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
        <PageHeader
          eyebrow={<p className="text-sm text-zinc-500 dark:text-zinc-400">Signed in as {user.email}</p>}
          title="Your projects"
          description="Turn each idea into validated, implementation-ready context."
          actions={
            <>
              <Link href="/projects/new" className={btnPrimary}>
                + New project
              </Link>
              <form action={logout}>
                <button type="submit" className={btnSecondary}>
                  Sign out
                </button>
              </form>
            </>
          }
        />

        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            body="Turn your software idea into an implementation-ready project specification. Discovery, decisions, validation, and export: guided step by step."
            actionHref="/projects/new"
            actionLabel="Create your first project"
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => {
              const readiness = readinessNote(project);
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className={`${cardCls} block h-full transition-colors hover:border-zinc-400 dark:hover:border-zinc-600`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                          {project.name}
                        </span>
                        {project.description && (
                          <span className={`mt-1 line-clamp-2 block ${faintText}`}>
                            {project.description}
                          </span>
                        )}
                      </span>
                      <Badge status={project.lifecycleState} />
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-3">
                      <LifecycleSteps current={project.lifecycleState} />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {[readiness, `Updated ${formatUpdated(project.updatedAt)}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
