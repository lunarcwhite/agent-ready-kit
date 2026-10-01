// Shared AI operation states (TASK-115, AGENTS.md §62–§63).
//
// Server-rendered building blocks so every AI flow speaks the same
// language: OperationPending names the running operation with a
// non-numeric activity marker (no fake percentages, §62);
// OperationFailure states what failed, whether approved content changed
// (it never does on AI failure — §63/AG-INV-006), and what to do next,
// while the surrounding page keeps approved content visible.
//
// No client JS: these render inside server pages and route loading
// fallbacks. Retry is a plain link back to the originating action.
export function OperationPending({ label, hint }: { label: string; hint?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex items-center gap-3 rounded border border-zinc-200 bg-zinc-50 px-4 py-3"
    >
      <span
        aria-hidden="true"
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900"
      />
      <div>
        <p className="text-sm font-medium text-zinc-900">{label}</p>
        {hint ? <p className="mt-0.5 text-sm text-zinc-600">{hint}</p> : null}
      </div>
    </div>
  );
}

export function OperationFailure({
  title,
  detail,
  stateNote = "Your approved content is unchanged.",
  retryHref,
  retryLabel = "Try again",
}: {
  title: string;
  detail: string;
  stateNote?: string;
  retryHref?: string;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm font-medium text-red-800">{title}</p>
      <p className="mt-1 text-sm text-red-700">{detail}</p>
      <p className="mt-1 text-sm text-red-700">{stateNote}</p>
      {retryHref ? (
        <a
          href={retryHref}
          className="mt-2 inline-block rounded border border-red-300 px-3 py-1 text-sm font-medium text-red-800 hover:bg-red-100"
        >
          {retryLabel}
        </a>
      ) : null}
    </div>
  );
}
