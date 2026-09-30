// Understanding review loading state (SCREEN-006, design.md §21).
//
// Meaningful operation steps, not a fake percentage: the review runs one AI
// analysis before first paint.
export default function UnderstandingLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Understanding your idea...</h1>
      <ul className="flex flex-col gap-1 text-sm text-zinc-600">
        <li>● Analyzing product type and known facts</li>
        <li>○ Mapping important unknowns</li>
        <li>○ Preparing discovery</li>
      </ul>
    </main>
  );
}
