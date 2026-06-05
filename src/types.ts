// `note` is the observations-sink type agents emit via `--artifact note ...`:
// a markdown checklist of things the run noticed but didn't act on. Rendered
// inline (like `markdown`) with a Mark-reviewed control so the run can clear
// the Needs Review queue.
export type ArtifactType = "task-note" | "markdown" | "file" | "url" | "note";

// Reconciliation context attached by todo-sync (and any future agent that
// produces decisions vs. just new artifacts). Drives the conditional action
// buttons in ArtifactReview.
export type ArtifactDecisionKind =
  | "status-divergence"
  | "local-ahead-of-jira"
  | "backlog-stale"
  | "local-done-jira-open"
  | "jira-now-done";

export interface ArtifactDecision {
  kind: ArtifactDecisionKind;
  jiraKey: string;
  jiraStatus?: string;
  localStatus?: string;
  note?: string;
}

export interface Artifact {
  type: ArtifactType;
  label: string;
  path: string;
  decision?: ArtifactDecision;
  reviewedAt?: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  toStatus: string;
}

export interface RunRecord {
  id: string;
  script: string;
  category: string;
  description?: string;
  status: "running" | "success" | "failed" | "killed";
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
  startEpoch: number;
  endEpoch?: number;
  duration?: number;
  pid?: number;
  host?: string;
  output?: string;
  artifacts?: Artifact[];
  reviewRequired?: boolean;
  reviewedAt?: string;
  lastProgressAt?: string;
  lastProgressMessage?: string;
  // Interactive-session enrichment, populated by hook-claude-session-end.sh
  // from the Claude Code JSONL transcript. Optional and best-effort — older
  // records simply lack these fields.
  topic?: string;
  outcome?: string;
  // Claude Code's auto-generated (or user-renamed) conversation title.
  // Refined throughout the session — UI displays the latest value as the
  // primary identity (preferred over `topic` because it's tighter).
  customTitle?: string;
  gitBranch?: string;
  tools?: {
    total: number;
    bash?: number;
    edit?: number;
    subagent?: number;
  };
}

export interface ArtifactDetail {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ArtifactPatch {
  status?: string;
  priority?: string;
  appendNote?: string;
}

export interface ScriptInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  schedule?: string;
}

export interface ScriptRegistry {
  scripts: ScriptInfo[];
  categories: Record<string, { label: string; description: string }>;
}
