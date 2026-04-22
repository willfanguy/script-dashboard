import { useEffect, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  ChevronRight,
  Clock,
  Check,
  RotateCcw,
  Archive,
} from "lucide-react";
import { ArtifactReview } from "@/components/ArtifactReview";
import {
  archiveArtifact,
  markRunReviewed,
  unmarkRunReviewed,
} from "@/lib/artifacts-api";

interface RunCardProps {
  run: RunRecord;
  scriptInfo?: ScriptInfo;
  onExpand: (id: string) => Promise<RunRecord | null>;
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

export function RunCard({ run, scriptInfo, onExpand }: RunCardProps) {
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

  const isRunning = run.status === "running";

  const handleToggle = async () => {
    if (!expanded && output === null) {
      setLoadingOutput(true);
      const detail = await onExpand(run.id);
      setOutput(detail?.output || "(no output captured)");
      setLoadingOutput(false);
    }
    setExpanded(!expanded);
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
      if (detail) setOutput(detail.output || "(no output captured)");
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

  // Live running-run readouts. For running runs we prefer elapsed-since-start
  // over the stored duration (which is only written at report_end).
  const runningElapsed = isRunning ? elapsedSeconds(run.startedAt) : null;
  const progress = progressState(run.lastProgressAt);
  const showStallBorder = isRunning && progress === "stalled";

  const handleMarkReviewed = async () => {
    setReviewBusy(true);
    setReviewError(null);
    try {
      const updated = await markRunReviewed(run.id);
      setReviewedAt(updated.reviewedAt);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewBusy(false);
    }
  };

  const handleUnmarkReviewed = async () => {
    setReviewBusy(true);
    setReviewError(null);
    try {
      await unmarkRunReviewed(run.id);
      setReviewedAt(undefined);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewBusy(false);
    }
  };

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
    <Collapsible open={expanded} onOpenChange={handleToggle}>
      <Card
        className={`p-0 overflow-hidden ${
          showStallBorder
            ? "border-l-4 border-l-amber-500"
            : needsReview
              ? "border-l-4 border-l-amber-500"
              : ""
        }`}
      >
        <CollapsibleTrigger className="w-full cursor-pointer">
          <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
            <StatusIcon status={run.status} />

            <div className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">
                  {displayName}
                </span>
                <Badge variant={statusVariant(run.status)} className="text-xs">
                  {run.status}
                </Badge>
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
                          : "border-red-500 text-red-600"
                    }`}
                    title={`Last progress: ${new Date(run.lastProgressAt).toLocaleString()}`}
                  >
                    {progress === "stalled" ? "stalled" : "active"} ·{" "}
                    {timeAgo(run.lastProgressAt)}
                  </Badge>
                )}
                {isRunning && !run.lastProgressAt && (
                  <span
                    className="text-xs text-muted-foreground"
                    title="Script has not reported progress yet (uses report_log only, or no reporting)"
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
              ) : scriptInfo?.description ? (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {scriptInfo.description}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
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
                {formatDate(run.startedAt)} {formatTime(run.startedAt)}
              </span>
              <span className="text-muted-foreground/60">
                {timeAgo(run.startedAt)}
              </span>
              <ChevronRight
                className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t px-4 py-3 bg-muted/30 space-y-4">
            {loadingOutput ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader className="h-3 w-3 animate-spin" />
                Loading output...
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/80">
                  {output}
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
                    {run.reviewRequired && !reviewedAt && (
                      <button
                        onClick={handleMarkReviewed}
                        disabled={reviewBusy}
                        className="text-xs flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" />
                        Mark reviewed
                      </button>
                    )}
                    {reviewedAt && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Reviewed {timeAgo(reviewedAt)}</span>
                        <button
                          onClick={handleUnmarkReviewed}
                          disabled={reviewBusy}
                          className="flex items-center gap-1 hover:text-foreground"
                          title="Un-mark reviewed"
                        >
                          <RotateCcw className="h-3 w-3" />
                          undo
                        </button>
                      </div>
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
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
