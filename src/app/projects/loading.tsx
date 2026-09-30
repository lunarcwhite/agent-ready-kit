// Loading state for the project list (TASK-012: loading states exist).
// Route-level skeleton rendered by Next.js while the server component loads.
export default function ProjectsLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="h-7 w-40 animate-pulse rounded bg-zinc-200" />
        <div className="h-9 w-24 animate-pulse rounded bg-zinc-200" />
      </div>
      <ul className="flex flex-col gap-4" aria-label="Loading projects">
        {[0, 1, 2].map((key) => (
          <li key={key} className="rounded border border-zinc-200 p-4">
            <div className="h-5 w-1/3 animate-pulse rounded bg-zinc-200" />
            <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-zinc-100" />
          </li>
        ))}
      </ul>
    </main>
  );
}
