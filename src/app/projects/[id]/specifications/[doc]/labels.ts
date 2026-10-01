// Specification workspace labels (TASK-068, design.md §92–§93).
//
// Pure presentational mapping: route slug to document type, status glyphs
// for sections and documents. Every status pairs a text label with a text
// glyph so state is never communicated through color alone (AGENTS.md §66).
// No database, no AI.
export interface SpecSecondaryDoc {
  documentType: string;
  title: string;
}

export interface SpecDocTarget {
  slug: string;
  documentType: string;
  title: string;
  description: string;
  secondary?: SpecSecondaryDoc;
}

export const SPEC_DOCS: SpecDocTarget[] = [
  {
    slug: "product",
    documentType: "PRD",
    title: "Product",
    description: "Product requirements compiled from canonical state.",
  },
  {
    slug: "architecture",
    documentType: "ARCHITECTURE",
    title: "Architecture",
    description: "Technical structure compiled from confirmed constraints.",
  },
  {
    slug: "data",
    documentType: "DATABASE_SCHEMA",
    title: "Data",
    description: "Persistence design compiled from domain entities.",
  },
  {
    slug: "design",
    documentType: "DESIGN",
    title: "Design",
    description: "Interface expectations compiled from requirements and screens.",
  },
  {
    slug: "ai",
    documentType: "PRODUCT_AGENTS",
    title: "AI",
    description: "Product agent roles and behavior, generated only when applicable.",
    secondary: { documentType: "SOUL", title: "Soul" },
  },
];

export function resolveSpecSlug(slug: string | undefined): SpecDocTarget | null {
  if (!slug) return null;
  return SPEC_DOCS.find((target) => target.slug === slug.trim().toLowerCase()) ?? null;
}

export const SECTION_STATUS_LABEL: Record<string, { label: string; glyph: string }> = {
  CURRENT: { label: "Current", glyph: "✓" },
  STALE: { label: "Needs review", glyph: "⚠" },
  PROPOSED: { label: "Proposed", glyph: "◇" },
  REVIEW_REQUIRED: { label: "Review required", glyph: "?" },
};

export const DOCUMENT_STATUS_LABEL: Record<string, { label: string; glyph: string }> = {
  DRAFT: { label: "Draft", glyph: "○" },
  CURRENT: { label: "Current", glyph: "✓" },
  STALE: { label: "Stale", glyph: "⚠" },
  REVIEW_REQUIRED: { label: "Review required", glyph: "?" },
};

export function sectionStatusLabel(status: string): { label: string; glyph: string } {
  return SECTION_STATUS_LABEL[status] ?? { label: status, glyph: "?" };
}

export function documentStatusLabel(status: string): { label: string; glyph: string } {
  return DOCUMENT_STATUS_LABEL[status] ?? { label: status, glyph: "?" };
}
