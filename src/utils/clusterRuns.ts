import type { RunRecord } from "@/types";

// Category to cluster. Other categories pass through as individual entries.
export const CLUSTER_CATEGORY = "interactive";
// Max gap between an older run's start and a newer run's end before we
// break the cluster. 30 min keeps "a working block" together while
// separating sessions across, say, lunch.
export const CLUSTER_GAP_SECONDS = 30 * 60;
// A single isolated run is not a cluster — it renders as a normal card.
export const MIN_CLUSTER_SIZE = 2;

export interface RunCluster {
  category: string;
  runs: RunRecord[]; // members in newest-first order, matching parent sort
  totalDuration: number;
  failedCount: number;
}

export type ChronoEntry =
  | { kind: "run"; run: RunRecord }
  | { kind: "cluster"; cluster: RunCluster };

function makeCluster(runs: RunRecord[]): RunCluster {
  const totalDuration = runs.reduce((acc, r) => acc + (r.duration ?? 0), 0);
  const failedCount = runs.filter(
    (r) => r.status === "failed" || r.status === "killed",
  ).length;
  return { category: runs[0].category, runs, totalDuration, failedCount };
}

// Cluster consecutive `interactive` runs into rollups for the chronological
// view. Walks runs newest-first; an interactive run joins the pending
// cluster if its end-time is within CLUSTER_GAP_SECONDS of the oldest
// pending member's start-time. Non-clusterable runs flush the pending
// cluster and pass through.
//
// Running interactive runs are NOT clustered — they need their own live
// card so the polling logic in RunCard stays simple and per-run.
export function clusterChronoRuns(runs: RunRecord[]): ChronoEntry[] {
  const sorted = [...runs].sort(
    (a, b) => (b.startEpoch || 0) - (a.startEpoch || 0),
  );

  const out: ChronoEntry[] = [];
  let pending: RunRecord[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    if (pending.length >= MIN_CLUSTER_SIZE) {
      out.push({ kind: "cluster", cluster: makeCluster(pending) });
    } else {
      for (const r of pending) out.push({ kind: "run", run: r });
    }
    pending = [];
  };

  for (const run of sorted) {
    const isClusterable =
      run.category === CLUSTER_CATEGORY && run.status !== "running";

    if (!isClusterable) {
      flush();
      out.push({ kind: "run", run });
      continue;
    }

    if (pending.length === 0) {
      pending.push(run);
      continue;
    }

    // pending[last] is the oldest member added so far (we walk newest-first
    // and append older). The new `run` is older still; compare its end-time
    // to that oldest pending member's start-time. Negative gap = overlap
    // (concurrent sessions across cmux workspaces); always cluster those.
    const oldestPending = pending[pending.length - 1];
    const currentEnd = run.endEpoch ?? run.startEpoch;
    const gap = oldestPending.startEpoch - currentEnd;

    if (gap <= CLUSTER_GAP_SECONDS) {
      pending.push(run);
    } else {
      flush();
      pending.push(run);
    }
  }
  flush();

  return out;
}
