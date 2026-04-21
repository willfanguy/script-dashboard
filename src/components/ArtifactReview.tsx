import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact, ArtifactDetail } from "@/types";
import {
  archiveArtifact,
  fetchArtifact,
  patchArtifact,
} from "@/lib/artifacts-api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Archive, Loader, ExternalLink } from "lucide-react";

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
  onArchived?: (artifact: Artifact) => void;
}

export function ArtifactReview({
  artifact,
  onArchived,
}: ArtifactReviewProps) {
  if (artifact.type === "task-note") {
    return (
      <TaskNoteArtifact artifact={artifact} onArchived={onArchived} />
    );
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

interface TaskNoteArtifactProps {
  artifact: Artifact;
  onArchived?: (artifact: Artifact) => void;
}

function TaskNoteArtifact({
  artifact,
  onArchived,
}: TaskNoteArtifactProps) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [archived, setArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchArtifact(artifact.path);
      setDetail(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  const handleArchive = async () => {
    if (!window.confirm(`Archive "${artifact.label}"?`)) return;
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
