// Shared empty and error states (TASK-116, AGENTS.md §63).
//
// One visual language for "nothing here yet" and "something failed" so
// every workspace explains itself the same way: what is missing, why it
// matters, and the recovery action. Server-rendered, no client JS —
// drop into any server page. Errors always name the recovery step and
// never imply approved content was lost (AI failures never touch it).
import Link from "next/link";

export function EmptyState({ title, body, actionHref, actionLabel }: {
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{body}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-2 inline-flex min-h-[44px] items-center rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorState({ title, body, retryHref, retryLabel = "Try again" }: {
  title: string;
  body: string;
  retryHref?: string;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1">{body}</p>
      {retryHref ? (
        <Link href={retryHref} className="mt-2 inline-block underline">
          {retryLabel}
        </Link>
      ) : null}
    </div>
  );
}
