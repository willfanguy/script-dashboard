import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { sweepStaleRunning } from "../stale-runs.js";

let runsDir: string;
// All fixtures anchor to a fixed "now" so the threshold math is deterministic.
const NOW_ISO = "2026-04-24T15:00:00.000Z";
const NOW_SEC = Math.floor(Date.parse(NOW_ISO) / 1000);
const NOW_MS = NOW_SEC * 1000;
const THRESHOLD_MS = 30 * 60 * 1000;

beforeEach(() => {
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-stale-runs-"));
});

afterEach(() => {
  fs.rmSync(runsDir, { recursive: true, force: true });
});

function writeRun(
  id: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const full = { id, ...record };
  fs.writeFileSync(path.join(runsDir, `${id}.json`), JSON.stringify(full));
  return full;
}

function readRun(id: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(runsDir, `${id}.json`), "utf-8"),
  );
}

describe("sweepStaleRunning", () => {
  it("returns empty when the directory doesn't exist", () => {
    const result = sweepStaleRunning(
      path.join(runsDir, "nope"),
      THRESHOLD_MS,
      NOW_MS,
    );
    expect(result).toEqual({ sweptIds: [], scanned: 0 });
  });

  it("leaves non-running records untouched regardless of age", () => {
    const ancientStart = NOW_SEC - 86400;
    const cases = [
      { id: "done-old", status: "success" },
      { id: "failed-old", status: "failed" },
      { id: "killed-old", status: "killed" },
    ];
    for (const c of cases) {
      writeRun(c.id, {
        script: "whatever",
        status: c.status,
        startedAt: new Date(ancientStart * 1000).toISOString(),
        startEpoch: ancientStart,
        endedAt: new Date((ancientStart + 5) * 1000).toISOString(),
        endEpoch: ancientStart + 5,
        duration: 5,
      });
    }

    const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS);

    expect(result.sweptIds).toEqual([]);
    expect(result.scanned).toBe(cases.length);
    for (const c of cases) {
      expect(readRun(c.id).status).toBe(c.status);
    }
  });

  it("does not sweep a running record younger than the threshold", () => {
    const startedAt = NOW_SEC - 60; // 1 minute ago
    writeRun("fresh-runner", {
      script: "slack-saved-sync",
      status: "running",
      startedAt: new Date(startedAt * 1000).toISOString(),
      startEpoch: startedAt,
    });

    const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS);

    expect(result.sweptIds).toEqual([]);
    expect(readRun("fresh-runner").status).toBe("running");
  });

  it("sweeps a running record with no progress older than threshold", () => {
    const startedAt = NOW_SEC - 45 * 60; // 45 min ago
    writeRun("stuck-runner", {
      script: "enrich-connections",
      category: "skill",
      status: "running",
      startedAt: new Date(startedAt * 1000).toISOString(),
      startEpoch: startedAt,
    });

    const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS);

    expect(result.sweptIds).toEqual(["stuck-runner"]);
    const updated = readRun("stuck-runner");
    expect(updated.status).toBe("killed");
    expect(updated.exitCode).toBe(124);
    expect(updated.endEpoch).toBe(startedAt); // no progress → activity = start
    expect(updated.duration).toBe(0);
    expect(updated.output).toMatch(/Marked killed by server sweep/);
    expect(updated.output).toMatch(/no start-to-end report/);
  });

  it("keeps a running record alive when recent progress beats an old start", () => {
    const startedAt = NOW_SEC - 45 * 60; // 45 min ago
    const lastProgress = NOW_SEC - 60; // 1 min ago
    writeRun("long-but-live", {
      script: "enrich-connections",
      status: "running",
      startedAt: new Date(startedAt * 1000).toISOString(),
      startEpoch: startedAt,
      lastProgressAt: new Date(lastProgress * 1000).toISOString(),
      lastProgressMessage: "phase 3 of 5",
    });

    const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS);

    expect(result.sweptIds).toEqual([]);
    expect(readRun("long-but-live").status).toBe("running");
  });

  it("sweeps a running record whose last progress is older than threshold", () => {
    const startedAt = NOW_SEC - 90 * 60; // 90 min ago
    const lastProgress = NOW_SEC - 40 * 60; // 40 min ago
    writeRun("stalled", {
      script: "process-drafts-inbox",
      status: "running",
      startedAt: new Date(startedAt * 1000).toISOString(),
      startEpoch: startedAt,
      lastProgressAt: new Date(lastProgress * 1000).toISOString(),
    });

    const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS);

    expect(result.sweptIds).toEqual(["stalled"]);
    const updated = readRun("stalled");
    expect(updated.status).toBe("killed");
    // duration should reflect start→lastProgress, not start→now
    expect(updated.duration).toBe(50 * 60);
    expect(updated.endEpoch).toBe(lastProgress);
    expect(updated.output).toMatch(/no progress for 40 min/);
  });

  it("skips malformed JSON files without crashing", () => {
    fs.writeFileSync(path.join(runsDir, "broken.json"), "{not json");
    const startedAt = NOW_SEC - 45 * 60;
    writeRun("old-stuck", {
      script: "slack-saved-sync",
      status: "running",
      startedAt: new Date(startedAt * 1000).toISOString(),
      startEpoch: startedAt,
    });

    const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS);

    expect(result.sweptIds).toEqual(["old-stuck"]);
    expect(result.scanned).toBe(2);
  });

  it("skips running records with no usable timestamps", () => {
    writeRun("no-time", {
      script: "mystery",
      status: "running",
    });

    const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS);

    expect(result.sweptIds).toEqual([]);
    expect(readRun("no-time").status).toBe("running");
  });

  it("writes well-formed JSON after sweeping (atomic rewrite)", () => {
    const startedAt = NOW_SEC - 45 * 60;
    writeRun("atomic-check", {
      script: "slack-saved-sync",
      category: "skill",
      status: "running",
      startedAt: new Date(startedAt * 1000).toISOString(),
      startEpoch: startedAt,
    });

    sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS);

    const raw = fs.readFileSync(
      path.join(runsDir, "atomic-check.json"),
      "utf-8",
    );
    // Must be parseable, and any tmp file must be gone.
    expect(() => JSON.parse(raw)).not.toThrow();
    const entries = fs.readdirSync(runsDir);
    expect(entries.filter((e) => e.includes(".tmp."))).toEqual([]);
  });

  describe("per-category thresholds", () => {
    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

    it("uses the category override when the record has a matching category", () => {
      // Interactive session idle 45 min — past the default 30-min threshold
      // but well below the 8h interactive override. Should NOT be swept.
      const startedAt = NOW_SEC - 45 * 60;
      writeRun("idle-interactive", {
        script: "claude-interactive",
        category: "interactive",
        status: "running",
        startedAt: new Date(startedAt * 1000).toISOString(),
        startEpoch: startedAt,
      });

      const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS, {
        interactive: EIGHT_HOURS_MS,
      });

      expect(result.sweptIds).toEqual([]);
      expect(readRun("idle-interactive").status).toBe("running");
    });

    it("still sweeps an interactive record past its (longer) threshold", () => {
      // 9h idle — past the 8h override. Should be swept.
      const startedAt = NOW_SEC - 9 * 60 * 60;
      writeRun("ancient-interactive", {
        script: "claude-interactive",
        category: "interactive",
        status: "running",
        startedAt: new Date(startedAt * 1000).toISOString(),
        startEpoch: startedAt,
      });

      const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS, {
        interactive: EIGHT_HOURS_MS,
      });

      expect(result.sweptIds).toEqual(["ancient-interactive"]);
      expect(readRun("ancient-interactive").status).toBe("killed");
    });

    it("respects the default threshold for non-matching categories", () => {
      // Scripted (category=skill) idle 45 min — past the default 30-min
      // threshold and unaffected by the interactive override. Should be swept.
      const startedAt = NOW_SEC - 45 * 60;
      writeRun("stuck-skill", {
        script: "enrich-connections",
        category: "skill",
        status: "running",
        startedAt: new Date(startedAt * 1000).toISOString(),
        startEpoch: startedAt,
      });

      const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS, {
        interactive: EIGHT_HOURS_MS,
      });

      expect(result.sweptIds).toEqual(["stuck-skill"]);
      expect(readRun("stuck-skill").status).toBe("killed");
    });

    it("falls back to the default threshold when record has no category", () => {
      const startedAt = NOW_SEC - 45 * 60;
      writeRun("uncategorized", {
        script: "legacy-script",
        status: "running",
        startedAt: new Date(startedAt * 1000).toISOString(),
        startEpoch: startedAt,
      });

      const result = sweepStaleRunning(runsDir, THRESHOLD_MS, NOW_MS, {
        interactive: EIGHT_HOURS_MS,
      });

      expect(result.sweptIds).toEqual(["uncategorized"]);
    });
  });
});
