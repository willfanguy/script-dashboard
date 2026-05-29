import { describe, it, expect } from "vitest";
import { workspaceColor } from "@/utils/workspaceColor";

describe("workspaceColor", () => {
  it("returns orange classes for Personal", () => {
    const c = workspaceColor("Personal");
    expect(c).toContain("orange");
    expect(c).toContain("border-orange");
    expect(c).toContain("text-orange");
  });

  it("returns green classes for Work", () => {
    const c = workspaceColor("Work");
    expect(c).toContain("green");
    expect(c).toContain("border-green");
    expect(c).toContain("text-green");
  });

  it("is case-insensitive", () => {
    expect(workspaceColor("PERSONAL")).toBe(workspaceColor("personal"));
    expect(workspaceColor("WoRk")).toBe(workspaceColor("work"));
  });

  it("returns empty string for unknown workspaces", () => {
    expect(workspaceColor("Vaults")).toBe("");
    expect(workspaceColor("SomethingNew")).toBe("");
  });

  it("returns empty string for null/undefined/empty input", () => {
    expect(workspaceColor(null)).toBe("");
    expect(workspaceColor(undefined)).toBe("");
    expect(workspaceColor("")).toBe("");
  });
});
