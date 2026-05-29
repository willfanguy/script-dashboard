import { describe, it, expect } from "vitest";
import {
  clusterChronoRuns,
  CLUSTER_GAP_SECONDS,
} from "@/utils/clusterRuns";
import type { RunRecord } from "@/types";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const startEpoch = overrides.startEpoch ?? 1_800_000_000;
  const duration = overrides.duration ?? 60;
  return {
    id: `run-${startEpoch}`,
    script: "claude-interactive",
    category: "interactive",
    status: "success",
    startedAt: new Date(startEpoch * 1000).toISOString(),
    startEpoch,
    endEpoch: startEpoch + duration,
    duration,
    ...overrides,
  };
}

describe("clusterChronoRuns", () => {
  it("returns empty for empty input", () => {
    expect(clusterChronoRuns([])).toEqual([]);
  });

  it("passes through a single interactive run as an individual entry", () => {
    const r = makeRun({ id: "solo", startEpoch: 1_800_000_000 });
    const out = clusterChronoRuns([r]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: "run", run: r });
  });

  it("clusters two interactive runs within the gap window", () => {
    const older = makeRun({ id: "a", startEpoch: 1_000, duration: 60 }); // ends 1060
    const newer = makeRun({
      id: "b",
      startEpoch: 1060 + CLUSTER_GAP_SECONDS - 10, // gap < limit
      duration: 60,
    });
    const out = clusterChronoRuns([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("cluster");
    if (out[0].kind === "cluster") {
      // Members in newest-first order
      expect(out[0].cluster.runs.map((r) => r.id)).toEqual(["b", "a"]);
      expect(out[0].cluster.totalDuration).toBe(120);
    }
  });

  it("clusters two overlapping (concurrent) interactive runs", () => {
    // Older session ran from t=1000 to t=1200 (200s). Newer session started
    // at t=1100 — overlap. The gap from newer.endEpoch=1160 to older.start=1000
    // is negative. We still cluster: concurrent workspaces are the most-cluster
    // case, not the least.
    const older = makeRun({ id: "a", startEpoch: 1_000, duration: 200 });
    const newer = makeRun({ id: "b", startEpoch: 1_100, duration: 60 });
    const out = clusterChronoRuns([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("cluster");
    if (out[0].kind === "cluster") {
      expect(out[0].cluster.runs.map((r) => r.id)).toEqual(["b", "a"]);
    }
  });

  it("does not cluster two interactive runs separated by more than the gap", () => {
    const older = makeRun({ id: "a", startEpoch: 1_000, duration: 60 });
    const newer = makeRun({
      id: "b",
      startEpoch: 1060 + CLUSTER_GAP_SECONDS + 1,
      duration: 60,
    });
    const out = clusterChronoRuns([older, newer]);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.kind === "run")).toBe(true);
  });

  it("a non-interactive run between two interactives breaks the cluster", () => {
    const older = makeRun({ id: "a", startEpoch: 1_000, duration: 60 });
    const mid = makeRun({
      id: "m",
      category: "scheduled",
      startEpoch: 1_200,
      duration: 60,
    });
    const newer = makeRun({ id: "b", startEpoch: 1_400, duration: 60 });
    const out = clusterChronoRuns([older, mid, newer]);
    // Newest-first: b, m, a — each its own run
    expect(out.map((e) => e.kind)).toEqual(["run", "run", "run"]);
  });

  it("does not cluster running interactive runs", () => {
    const running = makeRun({
      id: "live",
      status: "running",
      startEpoch: 1_500,
      endEpoch: undefined,
      duration: undefined,
    });
    const done = makeRun({ id: "done", startEpoch: 1_400, duration: 60 });
    const out = clusterChronoRuns([running, done]);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.kind === "run")).toBe(true);
  });

  it("clusters three consecutive interactives into one rollup", () => {
    const runs = [
      makeRun({ id: "c1", startEpoch: 1_000, duration: 60 }),
      makeRun({ id: "c2", startEpoch: 1_200, duration: 60 }),
      makeRun({ id: "c3", startEpoch: 1_400, duration: 60 }),
    ];
    const out = clusterChronoRuns(runs);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("cluster");
    if (out[0].kind === "cluster") {
      expect(out[0].cluster.runs.map((r) => r.id)).toEqual([
        "c3",
        "c2",
        "c1",
      ]);
    }
  });

  it("counts failed and killed members in failedCount", () => {
    const out = clusterChronoRuns([
      makeRun({ id: "ok", startEpoch: 1_000 }),
      makeRun({ id: "ko", startEpoch: 1_200, status: "failed" }),
      makeRun({ id: "k2", startEpoch: 1_400, status: "killed" }),
    ]);
    expect(out).toHaveLength(1);
    if (out[0].kind === "cluster") {
      expect(out[0].cluster.failedCount).toBe(2);
    }
  });

  it("preserves chronological position of clusters relative to other runs", () => {
    // Timeline (oldest→newest):
    //   morning scheduled run at t=1000
    //   two interactives at t=1200, 1400 (clusterable)
    //   a meeting at t=1800
    //   one interactive at t=2000 (isolated, too far from the cluster)
    const runs = [
      makeRun({ id: "sched", category: "scheduled", startEpoch: 1_000 }),
      makeRun({ id: "i1", startEpoch: 1_200 }),
      makeRun({ id: "i2", startEpoch: 1_400 }),
      makeRun({ id: "meet", category: "meeting", startEpoch: 1_800 }),
      makeRun({ id: "i3", startEpoch: 2_000 }),
    ];
    const out = clusterChronoRuns(runs);
    // Newest-first: i3 (run), meet (run), cluster[i2,i1], sched (run)
    expect(out.map((e) => e.kind)).toEqual([
      "run",
      "run",
      "cluster",
      "run",
    ]);
    if (out[0].kind === "run") expect(out[0].run.id).toBe("i3");
    if (out[1].kind === "run") expect(out[1].run.id).toBe("meet");
    if (out[2].kind === "cluster") {
      expect(out[2].cluster.runs.map((r) => r.id)).toEqual(["i2", "i1"]);
    }
    if (out[3].kind === "run") expect(out[3].run.id).toBe("sched");
  });

  it("does not cluster non-interactive categories even if consecutive", () => {
    const out = clusterChronoRuns([
      makeRun({ id: "s1", category: "scheduled", startEpoch: 1_000 }),
      makeRun({ id: "s2", category: "scheduled", startEpoch: 1_200 }),
    ]);
    expect(out.map((e) => e.kind)).toEqual(["run", "run"]);
  });

  it("tolerates a record with missing startEpoch/endEpoch without throwing", () => {
    // A malformed record (no startEpoch) yields a NaN gap; it must degrade to an
    // individual run, not crash the clusterer or silently swallow the record.
    const malformed = {
      ...makeRun({ id: "bad" }),
      startEpoch: undefined as unknown as number,
      endEpoch: undefined,
      duration: undefined,
    };
    const good = makeRun({ id: "good", startEpoch: 1_000 });
    let out: ReturnType<typeof clusterChronoRuns> = [];
    expect(() => {
      out = clusterChronoRuns([good, malformed]);
    }).not.toThrow();
    // Both runs are represented; the NaN gap prevents clustering.
    const ids = out.flatMap((e) =>
      e.kind === "run" ? [e.run.id] : e.cluster.runs.map((r) => r.id),
    );
    expect(ids.sort()).toEqual(["bad", "good"]);
    expect(out.every((e) => e.kind === "run")).toBe(true);
  });
});
