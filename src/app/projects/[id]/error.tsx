// Project error boundary (TASK-115/116; F-08: covers every project child route
// without its own error.tsx — discovery and specs/[doc] keep theirs, the rest
// fall through to this boundary instead of nothing).
// A route error boundary must be a client component — this is the only
// client JS on the boundary, limited to the framework-mandated retry button.
// Approved project state is untouched by render failures; retry re-renders.
"use client";

export default function ProjectError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col justify-center gap-4 px-6 py-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Couldn&apos;t load this project section</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Your approved work is safe. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mx-auto inline-flex min-h-[44px] items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Try again
      </button>
    </main>
  );
}
