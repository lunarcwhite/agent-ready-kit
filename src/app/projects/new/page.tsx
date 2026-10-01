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
import Link from "next/link";
import { requireUser } from "@/infrastructure/auth/identity";
import { getDb } from "@/infrastructure/database/db";
import { createProject } from "@/modules/projects/repository";
import { ProjectValidationError } from "@/modules/projects/errors";
import { BackLink, PageHeader, btnPrimary, cardCls, inputCls } from "@/app/components/ui";

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
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-12">
        <PageHeader
          eyebrow={<BackLink href="/projects">← All projects</BackLink>}
          title="What do you want to build?"
          description="Start with your idea in plain words. Agent Ready Kit will help you make it precise."
        />
        {error === "required" && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            Project name and idea are required.
          </p>
        )}
        {error === "invalid" && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            That input is too long or invalid. Shorten it and try again.
          </p>
        )}
        <form action={createProjectAction} className={`${cardCls} mt-6 flex flex-col gap-4 !p-6`}>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Describe your idea
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
              The primary input: a few sentences are enough.
            </span>
            <textarea
              name="idea"
              required
              rows={5}
              placeholder={IDEA_PLACEHOLDER}
              className={`${inputCls} min-h-28 resize-y`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Project name
            <input
              name="name"
              type="text"
              required
              maxLength={255}
              autoComplete="off"
              placeholder="e.g. StoryForge"
              className={inputCls}
            />
          </label>
          <details className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <summary className="cursor-pointer font-medium">Optional details</summary>
            <div className="flex flex-col gap-3 pt-3">
              <label className="flex flex-col gap-1.5">
                Target users
                <input name="targetUsers" type="text" autoComplete="off" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1.5">
                Constraints
                <input
                  name="constraints"
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. offline-first, single user"
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                References
                <span className="text-xs text-zinc-500 dark:text-zinc-400">One URL per line.</span>
                <textarea name="references" rows={2} autoComplete="off" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1.5">
                Preferred stack
                <input
                  name="preferredStack"
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. Next.js + PostgreSQL"
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                Language
                <select name="preferredLanguage" defaultValue="en" className={inputCls}>
                  <option value="en">English</option>
                  <option value="id">Indonesia</option>
                </select>
              </label>
            </div>
          </details>
          <button type="submit" className={`${btnPrimary} w-full`}>
            Start Discovery
          </button>
          <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
            Next: review what we understood, then answer focused questions.{" "}
            <Link href="/projects" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
              Back to projects
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
