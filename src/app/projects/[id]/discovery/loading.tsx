// Loading state for the Discovery workspace (TASK-034, TASK-115).
// Route-level skeleton: progress panel plus conversation placeholders.
// The named status line gives the wait a meaningful label (no fake
// percentages) for sighted users and screen readers alike.
import { OperationPending } from "@/app/components/operation-status";

export default function DiscoveryLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8" aria-busy="true">
      <OperationPending label="Loading the discovery workspace…" />
      <div className="h-7 w-40 animate-pulse rounded bg-zinc-200" />
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-4">
          <div className="h-32 animate-pulse rounded border border-zinc-200 bg-zinc-100" />
          <div className="h-64 animate-pulse rounded border border-zinc-200 bg-zinc-100" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-36 animate-pulse rounded border border-zinc-200 bg-zinc-100" />
          <div className="h-24 animate-pulse rounded border border-zinc-200 bg-zinc-100" />
        </div>
      </div>
    </main>
  );
}
