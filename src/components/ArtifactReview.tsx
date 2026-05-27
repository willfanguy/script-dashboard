import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Artifact,
  ArtifactDecision,
  ArtifactDetail,
  JiraTransition,
} from "@/types";
import {
  ApiError,
  archiveArtifact,
  fetchArtifact,
  fetchJiraStatusMapping,
  fetchJiraTransitions,
  markArtifactReviewed,
  normalizeJiraStatusKey,
  patchArtifact,
  pullJiraField,
  snoozeArtifact,
  transitionJiraIssue,
  unmarkArtifactReviewed,
} from "@/lib/artifacts-api";
import { timeAgo } from "@/utils/formatting";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  FileWarning,
  Archive,
  Loader,
  ExternalLink,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";

// A 404 from /api/artifacts means the file was renamed, archived elsewhere,
// or deleted after the run was recorded. The dashboard can't render the
// content but the run record's reviewed-state machine doesn't care about the
// file — Mark reviewed still clears the queue cleanly.
function isMissingFileError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

const STATUS_OPTIONS = [
  "open",
  "in-progress",
  "blocked",
  "done",
  "cancelled",
];

const PRIORITY_OPTIONS = [
  "1-urgent",
  "2-major",
  "3-medium",
  "4-minor",
  "9-none",
];

interface ArtifactReviewProps {
  artifact: Artifact;
  runId: string;
  onArchived?: (artifact: Artifact) => void;
  onReviewedChange?: (artifact: Artifact) => void;
}

export function ArtifactReview({
  artifact,
  runId,
  onArchived,
  onReviewedChange,
}: ArtifactReviewProps) {
  if (artifact.type === "task-note") {
    return (
      <TaskNoteArtifact
        artifact={artifact}
        runId={runId}
        onArchived={onArchived}
        onReviewedChange={onReviewedChange}
      />
    );
  }

  if (artifact.type === "markdown") {
    // Key on path so the component remounts with fresh state when the
    // artifact changes — avoids needing a synchronous setLoading(true) in
    // MarkdownArtifact's effect body.
    return <MarkdownArtifact key={artifact.path} artifact={artifact} />;
  }

  const href =
    artifact.type === "url"
      ? artifact.path
      : `file://${encodeURI(artifact.path)}`;

  return (
    <Card className="p-3 flex items-center gap-3 text-sm">
      <ExternalLink className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">{artifact.label}</span>
      <span className="text-xs text-muted-foreground truncate flex-1">
        {artifact.path}
      </span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-xs text-primary hover:underline"
      >
        Open
      </a>
    </Card>
  );
}

interface MarkdownArtifactProps {
  artifact: Artifact;
}

function MarkdownArtifact({ artifact }: MarkdownArtifactProps) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchArtifact(artifact.path)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
          setMissing(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (isMissingFileError(err)) {
            setMissing(true);
            setError(null);
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.path]);

  if (missing) {
    return (
      <Card className="p-3 space-y-1 border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
        <div className="flex items-center gap-2">
          <FileWarning className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="font-medium text-sm truncate flex-1">
            {artifact.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          File no longer at the recorded path (moved, renamed, or deleted).
        </p>
        <p className="text-xs font-mono text-muted-foreground break-all opacity-70">
          {artifact.path}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm truncate flex-1">
          {artifact.label}
        </span>
        <a
          href={`file://${encodeURI(artifact.path)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-muted-foreground hover:text-primary"
          title={artifact.path}
        >
          Open file
        </a>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : detail ? (
        <div className="prose prose-sm max-w-none border rounded-md bg-background px-3 py-2 max-h-[32rem] overflow-y-auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: (props) => (
                <h1
                  className="text-base font-semibold mt-2 mb-1"
                  {...props}
                />
              ),
              h2: (props) => (
                <h2
                  className="text-sm font-semibold mt-2 mb-1"
                  {...props}
                />
              ),
              h3: (props) => (
                <h3
                  className="text-xs font-semibold mt-2 mb-1 uppercase tracking-wide text-muted-foreground"
                  {...props}
                />
              ),
              p: (props) => (
                <p className="text-sm my-1" {...props} />
              ),
              ul: (props) => (
                <ul
                  className="text-sm my-1 list-disc pl-5"
                  {...props}
                />
              ),
              ol: (props) => (
                <ol
                  className="text-sm my-1 list-decimal pl-5"
                  {...props}
                />
              ),
              li: (props) => <li className="my-0.5" {...props} />,
              blockquote: (props) => (
                <blockquote
                  className="border-l-2 pl-3 my-2 italic text-muted-foreground"
                  {...props}
                />
              ),
              a: (props) => (
                <a
                  className="text-primary underline"
                  target="_blank"
                  rel="noreferrer noopener"
                  {...props}
                />
              ),
              code: (props) => (
                <code
                  className="rounded bg-muted px-1 py-0.5 text-xs"
                  {...props}
                />
              ),
              hr: (props) => (
                <hr className="my-3 border-muted" {...props} />
              ),
              strong: (props) => (
                <strong className="font-semibold" {...props} />
              ),
            }}
          >
            {detail.body}
          </ReactMarkdown>
        </div>
      ) : null}
    </Card>
  );
}

interface TaskNoteArtifactProps {
  artifact: Artifact;
  runId: string;
  onArchived?: (artifact: Artifact) => void;
  onReviewedChange?: (artifact: Artifact) => void;
}

function TaskNoteArtifact({
  artifact,
  runId,
  onArchived,
  onReviewedChange,
}: TaskNoteArtifactProps) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [archived, setArchived] = useState(false);
  const [reviewedAt, setReviewedAt] = useState<string | undefined>(
    artifact.reviewedAt,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchArtifact(artifact.path);
      setDetail(d);
      setError(null);
      setMissing(false);
    } catch (err) {
      if (isMissingFileError(err)) {
        setMissing(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [artifact.path]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPatch = async (patch: {
    status?: string;
    priority?: string;
    appendNote?: string;
  }) => {
    setSaving(true);
    try {
      const updated = await patchArtifact(artifact.path, patch);
      setDetail(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const performArchive = useCallback(async () => {
    setSaving(true);
    try {
      await archiveArtifact(artifact.path);
      setArchived(true);
      onArchived?.(artifact);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [artifact, onArchived]);

  const handleArchive = async () => {
    if (!window.confirm(`Archive "${artifact.label}"?`)) return;
    await performArchive();
  };

  const handleMarkReviewed = async () => {
    setSaving(true);
    try {
      const result = await markArtifactReviewed(runId, artifact.path);
      const ts = result.artifact.reviewedAt;
      setReviewedAt(ts);
      onReviewedChange?.({ ...artifact, reviewedAt: ts });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUnmarkReviewed = async () => {
    setSaving(true);
    try {
      await unmarkArtifactReviewed(runId, artifact.path);
      setReviewedAt(undefined);
      onReviewedChange?.({ ...artifact, reviewedAt: undefined });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (archived) {
    return (
      <Card className="p-3 text-sm text-muted-foreground flex items-center gap-2">
        <Archive className="h-4 w-4" />
        <span className="font-medium">{artifact.label}</span>
        <span>— archived</span>
      </Card>
    );
  }

  if (reviewedAt) {
    return (
      <Card className="p-3 text-sm text-muted-foreground flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <span className="font-medium">{artifact.label}</span>
        <span className="flex-1">— reviewed {timeAgo(reviewedAt)}</span>
        <button
          onClick={handleUnmarkReviewed}
          disabled={saving}
          className="text-xs flex items-center gap-1 hover:text-foreground disabled:opacity-50"
          title="Un-mark reviewed"
        >
          <RotateCcw className="h-3 w-3" />
          undo
        </button>
      </Card>
    );
  }

  // Click-through stub for files that no longer exist on disk. Archive is
  // disabled because the server-side archive endpoint would also 404; Mark
  // reviewed stays active because it only writes to the run record + the
  // suppression registry, never touches the markdown file.
  if (missing) {
    return (
      <Card className="p-4 space-y-2 border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
        <div className="flex items-center gap-2">
          <FileWarning className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="font-medium text-sm truncate flex-1">
            {artifact.label}
          </span>
          {saving && (
            <Loader className="h-3 w-3 text-muted-foreground animate-spin" />
          )}
          <button
            onClick={handleMarkReviewed}
            disabled={saving}
            className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
            title="Mark reviewed and dismiss from the queue"
          >
            <CheckCircle2 className="h-3 w-3" />
            Mark reviewed
          </button>
          <button
            disabled
            className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border opacity-50 cursor-not-allowed"
            title="Archive unavailable — file is no longer at the recorded path"
          >
            <Archive className="h-3 w-3" />
            Archive
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          File moved, renamed, or deleted since this run was recorded. Mark
          reviewed to dismiss.
        </p>
        <p className="text-xs font-mono text-muted-foreground break-all opacity-70">
          {artifact.path}
        </p>
      </Card>
    );
  }

  const status =
    typeof detail?.frontmatter.status === "string"
      ? detail.frontmatter.status
      : "";
  const priority =
    typeof detail?.frontmatter.priority === "string"
      ? detail.frontmatter.priority
      : "";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm truncate flex-1">
          {artifact.label}
        </span>
        {saving && (
          <Loader className="h-3 w-3 text-muted-foreground animate-spin" />
        )}
        <button
          onClick={handleMarkReviewed}
          disabled={saving || loading}
          className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
          title="Mark this artifact reviewed (collapses card)"
        >
          <CheckCircle2 className="h-3 w-3" />
          Mark reviewed
        </button>
        <button
          onClick={handleArchive}
          disabled={saving || loading}
          className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
          title="Move to Archive folder"
        >
          <Archive className="h-3 w-3" />
          Archive
        </button>
      </div>

      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : detail ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Status</span>
              <select
                className="rounded-md border bg-background px-2 py-0.5 text-xs"
                value={STATUS_OPTIONS.includes(status) ? status : ""}
                onChange={(e) =>
                  applyPatch({ status: e.target.value })
                }
                disabled={saving}
              >
                {!STATUS_OPTIONS.includes(status) && status && (
                  <option value="">{status} (custom)</option>
                )}
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Priority</span>
              <select
                className="rounded-md border bg-background px-2 py-0.5 text-xs"
                value={
                  PRIORITY_OPTIONS.includes(priority) ? priority : ""
                }
                onChange={(e) =>
                  applyPatch({ priority: e.target.value })
                }
                disabled={saving}
              >
                {!PRIORITY_OPTIONS.includes(priority) && priority && (
                  <option value="">{priority} (custom)</option>
                )}
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            {Array.isArray(detail.frontmatter.projects) &&
              (detail.frontmatter.projects as unknown[])
                .filter((v): v is string => typeof v === "string")
                .map((p) => (
                  <Badge key={p} variant="secondary" className="text-xs">
                    {p.replace(/^\[\[|\]\]$/g, "")}
                  </Badge>
                ))}
          </div>

          {artifact.decision && (
            <DecisionActions
              decision={artifact.decision}
              artifactPath={artifact.path}
              disabled={saving}
              onPatched={(updated) => setDetail(updated)}
              onClear={performArchive}
              onError={(msg) => setError(msg)}
            />
          )}

          <div className="prose prose-sm max-w-none border rounded-md bg-background px-3 py-2 max-h-96 overflow-y-auto">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: (props) => (
                  <h1
                    className="text-base font-semibold mt-2 mb-1"
                    {...props}
                  />
                ),
                h2: (props) => (
                  <h2
                    className="text-sm font-semibold mt-2 mb-1"
                    {...props}
                  />
                ),
                h3: (props) => (
                  <h3
                    className="text-xs font-semibold mt-2 mb-1 uppercase tracking-wide text-muted-foreground"
                    {...props}
                  />
                ),
                p: (props) => (
                  <p className="text-sm my-1" {...props} />
                ),
                ul: (props) => (
                  <ul
                    className="text-sm my-1 list-disc pl-5"
                    {...props}
                  />
                ),
                ol: (props) => (
                  <ol
                    className="text-sm my-1 list-decimal pl-5"
                    {...props}
                  />
                ),
                li: (props) => <li className="my-0.5" {...props} />,
                blockquote: (props) => (
                  <blockquote
                    className="border-l-2 pl-3 my-2 italic text-muted-foreground"
                    {...props}
                  />
                ),
                a: (props) => (
                  <a
                    className="text-primary underline"
                    target="_blank"
                    rel="noreferrer noopener"
                    {...props}
                  />
                ),
                code: (props) => (
                  <code
                    className="rounded bg-muted px-1 py-0.5 text-xs"
                    {...props}
                  />
                ),
              }}
            >
              {detail.body}
            </ReactMarkdown>
          </div>

          <form
            className="flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!noteDraft.trim()) return;
              applyPatch({ appendNote: noteDraft.trim() }).then(() =>
                setNoteDraft(""),
              );
            }}
          >
            <textarea
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm min-h-[2.5rem] resize-y"
              placeholder="Add a dated note (goes to the top of ## Notes)"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              disabled={saving}
            />
            <button
              type="submit"
              disabled={saving || !noteDraft.trim()}
              className="text-xs px-3 py-2 rounded-md border bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Add note
            </button>
          </form>
        </>
      ) : null}
    </Card>
  );
}

interface DecisionActionsProps {
  decision: ArtifactDecision;
  artifactPath: string;
  disabled: boolean;
  onPatched: (detail: ArtifactDetail) => void;
  onClear: () => void;  // archive card after successful resolution
  onError: (message: string) => void;
}

// Conditional reconciliation buttons rendered per decision kind. The action
// vocabulary is intentionally narrow: each button corresponds to one of the
// five decision kinds todo-sync emits. No "free-form" mode — if the agent
// signals a kind the dashboard doesn't know about, fall back to a single info
// label so it's at least visible.
function DecisionActions({
  decision,
  artifactPath,
  disabled,
  onPatched,
  onClear,
  onError,
}: DecisionActionsProps) {
  const [busy, setBusy] = useState(false);
  // Mapping is fetched once per session and cached client-side. We only need
  // it for the pull-status button label — failure to load is non-fatal,
  // we just show the raw JIRA status as a fallback.
  const [statusMapping, setStatusMapping] = useState<Record<string, string> | null>(
    null,
  );
  useEffect(() => {
    fetchJiraStatusMapping()
      .then((m) => setStatusMapping(m))
      .catch(() => setStatusMapping(null));
  }, []);

  const previewLocalStatus = decision.jiraStatus && statusMapping
    ? statusMapping[normalizeJiraStatusKey(decision.jiraStatus)] ?? null
    : null;

  const runAction = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );

  const isBusy = busy || disabled;

  const pullStatusFromJira = () =>
    runAction(async () => {
      const updated = await pullJiraField(
        artifactPath,
        decision.jiraKey,
        "status",
      );
      onPatched(updated);
    });

  const snoozeFor = (days: number) =>
    runAction(async () => {
      const until = new Date(Date.now() + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await snoozeArtifact(artifactPath, until);
      onClear();
    });

  return (
    <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span className="font-medium">
          {decisionTitle(decision)}
        </span>
        {decision.note && (
          <span className="text-muted-foreground/70 truncate">
            — {decision.note}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(decision.kind === "status-divergence" ||
          decision.kind === "jira-now-done") && (
          <ActionButton
            icon={<ArrowDownToLine className="h-3 w-3" />}
            label={pullButtonLabel(decision, previewLocalStatus)}
            disabled={isBusy}
            busy={busy}
            onClick={pullStatusFromJira}
          />
        )}

        {(decision.kind === "status-divergence" ||
          decision.kind === "local-ahead-of-jira" ||
          decision.kind === "local-done-jira-open") && (
          <PushToJiraButton
            jiraKey={decision.jiraKey}
            disabled={isBusy}
            onError={onError}
            onTransitioned={() => onClear()}
          />
        )}

        {decision.kind === "backlog-stale" && (
          <>
            <ActionButton
              icon={<Clock className="h-3 w-3" />}
              label="Snooze 30 days"
              disabled={isBusy}
              busy={busy}
              onClick={() => snoozeFor(30)}
            />
            <ActionButton
              icon={<Clock className="h-3 w-3" />}
              label="Snooze 90 days"
              disabled={isBusy}
              busy={busy}
              onClick={() => snoozeFor(90)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// Render the "JIRA wins" button label with the *mapped local* status when
// known — so the user sees what'll be written into the local status field
// before clicking, not the raw JIRA name.
//   - "JIRA wins (pull → in-progress)" when mapping is known
//   - "JIRA wins (pull In Progress, no local mapping)" when JIRA returned a
//     state we haven't classified — clicking still saves the snapshot but
//     leaves the local status field alone.
//   - "JIRA wins (pull status)" as the fallback when we don't yet know what
//     JIRA's current status is (decision metadata had no jiraStatus field).
function pullButtonLabel(
  decision: ArtifactDecision,
  previewLocalStatus: string | null,
): string {
  if (!decision.jiraStatus) return "JIRA wins (pull status)";
  if (previewLocalStatus) {
    return `JIRA wins (pull → ${previewLocalStatus})`;
  }
  return `JIRA wins (pull ${decision.jiraStatus}, no local mapping)`;
}

function decisionTitle(decision: ArtifactDecision): string {
  switch (decision.kind) {
    case "status-divergence":
      return `Status divergence — JIRA: ${decision.jiraStatus ?? "?"}, Local: ${decision.localStatus ?? "?"}`;
    case "local-ahead-of-jira":
      return `Local ahead of JIRA — JIRA: ${decision.jiraStatus ?? "?"}, Local: ${decision.localStatus ?? "?"}`;
    case "backlog-stale":
      return "Backlog, no sprint or due date — snooze or archive";
    case "local-done-jira-open":
      return `Local done, JIRA still open (${decision.jiraStatus ?? "?"})`;
    case "jira-now-done":
      return "JIRA closed, local still open";
    default:
      return `Decision: ${(decision as { kind: string }).kind}`;
  }
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}

function ActionButton({
  icon,
  label,
  disabled,
  busy,
  onClick,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-xs flex items-center gap-1 px-2 py-1 rounded-md border bg-background hover:bg-muted transition-colors disabled:opacity-50"
    >
      {busy ? <Loader className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </button>
  );
}

interface PushToJiraButtonProps {
  jiraKey: string;
  disabled: boolean;
  onError: (msg: string) => void;
  onTransitioned: () => void;
}

// Two-step "Local wins" / push interaction: fetch the issue's available
// transitions, render them inline as a dropdown, then POST the chosen
// transition id. Available transitions are workflow-state-dependent — we have
// to fetch them per-issue, can't precompute a static list.
function PushToJiraButton({
  jiraKey,
  disabled,
  onError,
  onTransitioned,
}: PushToJiraButtonProps) {
  const [transitions, setTransitions] = useState<JiraTransition[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadTransitions = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchJiraTransitions(jiraKey);
      setTransitions(list);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [jiraKey, onError]);

  if (transitions === null) {
    return (
      <ActionButton
        icon={<ArrowUpFromLine className="h-3 w-3" />}
        label="Push to JIRA…"
        disabled={disabled || loading}
        busy={loading}
        onClick={loadTransitions}
      />
    );
  }

  if (transitions.length === 0) {
    return (
      <span className="text-xs text-destructive">
        No transitions available for {jiraKey}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label={`JIRA transition for ${jiraKey}`}
        className="rounded-md border bg-background px-2 py-0.5 text-xs"
        defaultValue=""
        disabled={submitting || disabled}
        onChange={async (e) => {
          const id = e.target.value;
          if (!id) return;
          setSubmitting(true);
          try {
            await transitionJiraIssue(jiraKey, id);
            onTransitioned();
          } catch (err) {
            onError(err instanceof Error ? err.message : String(err));
            // Reset the select so the user can try another transition.
            e.target.value = "";
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <option value="" disabled>
          Transition to…
        </option>
        {transitions.map((t) => (
          <option key={t.id} value={t.id}>
            {t.toStatus || t.name}
          </option>
        ))}
      </select>
      {submitting && (
        <Loader className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
      <CheckCircle2
        className="h-3 w-3 text-muted-foreground/50"
        aria-hidden
      />
    </span>
  );
}
