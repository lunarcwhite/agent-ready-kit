// Project creation (SCREEN-004 per screen-blueprint.md §4; TASK-013).
// Server component, no client JS: required fields use browser validation,
// server failures redirect back with ?error=. Optional inputs hide behind
// <details> (progressive disclosure). Preferred stack lives inside Optional:
// TASK-013 lists it as a supported input while the blueprint keeps the first
// view free of technical fields — collapsed by default satisfies both.
// Successful creation lands on /projects: the project starts in
// DISCOVERY/INITIAL (the workflow entry state); the Discovery engine that
// would continue from here lands in M3.
import { redirect } from "next/navigation";
import { requireUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { createProject } from "@/modules/projects/repository";
import { ProjectValidationError } from "@/modules/projects/errors";

const IDEA_PLACEHOLDER =
  "Example: A SaaS that helps freelancers create invoices, track payments, and manage clients.";

function optional(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

async function createProjectAction(formData: FormData): Promise<void> {
  "use server";
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const idea = String(formData.get("idea") ?? "").trim();
  if (name === "" || idea === "") redirect("/projects/new?error=required");
  const references = String(formData.get("references") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  try {
    const created = await createProject(getDb(), user.id, {
      name,
      idea,
      targetUsers: optional(formData.get("targetUsers")),
      constraints: optional(formData.get("constraints")),
      references: references.length > 0 ? references : null,
      preferredStack: optional(formData.get("preferredStack")),
      preferredLanguage: optional(formData.get("preferredLanguage")),
    });
    redirect(`/projects/${created.project.id}/understanding`);
  } catch (error) {
    if (error instanceof ProjectValidationError) redirect("/projects/new?error=invalid");
    throw error;
  }
  redirect("/projects");
}

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const error = (await searchParams)?.error;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your project</h1>
        <p className="mt-1 text-sm text-zinc-600">What are you building?</p>
      </div>
      {error === "required" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Project name and idea are required.
        </p>
      )}
      {error === "invalid" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          That input is too long or invalid. Shorten it and try again.
        </p>
      )}
      <form action={createProjectAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Your idea
          <textarea
            name="idea"
            required
            rows={4}
            placeholder={IDEA_PLACEHOLDER}
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Project name
          <input
            name="name"
            type="text"
            required
            maxLength={255}
            autoComplete="off"
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <details className="rounded border border-zinc-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Optional</summary>
          <div className="flex flex-col gap-3 pt-3">
            <label className="flex flex-col gap-1">
              Target users
              <input
                name="targetUsers"
                type="text"
                autoComplete="off"
                className="rounded border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              Constraints
              <input
                name="constraints"
                type="text"
                autoComplete="off"
                placeholder="e.g. offline-first, single user"
                className="rounded border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              References
              <span className="text-xs text-zinc-500">One URL per line.</span>
              <textarea
                name="references"
                rows={2}
                autoComplete="off"
                className="rounded border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              Preferred stack
              <input
                name="preferredStack"
                type="text"
                autoComplete="off"
                placeholder="e.g. Next.js + PostgreSQL"
                className="rounded border border-zinc-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              Language
              <select
                name="preferredLanguage"
                defaultValue="en"
                className="rounded border border-zinc-300 px-3 py-2"
              >
                <option value="en">English</option>
                <option value="id">Indonesia</option>
              </select>
            </label>
          </div>
        </details>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Start Discovery
        </button>
      </form>
    </main>
  );
}
