// Shared run-record types. Mirrors the JSON shape report.sh writes and the
// frontend's src/types.ts consumes.

// Structured metadata attached to an artifact by the emitting agent. Drives the
// conditional buttons in the dashboard's review panel. Optional — agents that
// don't emit decisions render with the default edit/archive buttons.
export interface ArtifactDecision {
  kind:
    | "status-divergence" // JIRA + local disagree on status
    | "local-ahead-of-jira" // local is in-progress/done but JIRA is behind
    | "backlog-stale" // backlog + no sprint + no due date
    | "local-done-jira-open" // done locally but JIRA isn't closed
    | "jira-now-done"; // JIRA closed but local still open
  jiraKey: string;
  jiraStatus?: string;
  localStatus?: string;
  note?: string; // free-form context for the dashboard card
}

export interface Artifact {
  type: "task-note" | "file" | "url";
  label: string;
  path: string;
  decision?: ArtifactDecision;
  reviewedAt?: string;
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
}
