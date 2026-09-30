// Loading state for the project shell (TASK-110).
// Route-level skeleton mirroring the shell: sidebar placeholder plus content
// placeholder, same zinc/pulse convention as the Discovery loading state.
export default function ProjectLoading() {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row" aria-busy="true">
      <div className="border-b border-zinc-200 p-4 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
        <div className="mt-2 h-5 w-32 animate-pulse rounded bg-zinc-200" />
        <div className="mt-4 flex gap-2 overflow-hidden lg:flex-col">
          <div className="h-7 w-24 shrink-0 animate-pulse rounded bg-zinc-100" />
          <div className="h-7 w-24 shrink-0 animate-pulse rounded bg-zinc-100" />
          <div className="h-7 w-24 shrink-0 animate-pulse rounded bg-zinc-100" />
        </div>
      </div>
      <div className="min-w-0 flex-1 p-8">
        <div className="h-7 w-48 animate-pulse rounded bg-zinc-200" />
        <div className="mt-4 h-40 animate-pulse rounded border border-zinc-200 bg-zinc-100" />
      </div>
    </div>
  );
}
