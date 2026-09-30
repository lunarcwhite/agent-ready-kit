// Error state for the project list (TASK-012: error states exist).
// A route error boundary must be a client component — this is the only
// client JS on the route, limited to the framework-mandated retry button.
// Approved project state is untouched by render failures; retry re-renders.
"use client";

export default function ProjectsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Couldn&apos;t load your projects</h1>
      <p className="text-sm text-zinc-600">
        Your projects are safe. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mx-auto rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        Try again
      </button>
    </main>
  );
}
