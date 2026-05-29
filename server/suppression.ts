import fs from "fs";
import { atomicWriteJson } from "./fs-utils.js";
import type { RunRecord } from "./types.js";

// Suppression registry — paths in this file are filtered out of every GET so
// reviewed / archived items don't keep reappearing in the review queue on each
// agent rerun. Indefinite mute keyed by absolute artifact path.

export interface SuppressionEntry {
  reason: "reviewed" | "archived";
  suppressedAt: string;
  viaScript?: string;
  viaRunId?: string;
}

export type SuppressionRegistry = Record<string, SuppressionEntry>;

export function readSuppressed(file: string): SuppressionRegistry {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function addSuppression(
  file: string,
  artifactPath: string,
  entry: SuppressionEntry,
): void {
  const reg = readSuppressed(file);
  reg[artifactPath] = entry;
  atomicWriteJson(file, reg);
}

export function removeSuppression(file: string, artifactPath: string): void {
  const reg = readSuppressed(file);
  if (!(artifactPath in reg)) return;
  delete reg[artifactPath];
  atomicWriteJson(file, reg);
}

// Single source of truth for "is this run fully reviewed?", shared by the read
// projection (applySuppressionFilter) and the write path (POST /artifacts/
// reviewed), which previously carried two subtly different copies of the rule.
//
// A run is fully reviewed when it emitted at least one artifact and every
// artifact still visible to the user — not suppressed on another run unless
// reviewed here — carries a reviewedAt. An empty visible set (all artifacts
// archived/reviewed elsewhere) counts as fully reviewed: nothing's left to act
// on. A run that never emitted artifacts is never auto-reviewed.
export function isRunFullyReviewed(
  record: RunRecord,
  registry: SuppressionRegistry,
): boolean {
  if (record.reviewedAt) return false;
  const artifacts = record.artifacts ?? [];
  if (artifacts.length === 0) return false;
  const visible = artifacts.filter(
    (a) => !(a.path in registry) || !!a.reviewedAt,
  );
  return visible.every((a) => !!a.reviewedAt);
}

// A stable timestamp to project onto a fully-reviewed run. Must be derived
// from persisted fields only — using `Date.now()` here would reset the run's
// "All reviewed Xm ago" label to "just now" on every GET, since the projection
// recomputes per-read. Prefer the latest artifact review; fall back to the
// run's own end/start time when every artifact was reviewed on another run (so
// none carries a reviewedAt on this record).
function projectedReviewedAt(record: RunRecord): string {
  let latest = "";
  for (const a of record.artifacts ?? []) {
    if (a.reviewedAt && a.reviewedAt > latest) latest = a.reviewedAt;
  }
  return latest || record.endedAt || record.startedAt;
}

// Drop suppressed-unreviewed artifacts from a record in place (read-time
// projection — the on-disk record is untouched). Returns the count dropped.
//
// Dropped = path in registry AND no reviewedAt on this run record. This keeps
// the SOURCE run's reviewed stub visible (so the user can undo) while
// suppressing the same path's reappearance on every NEW run that emits it.
// Archived artifacts always lack reviewedAt, so they're stripped cleanly.
//
// Also projects reviewedAt when the run is fully reviewed, so a run whose
// unreviewed artifacts were all suppressed-elsewhere still clears the Needs
// Review queue. Decided from the ORIGINAL list (before the in-place filter) so
// "had artifacts, all suppressed" stays distinct from "never had any".
export function applySuppressionFilter(
  record: RunRecord,
  registry: SuppressionRegistry,
): number {
  if (!record.artifacts || record.artifacts.length === 0) return 0;
  const before = record.artifacts.length;
  if (isRunFullyReviewed(record, registry)) {
    record.reviewedAt = projectedReviewedAt(record);
  }
  record.artifacts = record.artifacts.filter(
    (a) => !(a.path in registry) || !!a.reviewedAt,
  );
  return before - record.artifacts.length;
}
