import { describe, expect, it } from "vitest";
import { NAV_ITEMS, NAV_SECTIONS, getActiveNav, isNavActive } from "./nav";

const PID = "abc123";

function href(key: string): string {
  const item = NAV_ITEMS.find((entry) => entry.key === key);
  if (!item) throw new Error(`unknown nav key ${key}`);
  return item.href(PID);
}

describe("project nav active-state matching", () => {
  it("matches exact section paths", () => {
    expect(getActiveNav(`/projects/${PID}/discovery`)).toBe("discovery");
    expect(getActiveNav(`/projects/${PID}/decisions`)).toBe("decisions");
    expect(getActiveNav(`/projects/${PID}/specifications/product`)).toBe("product");
    expect(getActiveNav(`/projects/${PID}/specifications/architecture`)).toBe("architecture");
    expect(getActiveNav(`/projects/${PID}/specifications/data`)).toBe("data");
    expect(getActiveNav(`/projects/${PID}/specifications/design`)).toBe("design");
    expect(getActiveNav(`/projects/${PID}/specifications/ai`)).toBe("ai");
    expect(getActiveNav(`/projects/${PID}/issues`)).toBe("issues");
    expect(getActiveNav(`/projects/${PID}/readiness`)).toBe("readiness");
    expect(getActiveNav(`/projects/${PID}/tasks`)).toBe("tasks");
    expect(getActiveNav(`/projects/${PID}/agent-kit`)).toBe("agent-kit");
  });

  it("matches the project root as overview, not a deeper section", () => {
    expect(getActiveNav(`/projects/${PID}`)).toBe("overview");
  });

  it("matches nested routes to their parent section (longest prefix wins)", () => {
    expect(getActiveNav(`/projects/${PID}/decisions/detail`)).toBe("decisions");
    expect(getActiveNav(`/projects/${PID}/decisions?code=DEC-AUTH-001`)).toBe("decisions");
    expect(getActiveNav(`/projects/${PID}/specifications/product/revisions`)).toBe("product");
    // Deeper section beats the overview root prefix.
    expect(getActiveNav(`/projects/${PID}/discovery/session`)).toBe("discovery");
  });

  it("ignores trailing slashes", () => {
    expect(getActiveNav(`/projects/${PID}/tasks/`)).toBe("tasks");
    expect(getActiveNav(`/projects/${PID}/`)).toBe("overview");
    expect(getActiveNav(`/projects/${PID}/readiness//#fragment`)).toBe("readiness");
  });

  it("returns null for unknown or out-of-scope paths", () => {
    expect(getActiveNav(`/projects/${PID}/unknown`)).toBeNull();
    expect(getActiveNav(`/projects/${PID}/discoveries`)).toBeNull();
    expect(getActiveNav("/projects")).toBeNull();
    expect(getActiveNav("/projects/new")).toBeNull();
    expect(getActiveNav("/login")).toBeNull();
    expect(getActiveNav("/")).toBeNull();
    expect(getActiveNav("")).toBeNull();
  });

  it("is independent of the project id value", () => {
    expect(getActiveNav("/projects/other-id-9/discovery")).toBe("discovery");
    expect(getActiveNav("/projects/other-id-9")).toBe("overview");
  });
});

describe("isNavActive", () => {
  it("matches exact paths and nested children on segment boundaries", () => {
    expect(isNavActive(href("decisions"), href("decisions"))).toBe(true);
    expect(isNavActive(`${href("decisions")}/detail`, href("decisions"))).toBe(true);
    expect(isNavActive(`${href("decisions")}/`, href("decisions"))).toBe(true);
  });

  it("rejects lookalike prefixes that are not nested routes", () => {
    expect(isNavActive(`/projects/${PID}/discoveries`, href("discovery"))).toBe(false);
    expect(isNavActive(`/projects/${PID}/task-list`, href("tasks"))).toBe(false);
    expect(isNavActive("/login", href("discovery"))).toBe(false);
  });
});

describe("project nav section grouping", () => {
  it("follows the design.md §13 sidebar structure", () => {
    expect(NAV_SECTIONS.map((section) => section.label)).toEqual([
      "Overview",
      "Define",
      "Specify",
      "Validate",
      "Execute",
      "Ship",
    ]);
    const byLabel = new Map(NAV_SECTIONS.map((section) => [section.label, section]));
    expect(byLabel.get("Overview")?.items.map((item) => item.key)).toEqual(["overview"]);
    expect(byLabel.get("Define")?.items.map((item) => item.key)).toEqual([
      "discovery",
      "decisions",
    ]);
    expect(byLabel.get("Specify")?.items.map((item) => item.key)).toEqual([
      "product",
      "architecture",
      "data",
      "design",
      "ai",
    ]);
    expect(byLabel.get("Validate")?.items.map((item) => item.key)).toEqual(["issues", "readiness"]);
    expect(byLabel.get("Execute")?.items.map((item) => item.key)).toEqual(["tasks"]);
    expect(byLabel.get("Ship")?.items.map((item) => item.key)).toEqual(["agent-kit"]);
  });

  it("keeps keys unique and href builders scoped to the project", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(href("overview")).toBe(`/projects/${PID}`);
    expect(href("discovery")).toBe(`/projects/${PID}/discovery`);
    expect(href("product")).toBe(`/projects/${PID}/specifications/product`);
    expect(href("agent-kit")).toBe(`/projects/${PID}/agent-kit`);
  });
});
