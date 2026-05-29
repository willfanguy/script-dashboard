import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CollapsibleRow } from "@/components/CollapsibleRow";
import type { Artifact, RunRecord, ScriptInfo } from "@/types";
import {
  statusVariant,
  formatDuration,
  formatTime,
  formatDate,
  timeAgo,
  progressState,
  elapsedSeconds,
} from "@/utils/formatting";
import {
  CheckCircle,
  XCircle,
  Loader,
  Skull,
  Clock,
  Archive,
  RotateCcw,
  Eraser,
} from "lucide-react";
import { ArtifactReview } from "@/components/ArtifactReview";
import { archiveArtifact } from "@/lib/artifacts-api";
import { CategoryGlyph } from "@/utils/categoryIcons";
import { splitWorkspace, splitSource } from "@/utils/parseWorkspace";
import { workspaceColor } from "@/utils/workspaceColor";

interface RunCardProps {
  run: RunRecord;
  scriptInfo?: ScriptInfo;
  onExpand: (id: string) => Promise<RunRecord | null>;
  // When true, the row's timestamp omits the date prefix (e.g. "1:11 PM"
  // instead of "Today 1:11 PM"). Set by parents that already display the
  // date via a day header above the row (chronological view, cluster
  // expansion). Defaults to false for views where each row needs full date.
  compactTime?: boolean;
}

function StatusIcon({ status }: { status: RunRecord["status"] }) {
  switch (status) {
    case "running":
      return <Loader className="h-4 w-4 text-blue-500 animate-spin" />;
    case "success":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "killed":
      return <Skull className="h-4 w-4 text-amber-500" />;
  }
}

const RUNNING_TICK_MS = 1_000;
const RUNNING_OUTPUT_POLL_MS = 3_000;

export function RunCard({
  run,
  scriptInfo,
  onExpand,
  compactTime = false,
}: RunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  // Monotonic ticker so "elapsed" and "last activity" re-render smoothly while
  // a run is still live — separate from data re-fetches over SSE / polling.
  const [, setTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Artifacts / review state is kept local so we can reflect user actions
  // (archive, mark reviewed) without waiting for the SSE re-fetch round-trip.
  const [artifacts, setArtifacts] = useState<Artifact[]>(
    run.artifacts ?? [],
  );
  const [reviewedAt, setReviewedAt] = useState<string | undefined>(
    run.reviewedAt,
  );
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Adopt fresh artifact / review state when the server pushes new data for
  // this run. use-runs replaces the whole list on each SSE refetch, but this
  // card instance persists (stable key=run.id), so the useState initializers
  // above only ran once at mount. Without this, an artifact reviewed/archived
  // in another tab — or auto-derived server-side — would never reach the card.
  // Keyed on serialized content so an identical refetch neither clobbers a
  // local optimistic edit nor churns renders.
  const serverArtifactsKey = JSON.stringify(run.artifacts ?? []);
  useEffect(() => {
    setArtifacts(run.artifacts ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverArtifactsKey]);
  useEffect(() => {
    setReviewedAt(run.reviewedAt);
  }, [run.reviewedAt]);

  const isRunning = run.status === "running";

  const handleToggle = async (next: boolean) => {
    if (next && output === null) {
      setLoadingOutput(true);
      const detail = await onExpand(run.id);
      setOutput(detail?.output || "");
      setLoadingOutput(false);
    }
    setExpanded(next);
  };

  // Live tick while running — drives the elapsed / last-activity readouts.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), RUNNING_TICK_MS);
    return () => clearInterval(id);
  }, [isRunning]);

  // Poll the detail endpoint while this card is expanded AND the run is
  // still running, so the tail output grows without waiting for SSE pings.
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!expanded || !isRunning) return;
    pollRef.current = setInterval(async () => {
      const detail = await onExpand(run.id);
      // Use "" (not a literal fallback) so the render-time placeholder logic
      // owns the empty-output message — otherwise a running session's
      // synthesized "Session in progress…" text gets clobbered on each poll.
      if (detail) setOutput(detail.output || "");
    }, RUNNING_OUTPUT_POLL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [expanded, isRunning, onExpand, run.id]);

  const displayName = scriptInfo?.name || run.script;
  const needsReview = !!run.reviewRequired && !reviewedAt;
  const hasArtifacts = artifacts.length > 0;
  const showReviewPane = hasArtifacts || run.reviewRequired;
  // Pull source kind (resumed/cleared) and workspace into structured chips on
  // the title row, leaving the description line as a clean cwd. Two passes:
  // splitSource first (handles both new and legacy formats), then splitWorkspace
  // on the residue.
  const { description: descAfterSource, sourceKind } = splitSource(
    run.description,
  );
  const { description: cleanedDescription, workspace } =
    splitWorkspace(descAfterSource);

  // Live running-run readouts. For running runs we prefer elapsed-since-start
  // over the stored duration (which is only written at report_end).
  const runningElapsed = isRunning ? elapsedSeconds(run.startedAt) : null;
  const progress = progressState(run.lastProgressAt);

  // Interactive sessions get "idle" instead of "stalled" when their last
  // response is >5 min old — the stronger word fits scripted hangs, not
  // expected pauses in a chat. Border behavior follows the same logic so
  // an "idle" row doesn't carry an alarming red stripe.
  const isInteractive = run.category === "interactive";
  const stalledLabel = isInteractive ? "idle" : "stalled";
  const stalledLastIso = run.lastProgressAt
    ? new Date(run.lastProgressAt).toLocaleString()
    : "";
  const heartbeatTooltip = run.lastProgressAt
    ? progress === "stalled"
      ? `${isInteractive ? "No messages exchanged" : "No activity"} for 5+ min. Last: ${stalledLastIso}`
      : progress === "slow"
        ? `Last activity 1-5 min ago. Last: ${stalledLastIso}`
        : `Active — last activity ${stalledLastIso}`
    : "";

  // Red stripe only for non-interactive stalls — interactive "idle" is expected.
  const showStallBorder =
    isRunning && progress === "stalled" && !isInteractive;

  const archivableArtifacts = artifacts.filter((a) => a.type === "task-note");

  const handleArchiveAll = async () => {
    if (archivableArtifacts.length === 0) return;
    const n = archivableArtifacts.length;
    if (!window.confirm(`Archive ${n} task note${n === 1 ? "" : "s"}?`))
      return;
    setReviewBusy(true);
    setReviewError(null);
    const failures: string[] = [];
    // Sequential: keeps error surface simple and prevents any fs races
    // between concurrent archives in the same dir.
    for (const artifact of archivableArtifacts) {
      try {
        await archiveArtifact(artifact.path);
        setArtifacts((prev) =>
          prev.filter(
            (x) => !(x.type === artifact.type && x.path === artifact.path),
          ),
        );
      } catch (err) {
        failures.push(
          `${artifact.label}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (failures.length > 0) {
      setReviewError(
        `Archived ${n - failures.length} of ${n}. Failures:\n${failures.join("\n")}`,
      );
    }
    setReviewBusy(false);
  };

  return (
    <CollapsibleRow
      open={expanded}
      onOpenChange={handleToggle}
      cardClassName={
        showStallBorder
          ? "border-l-4 border-l-red-500"
          : needsReview
            ? "border-l-4 border-l-amber-500"
            : undefined
      }
      triggerClassName="px-4 py-3 hover:bg-muted/50"
      leading={
        <>
          <CategoryGlyph
            category={run.category}
            className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0"
          />
          <StatusIcon status={run.status} />
        </>
      }
      header={
        <>
          <div className="flex items-center gap-2">
                <span
                  className="font-medium text-sm truncate"
                  title={run.customTitle ?? run.topic ?? displayName}
                >
                  {run.customTitle ??
                    (run.topic ? `“${run.topic}”` : displayName)}
                </span>
                {run.status !== "running" && (
                  <Badge
                    variant={statusVariant(run.status)}
                    className="text-xs"
                  >
                    {run.status}
                  </Badge>
                )}
                {workspace && (
                  <Badge
                    variant="outline"
                    className={`text-xs ${workspaceColor(workspace)}`}
                    title={`cmux workspace: ${workspace}`}
                  >
                    {workspace}
                  </Badge>
                )}
                {sourceKind && (
                  <Badge
                    variant="outline"
                    className="text-xs text-muted-foreground gap-1 font-normal"
                    title={
                      sourceKind === "resumed"
                        ? "Resumed from a prior session — same conversation continued"
                        : "Started after the previous session was cleared (/clear)"
                    }
                  >
                    {sourceKind === "resumed" ? (
                      <RotateCcw className="h-3 w-3" />
                    ) : (
                      <Eraser className="h-3 w-3" />
                    )}
                    {sourceKind}
                  </Badge>
                )}
                {run.exitCode !== undefined && run.exitCode !== 0 && (
                  <span className="text-xs text-muted-foreground">
                    exit {run.exitCode}
                  </span>
                )}
                {isRunning && run.lastProgressAt && (
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      progress === "fresh"
                        ? "border-green-500 text-green-600"
                        : progress === "slow"
                          ? "border-amber-500 text-amber-600"
                          : isInteractive
                            ? "border-amber-500 text-amber-600"
                            : "border-red-500 text-red-600"
                    }`}
                    title={heartbeatTooltip}
                  >
                    {progress === "stalled" ? stalledLabel : "active"} ·{" "}
                    {timeAgo(run.lastProgressAt)}
                  </Badge>
                )}
                {isRunning && !run.lastProgressAt && (
                  <span
                    className="text-xs text-muted-foreground"
                    title="No heartbeat yet — session just started, or this script doesn't report progress."
                  >
                    no heartbeat
                  </span>
                )}
                {needsReview && (
                  <Badge
                    variant="outline"
                    className="text-xs border-amber-500 text-amber-600"
                  >
                    needs review
                  </Badge>
                )}
                {hasArtifacts && (
                  <span className="text-xs text-muted-foreground">
                    {artifacts.length} artifact
                    {artifacts.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {isRunning && run.lastProgressMessage ? (
                <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">
                  {run.lastProgressMessage}
                </p>
              ) : cleanedDescription ? (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {cleanedDescription}
                </p>
              ) : scriptInfo?.description ? (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {scriptInfo.description}
                </p>
              ) : null}
              {run.outcome && (
                <p
                  className="text-xs text-muted-foreground/80 truncate mt-0.5"
                  title={run.outcome}
                >
                  → {run.outcome}
                </p>
              )}
              {(run.gitBranch || (run.tools && run.tools.total > 0)) && (
                <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                  {[
                    run.gitBranch ? `branch: ${run.gitBranch}` : null,
                    run.tools?.total
                      ? `${run.tools.total} tool${run.tools.total === 1 ? "" : "s"}`
                      : null,
                    run.tools?.edit
                      ? `${run.tools.edit} edit${run.tools.edit === 1 ? "" : "s"}`
                      : null,
                    run.tools?.subagent
                      ? `${run.tools.subagent} subagent${run.tools.subagent === 1 ? "" : "s"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
        </>
      }
      trailing={
        <>
          {runningElapsed !== null ? (
                <span
                  className="flex items-center gap-1"
                  title="Elapsed since start"
                >
                  <Clock className="h-3 w-3" />
                  {formatDuration(runningElapsed)}
                </span>
              ) : run.duration !== undefined ? (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(run.duration)}
                </span>
              ) : null}
              <span title={new Date(run.startedAt).toLocaleString()}>
                {compactTime
                  ? formatTime(run.startedAt)
                  : `${formatDate(run.startedAt)} ${formatTime(run.startedAt)}`}
              </span>
        </>
      }
    >
      <div className="border-t px-4 py-3 bg-muted/30 space-y-4">
            {loadingOutput ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader className="h-3 w-3 animate-spin" />
                Loading output...
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/80">
                  {(() => {
                    // For running enriched sessions, the .output file isn't
                    // finalized yet — but we have the topic and a live
                    // progress message. Render a synthesized placeholder so
                    // expand surfaces useful info instead of "no output captured".
                    if (output) return output;
                    const parts: string[] = [];
                    if (run.topic) parts.push(`Topic:\n${run.topic}`);
                    if (run.lastProgressMessage) {
                      parts.push(
                        `Last activity:\n${run.lastProgressMessage}`,
                      );
                    }
                    if (parts.length > 0) {
                      parts.push(
                        isRunning
                          ? "(Session in progress — output will be captured at session end.)"
                          : "(No output captured for this run.)",
                      );
                      return parts.join("\n\n");
                    }
                    return isRunning
                      ? "(Session in progress — output will be captured at session end.)"
                      : "(No output captured for this run.)";
                  })()}
                </pre>
              </div>
            )}

            {showReviewPane && (
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Review
                  </h3>
                  <div className="flex items-center gap-2">
                    {archivableArtifacts.length >= 2 && (
                      <button
                        onClick={handleArchiveAll}
                        disabled={reviewBusy}
                        className="text-xs flex items-center gap-1.5 px-3 py-1 rounded-md border hover:bg-muted disabled:opacity-50"
                        title={`Archive all ${archivableArtifacts.length} task notes`}
                      >
                        <Archive className="h-3 w-3" />
                        Archive all
                      </button>
                    )}
                    {reviewedAt && (
                      <span className="text-xs text-muted-foreground">
                        All reviewed {timeAgo(reviewedAt)}
                      </span>
                    )}
                  </div>
                </div>

                {reviewError && (
                  <pre className="text-xs text-destructive whitespace-pre-wrap break-words">
                    {reviewError}
                  </pre>
                )}

                {hasArtifacts && (
                  <div className="space-y-2">
                    {artifacts.map((a) => (
                      <ArtifactReview
                        key={`${a.type}:${a.path}`}
                        artifact={a}
                        runId={run.id}
                        onArchived={(archived) =>
                          setArtifacts((prev) =>
                            prev.filter(
                              (x) =>
                                !(
                                  x.type === archived.type &&
                                  x.path === archived.path
                                ),
                            ),
                          )
                        }
                        onReviewedChange={(updated) => {
                          setArtifacts((prev) =>
                            prev.map((x) =>
                              x.type === updated.type &&
                              x.path === updated.path
                                ? { ...x, reviewedAt: updated.reviewedAt }
                                : x,
                            ),
                          );
                          const remaining = artifacts.filter(
                            (x) =>
                              !(
                                x.type === updated.type &&
                                x.path === updated.path
                              ),
                          );
                          const allReviewed =
                            updated.reviewedAt &&
                            remaining.every((x) => !!x.reviewedAt);
                          if (allReviewed && !reviewedAt) {
                            setReviewedAt(updated.reviewedAt);
                          }
                          if (!updated.reviewedAt && reviewedAt) {
                            setReviewedAt(undefined);
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
    </CollapsibleRow>
  );
}
