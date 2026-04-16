import { describe, it, expect } from "vitest";
import { groupByCategory } from "@/utils/groupByCategory";
import type { RunRecord, ScriptRegistry } from "@/types";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    script: "test-script",
    category: "scheduled",
    status: "success",
    startedAt: "2026-04-16T10:00:00Z",
    startEpoch: 1776423600,
    ...overrides,
  };
}

const registry: ScriptRegistry = {
  scripts: [],
  categories: {
    scheduled: { label: "Scheduled", description: "Timer-based" },
    meeting: { label: "Meeting", description: "Recording pipeline" },
    manual: { label: "Manual", description: "On-demand" },
  },
};

describe("groupByCategory", () => {
  it("groups runs by category", () => {
    const runs = [
      makeRun({ id: "1", category: "scheduled" }),
      makeRun({ id: "2", category: "meeting" }),
      makeRun({ id: "3", category: "scheduled" }),
    ];

    const groups = groupByCategory(runs, registry);
    expect(groups.get("scheduled")?.length).toBe(2);
    expect(groups.get("meeting")?.length).toBe(1);
  });

  it("respects registry category order", () => {
    const runs = [
      makeRun({ id: "1", category: "manual" }),
      makeRun({ id: "2", category: "scheduled" }),
      makeRun({ id: "3", category: "meeting" }),
    ];

    const groups = groupByCategory(runs, registry);
    const keys = [...groups.keys()];

    // Registry order: scheduled, meeting, manual
    expect(keys).toEqual(["scheduled", "meeting", "manual"]);
  });

  it("places unknown categories after known ones", () => {
    const runs = [
      makeRun({ id: "1", category: "unknown-cat" }),
      makeRun({ id: "2", category: "scheduled" }),
    ];

    const groups = groupByCategory(runs, registry);
    const keys = [...groups.keys()];

    expect(keys[0]).toBe("scheduled");
    expect(keys[1]).toBe("unknown-cat");
  });

  it("returns empty map for empty runs", () => {
    const groups = groupByCategory([], registry);
    expect(groups.size).toBe(0);
  });

  it("falls back to 'other' for runs with no category", () => {
    const runs = [makeRun({ id: "1", category: "" })];
    const groups = groupByCategory(runs, null);

    // Empty string category gets set as-is (the function uses run.category || "other")
    expect(groups.has("other")).toBe(true);
  });
});
