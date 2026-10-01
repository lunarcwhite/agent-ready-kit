// Loading state for the project list (TASK-012: loading states exist).
// Route-level skeleton rendered by Next.js while the server component loads.
export default function ProjectsLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950" aria-busy="true">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
        <div className="flex items-center justify-between">
          <div className="h-7 w-44 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-9 w-28 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Loading projects">
          {[0, 1, 2, 3].map((key) => (
            <li
              key={key}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="h-5 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="mt-3 h-1.5 w-full animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
