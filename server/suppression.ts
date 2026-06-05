import fs from "fs";
import { atomicWriteJson } from "./fs-utils.js";
import type { Artifact, ArtifactDecision, RunRecord } from "./types.js";

// Suppression registry — paths in this file are filtered out of every GET so
// reviewed / archived items don't keep reappearing in the review queue on each
// agent rerun. Keyed by absolute artifact path.
//
// "reviewed" entries are fingerprinted: the entry records the decision state at
// review time, and a re-emitted artifact is suppressed only while its current
// fingerprint still matches. When JIRA/local state drifts, the fingerprint
// changes and the item re-surfaces — fixing the old indefinite-mute behavior
// where a reviewed divergence stayed hidden even after its state changed.
// "archived" entries stay path-keyed (archive is a deliberate, undo-less
// throw-away, and todo-sync's archive rescan must stay deduped).

export interface SuppressionEntry {
  reason: "reviewed" | "archived";
  suppressedAt: string;
  viaScript?: string;
  viaRunId?: string;
  // Decision state captured at review time (see decisionFingerprint). Absent on
  // archived entries and on legacy entries written before fingerprinting; an
  // absent fingerprint on a "reviewed" entry is treated as inert (re-surfaces).
  fingerprint?: string;
}

// Canonical state fingerprint for a decision. Two artifacts with the same
// fingerprint represent the same decision in the same state; a change to the
// JIRA or local status (the axes that define a divergence) yields a new
// fingerprint, which is what lets a reviewed item re-surface when state drifts.
// No decision → "", so decision-less artifacts still dedupe precisely against
// each other (empty === empty); only legacy registry entries are inert.
export function decisionFingerprint(decision?: ArtifactDecision): string {
  if (!decision) return "";
  return `${decision.kind}|${decision.jiraStatus ?? ""}|${decision.localStatus ?? ""}`;
}

// Whether a registry entry currently suppresses this artifact.
//  - "archived": always (by path) — archiving has no undo and the archive
//    rescan must stay deduped.
//  - "reviewed": only while the reviewed-time fingerprint matches the artifact's
//    current state. A legacy "reviewed" entry with no stored fingerprint is
//    inert (never matches), so it re-surfaces once and is re-reviewed with a
//    fingerprint. Errs toward showing, never hiding.
export function isSuppressed(
  artifact: Artifact,
  registry: SuppressionRegistry,
): boolean {
  const entry = registry[artifact.path];
  if (!entry) return false;
  if (entry.reason === "archived") return true;
  if (entry.fingerprint === undefined) return false;
  return entry.fingerprint === decisionFingerprint(artifact.decision);
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
    (a) => !isSuppressed(a, registry) || !!a.reviewedAt,
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
// Dropped = isSuppressed(artifact) (see above) AND no reviewedAt on this run
// record. This keeps the SOURCE run's reviewed stub visible (so the user can
// undo) while suppressing the same path's reappearance on every NEW run that
// emits it in the same state. Archived artifacts always lack reviewedAt, so
// they're stripped cleanly.
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
    (a) => !isSuppressed(a, registry) || !!a.reviewedAt,
  );
  return before - record.artifacts.length;
}
