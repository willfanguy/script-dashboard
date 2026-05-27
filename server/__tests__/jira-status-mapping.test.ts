import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  jiraToLocalStatus,
  loadStatusMapping,
  normalizeStatusKey,
} from "../jira-status-mapping.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-status-map-"));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function writeMapping(entries: Array<{ jira?: string; local?: string }>): string {
  const p = path.join(workdir, "map.json");
  fs.writeFileSync(p, JSON.stringify({ mappings: entries }));
  return p;
}

describe("normalizeStatusKey", () => {
  it("lowercases and strips non-alphanumeric", () => {
    expect(normalizeStatusKey("Ready for QA")).toBe("readyforqa");
    expect(normalizeStatusKey("ready-for-qa")).toBe("readyforqa");
    expect(normalizeStatusKey("READY_FOR_QA")).toBe("readyforqa");
    expect(normalizeStatusKey("Quality & Evals")).toBe("qualityevals");
    expect(normalizeStatusKey("Quality and Evals")).toBe("qualityandevals");
  });

  it("handles empty and whitespace-only input", () => {
    expect(normalizeStatusKey("")).toBe("");
    expect(normalizeStatusKey("   ")).toBe("");
  });
});

describe("loadStatusMapping", () => {
  it("returns empty mapping when file is missing", () => {
    const result = loadStatusMapping(path.join(workdir, "nope.json"));
    expect(result.lookup.size).toBe(0);
  });

  it("returns empty mapping when JSON is malformed", () => {
    const p = path.join(workdir, "bad.json");
    fs.writeFileSync(p, "{not json");
    expect(loadStatusMapping(p).lookup.size).toBe(0);
  });

  it("returns empty mapping when mappings is missing", () => {
    const p = path.join(workdir, "no-mappings.json");
    fs.writeFileSync(p, JSON.stringify({}));
    expect(loadStatusMapping(p).lookup.size).toBe(0);
  });

  it("skips malformed entries but keeps good ones", () => {
    const p = writeMapping([
      { jira: "In Progress", local: "in-progress" },
      { jira: "Done" },             // missing local
      { local: "open" } as never,   // missing jira
      { jira: "", local: "x" },     // empty strings
      { jira: "Done", local: "done" },
    ]);
    const result = loadStatusMapping(p);
    expect(result.lookup.size).toBe(2);
    expect(result.lookup.get("inprogress")).toBe("in-progress");
    expect(result.lookup.get("done")).toBe("done");
  });

  it("loads the real lib/jira-status-mapping.json without dropping entries", () => {
    // The default path points at lib/jira-status-mapping.json — load it
    // unmodified and confirm a few core entries land in the lookup.
    const real = loadStatusMapping();
    expect(real.lookup.get("inprogress")).toBe("in-progress");
    expect(real.lookup.get("done")).toBe("done");
    expect(real.lookup.get("readyforqa")).toBe("ready-for-qa");
    expect(real.lookup.get("backlog")).toBe("open");
    expect(real.lookup.get("blocked")).toBe("blocked");
  });
});

describe("jiraToLocalStatus", () => {
  const mapping = loadStatusMapping();

  it("returns the mapped local status (case-insensitive)", () => {
    expect(jiraToLocalStatus("In Progress", mapping)).toBe("in-progress");
    expect(jiraToLocalStatus("IN PROGRESS", mapping)).toBe("in-progress");
    expect(jiraToLocalStatus("in progress", mapping)).toBe("in-progress");
    expect(jiraToLocalStatus("in-progress", mapping)).toBe("in-progress");
  });

  it("tolerates whitespace and punctuation differences", () => {
    expect(jiraToLocalStatus("Quality & Evals", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("Quality and Evals", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("ready for qa", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("Ready for QA  ", mapping)).toBe("ready-for-qa");
  });

  it("covers every status from the JIRA workflows we surveyed", () => {
    // AIF workflow
    expect(jiraToLocalStatus("Backlog", mapping)).toBe("open");
    expect(jiraToLocalStatus("To Do", mapping)).toBe("open");
    expect(jiraToLocalStatus("In Progress", mapping)).toBe("in-progress");
    expect(jiraToLocalStatus("Blocked", mapping)).toBe("blocked");
    expect(jiraToLocalStatus("Under Review", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("Quality & Evals", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("Ready for Staging", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("Done", mapping)).toBe("done");

    // Common SuperFit workflow (SM / MS / JSI)
    expect(jiraToLocalStatus("In QA", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("Ready for QA", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("Ready for Release", mapping)).toBe("ready-for-qa");
    expect(jiraToLocalStatus("Deployed to Production", mapping)).toBe("done");
    expect(jiraToLocalStatus("Pending Triage", mapping)).toBe("open");
  });

  it("includes cancelled-flavored states (future-proofing)", () => {
    expect(jiraToLocalStatus("Cancelled", mapping)).toBe("cancelled");
    expect(jiraToLocalStatus("Canceled", mapping)).toBe("cancelled");
    expect(jiraToLocalStatus("Won't Do", mapping)).toBe("cancelled");
    expect(jiraToLocalStatus("Won't Fix", mapping)).toBe("cancelled");
  });

  it("returns null for unknown JIRA statuses (no clobber)", () => {
    expect(jiraToLocalStatus("Frobnicating", mapping)).toBeNull();
    expect(jiraToLocalStatus("", mapping)).toBeNull();
  });

  it("never returns a local value outside the documented taxonomy", () => {
    const VALID_LOCAL = new Set([
      "open",
      "in-progress",
      "ready-for-qa",
      "waiting",
      "done",
      "cancelled",
      "blocked",
      "none",
    ]);
    for (const local of mapping.lookup.values()) {
      expect(VALID_LOCAL).toContain(local);
    }
  });
});
