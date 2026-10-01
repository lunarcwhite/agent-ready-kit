// Loading state for the Specification workspace (TASK-068).
// Route-level skeleton: header plus section placeholders.
export default function SpecificationLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded bg-zinc-200" />
      <div className="flex gap-2">
        <div className="h-8 w-24 animate-pulse rounded-full bg-zinc-200" />
        <div className="h-8 w-28 animate-pulse rounded-full bg-zinc-200" />
        <div className="h-8 w-20 animate-pulse rounded-full bg-zinc-200" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-16 animate-pulse rounded border border-zinc-200 bg-zinc-100" />
        <div className="h-16 animate-pulse rounded border border-zinc-200 bg-zinc-100" />
        <div className="h-16 animate-pulse rounded border border-zinc-200 bg-zinc-100" />
      </div>
    </main>
  );
}
