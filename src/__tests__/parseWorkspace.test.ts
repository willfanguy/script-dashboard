import { describe, it, expect } from "vitest";
import { splitWorkspace, splitSource } from "@/utils/parseWorkspace";

describe("splitSource", () => {
  it("returns null source for empty/undefined input", () => {
    expect(splitSource(undefined)).toEqual({
      description: "",
      sourceKind: null,
    });
    expect(splitSource(null)).toEqual({ description: "", sourceKind: null });
    expect(splitSource("")).toEqual({ description: "", sourceKind: null });
  });

  it("extracts resumed from the new form and strips it", () => {
    expect(splitSource("/Users/will/Repos/work (resumed)")).toEqual({
      description: "/Users/will/Repos/work",
      sourceKind: "resumed",
    });
  });

  it("extracts cleared from the new form and strips it", () => {
    expect(splitSource("/Users/will/Repos/personal (cleared)")).toEqual({
      description: "/Users/will/Repos/personal",
      sourceKind: "cleared",
    });
  });

  it("extracts resumed from the legacy (source: resume) form", () => {
    expect(splitSource("/Users/will/Repos/work (source: resume)")).toEqual({
      description: "/Users/will/Repos/work",
      sourceKind: "resumed",
    });
  });

  it("extracts cleared from the legacy (source: clear) form", () => {
    expect(splitSource("/p (source: clear)")).toEqual({
      description: "/p",
      sourceKind: "cleared",
    });
  });

  it("is case-insensitive", () => {
    expect(splitSource("/p (RESUMED)")).toEqual({
      description: "/p",
      sourceKind: "resumed",
    });
    expect(splitSource("/p (source: CLEAR)")).toEqual({
      description: "/p",
      sourceKind: "cleared",
    });
  });

  it("leaves unknown legacy source values alone", () => {
    expect(splitSource("/p (source: weird-future-value)")).toEqual({
      description: "/p (source: weird-future-value)",
      sourceKind: null,
    });
  });

  it("preserves descriptions with no source tag", () => {
    expect(splitSource("/Users/will/Repos/work")).toEqual({
      description: "/Users/will/Repos/work",
      sourceKind: null,
    });
  });
});

describe("splitWorkspace", () => {
  it("returns empty values for empty/undefined input", () => {
    expect(splitWorkspace(undefined)).toEqual({
      description: "",
      workspace: null,
    });
    expect(splitWorkspace(null)).toEqual({
      description: "",
      workspace: null,
    });
    expect(splitWorkspace("")).toEqual({
      description: "",
      workspace: null,
    });
  });

  it("returns the original description and null workspace when no tag present", () => {
    const d = "/Users/will/Repos/personal";
    expect(splitWorkspace(d)).toEqual({ description: d, workspace: null });
  });

  it("extracts a single-word workspace and strips the tag", () => {
    const r = splitWorkspace(
      "/Users/will/Repos/personal (source: clear) [cmux: Personal]",
    );
    expect(r.workspace).toBe("Personal");
    expect(r.description).toBe(
      "/Users/will/Repos/personal (source: clear)",
    );
  });

  it("extracts a multi-word workspace name with spaces", () => {
    const r = splitWorkspace(
      "/Users/will/Repos/work [cmux: Project Door SuperFit]",
    );
    expect(r.workspace).toBe("Project Door SuperFit");
    expect(r.description).toBe("/Users/will/Repos/work");
  });

  it("trims whitespace inside the workspace name", () => {
    const r = splitWorkspace("/path [cmux:   Personal   ]");
    expect(r.workspace).toBe("Personal");
  });

  it("returns null workspace when the cmux tag value is empty", () => {
    const r = splitWorkspace("/path [cmux: ]");
    expect(r.workspace).toBeNull();
  });

  it("handles the cmux tag with no surrounding context", () => {
    const r = splitWorkspace("[cmux: Work]");
    expect(r.workspace).toBe("Work");
    expect(r.description).toBe("");
  });

  it("only strips the first occurrence (defensive — should never be two)", () => {
    const r = splitWorkspace("/a [cmux: A] /b [cmux: B]");
    // First tag's value extracted; second remains in description.
    expect(r.workspace).toBe("A");
    expect(r.description).toBe("/a /b [cmux: B]");
  });
});
