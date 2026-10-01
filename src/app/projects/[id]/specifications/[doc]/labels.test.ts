// TASK-068 acceptance: slug resolution covers the five Specify targets,
// every section/document status has a text glyph (no color-only state),
// unknown inputs fall back safely. Pure unit tests — no database, no AI.
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_STATUS_LABEL,
  SECTION_STATUS_LABEL,
  SPEC_DOCS,
  documentStatusLabel,
  resolveSpecSlug,
  sectionStatusLabel,
} from "./labels";

describe("resolveSpecSlug", () => {
  it("resolves the five Specify targets to document types", () => {
    expect(SPEC_DOCS.map((target) => target.slug)).toEqual([
      "product",
      "architecture",
      "data",
      "design",
      "ai",
    ]);
    expect(resolveSpecSlug("product")?.documentType).toBe("PRD");
    expect(resolveSpecSlug("architecture")?.documentType).toBe("ARCHITECTURE");
    expect(resolveSpecSlug("data")?.documentType).toBe("DATABASE_SCHEMA");
    expect(resolveSpecSlug("design")?.documentType).toBe("DESIGN");
    expect(resolveSpecSlug("ai")?.documentType).toBe("PRODUCT_AGENTS");
  });

  it("attaches the optional soul document to the AI target only", () => {
    expect(resolveSpecSlug("ai")?.secondary?.documentType).toBe("SOUL");
    for (const slug of ["product", "architecture", "data", "design"]) {
      expect(resolveSpecSlug(slug)?.secondary).toBeUndefined();
    }
  });

  it("is case-insensitive and rejects unknown slugs without throwing", () => {
    expect(resolveSpecSlug("Product")?.documentType).toBe("PRD");
    expect(resolveSpecSlug("agents")).toBeNull();
    expect(resolveSpecSlug(undefined)).toBeNull();
    expect(resolveSpecSlug("  ")).toBeNull();
  });
});

describe("status labels", () => {
  it("gives every section status a text glyph", () => {
    for (const status of ["CURRENT", "STALE", "PROPOSED", "REVIEW_REQUIRED"]) {
      const badge = sectionStatusLabel(status);
      expect(badge.label).toBeTruthy();
      expect(badge.glyph).toBeTruthy();
      expect(SECTION_STATUS_LABEL[status]).toEqual(badge);
    }
  });

  it("gives every document status a text glyph", () => {
    for (const status of ["DRAFT", "CURRENT", "STALE", "REVIEW_REQUIRED"]) {
      const badge = documentStatusLabel(status);
      expect(badge.label).toBeTruthy();
      expect(badge.glyph).toBeTruthy();
      expect(DOCUMENT_STATUS_LABEL[status]).toEqual(badge);
    }
  });

  it("falls back to the raw status for unknown values", () => {
    expect(sectionStatusLabel("FUTURE").label).toBe("FUTURE");
    expect(documentStatusLabel("FUTURE").label).toBe("FUTURE");
  });
});
