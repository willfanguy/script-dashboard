import type {
  Artifact,
  ArtifactDetail,
  ArtifactPatch,
  JiraTransition,
  RunRecord,
} from "@/types";

// Carries the HTTP status code on the error so callers can distinguish 404
// (file moved/deleted — render a click-through stub) from other failures.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function fetchArtifact(
  path: string,
): Promise<ArtifactDetail> {
  const res = await fetch(
    `/api/artifacts?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function patchArtifact(
  path: string,
  patch: ArtifactPatch,
): Promise<ArtifactDetail> {
  const res = await fetch(
    `/api/artifacts?path=${encodeURIComponent(path)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function archiveArtifact(
  path: string,
): Promise<{ originalPath: string; newPath: string }> {
  const res = await fetch(
    `/api/artifacts/archive?path=${encodeURIComponent(path)}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- JIRA reconciliation actions ---

// Canonical JIRA → local status mapping. Loaded once and cached for the
// session — the file backing this on the server is read at startup, so
// callers don't need to re-fetch.
let cachedStatusMapping: Record<string, string> | null = null;

// Test-only: lets each test start with a clean fetch ledger so call-count
// assertions stay deterministic regardless of run order.
export function __resetStatusMappingCacheForTests(): void {
  cachedStatusMapping = null;
}

export function normalizeJiraStatusKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function fetchJiraStatusMapping(): Promise<Record<string, string>> {
  if (cachedStatusMapping) return cachedStatusMapping;
  const res = await fetch("/api/jira/status-mapping");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { mappings: Record<string, string> };
  cachedStatusMapping = data.mappings;
  return cachedStatusMapping;
}

// Pull a JIRA-derived field (status, sprint, assignee, labels) into the local
// Task Note. Server does the JIRA fetch + write atomically so the dashboard
// never has to handle JIRA creds.
export async function pullJiraField(
  path: string,
  jiraKey: string,
  field: "status" | "jiraStatus" | "sprint" | "jiraLabels" | "assignee",
): Promise<ArtifactDetail> {
  const res = await fetch(
    `/api/artifacts/pull-jira?path=${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jiraKey, field }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { artifact: ArtifactDetail };
  return data.artifact;
}

export async function fetchJiraTransitions(
  jiraKey: string,
): Promise<JiraTransition[]> {
  const res = await fetch(
    `/api/jira/${encodeURIComponent(jiraKey)}/transitions`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { transitions: JiraTransition[] };
  return data.transitions;
}

export async function transitionJiraIssue(
  jiraKey: string,
  transitionId: string,
): Promise<void> {
  const res = await fetch(
    `/api/jira/${encodeURIComponent(jiraKey)}/transition`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transitionId }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

export async function snoozeArtifact(
  path: string,
  untilDate: string,
): Promise<ArtifactDetail> {
  const res = await fetch(
    `/api/artifacts/snooze?path=${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ untilDate }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function markRunReviewed(
  runId: string,
): Promise<RunRecord> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/reviewed`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function unmarkRunReviewed(
  runId: string,
): Promise<RunRecord> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/reviewed`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function markArtifactReviewed(
  runId: string,
  artifactPath: string,
): Promise<{ artifact: Artifact; run: RunRecord }> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/artifacts/reviewed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: artifactPath }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function unmarkArtifactReviewed(
  runId: string,
  artifactPath: string,
): Promise<{ artifact: Artifact; run: RunRecord }> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/artifacts/reviewed`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: artifactPath }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}
