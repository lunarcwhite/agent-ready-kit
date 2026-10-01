// Error state for the Discovery workspace (TASK-034).
// Client boundary limited to the framework-mandated retry button; approved
// project state is untouched by render failures.
"use client";

export default function DiscoveryError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Couldn&apos;t load Discovery</h1>
      <p className="text-sm text-zinc-600">
        Your decisions and answers are safe. Check your connection and try again.
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
