// Site SEO constants (8-gate checklist adapted from UAAF v3.3 §SEO, scoped to
// our calm developer tool — no marketing fluff, no fake ratings/pricing).
//
// Budgets enforced by seo.test.ts:
// - title 30–60 chars, description 120–160 chars (gates 1–2);
// - canonical + metadataBase (gate 4), OG/Twitter text tags (gate 5);
// - viewport handled in layout.tsx (gate 3), single h1 per page by
//   construction (gate 6), no <img> on the landing so alt is vacuous
//   (gate 7), JSON-LD below covers gate 8 with honest data only.

export const SITE_NAME = "Agent Ready Kit";

export const SITE_TITLE = "Agent Ready Kit: Idea to Implementation-Ready Agent Kit";

export const SITE_DESCRIPTION =
  "Turn a software idea into validated specs, decisions, tasks, and an Agent Kit ZIP your coding agent can execute: no silent assumptions.";

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export function organizationJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: siteUrl,
  };
}

export function websiteJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: siteUrl,
  };
}

export function appJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: `${siteUrl}/`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
  };
}
