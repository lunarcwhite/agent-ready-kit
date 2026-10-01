// SEO gate budgets (adapted 8-gate checklist, honest data only).
// Guards title/description length, canonical base, and JSON-LD shapes so
// future copy edits cannot silently break the landing gates.
import { describe, expect, it } from "vitest";
import {
  SITE_DESCRIPTION,
  SITE_TITLE,
  appJsonLd,
  getSiteUrl,
  organizationJsonLd,
  websiteJsonLd,
} from "./seo";

describe("landing SEO gates", () => {
  it("title fits 30–60 chars", () => {
    expect(SITE_TITLE.length).toBeGreaterThanOrEqual(30);
    expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
  });

  it("description fits 120–160 chars", () => {
    expect(SITE_DESCRIPTION.length).toBeGreaterThanOrEqual(120);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it("site URL has no trailing slash and falls back locally", () => {
    expect(getSiteUrl().endsWith("/")).toBe(false);
    expect(getSiteUrl().length).toBeGreaterThan(0);
  });

  it("JSON-LD shapes are honest SoftwareApplication/Organization/WebSite", () => {
    const siteUrl = "https://example.test";
    expect(organizationJsonLd(siteUrl)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: expect.any(String),
      url: siteUrl,
    });
    expect(websiteJsonLd(siteUrl)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebSite",
      url: siteUrl,
    });
    const app = appJsonLd(siteUrl);
    expect(app).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      description: SITE_DESCRIPTION,
      url: `${siteUrl}/`,
    });
    // No fabricated marketing proof.
    expect(app).not.toHaveProperty("aggregateRating");
    expect(app).not.toHaveProperty("offers");
    expect(app).not.toHaveProperty("review");
  });
});
