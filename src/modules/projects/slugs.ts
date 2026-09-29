// Slug derivation (TASK-011).
//
// Cosmetic only: human-friendly path fragments, never identity. Lookup is
// always by id, so collisions are harmless — no dedupe, no uniqueness.
//
// The single non-obvious choice: diacritics are folded ("café" → "cafe")
// instead of stripped, so non-English names degrade to readable ASCII.
export function deriveSlug(name: string, maxLength = 64): string {
  const folded = name.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
  return slug === "" ? "project" : slug;
}
