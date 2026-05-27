// Minimal JIRA REST v3 client for the reconciliation actions the dashboard
// exposes. Scope is deliberately narrow: read an issue's status + sprint, list
// available transitions, and apply a transition by id. Nothing else.
//
// JIRA's workflow model requires transitions to be applied by *transition id*,
// not by target status name — and those IDs vary per project workflow. So
// "move ticket X to In Progress" is actually a two-step call: GET /transitions
// to find the transition whose target status name matches, then POST
// /transitions with that id.

import type { JiraConfig } from "./artifacts.js";

export class JiraError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export interface JiraIssueSummary {
  key: string;
  status: string;       // e.g. "In Progress"
  statusCategory: string; // e.g. "indeterminate" — useful for done/not-done UX
  assignee?: string;    // displayName, or undefined if unassigned
  sprint?: string;      // active sprint name if any
  labels: string[];
}

export interface JiraTransition {
  id: string;
  name: string;       // transition name, e.g. "Start Progress"
  toStatus: string;   // target status name, e.g. "In Progress"
}

// Allow tests to inject a stub fetch. Defaults to the global fetch.
export type FetchFn = typeof globalThis.fetch;

export interface JiraClient {
  getIssue(key: string): Promise<JiraIssueSummary>;
  listTransitions(key: string): Promise<JiraTransition[]>;
  transitionIssue(key: string, transitionId: string): Promise<void>;
}

export function createJiraClient(
  config: JiraConfig,
  fetchImpl: FetchFn = globalThis.fetch,
): JiraClient {
  // Normalize trailing slash here too — parseJiraBlock does it for
  // config-file callers, but direct callers (like tests) might pass a raw URL.
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const auth =
    "Basic " +
    Buffer.from(`${config.username}:${config.apiToken}`).toString("base64");
  const headers = {
    Authorization: auth,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function request(
    method: string,
    pathSegment: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${baseUrl}${pathSegment}`;
    const res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      // 401/403 are auth/permission. 404 is wrong key. 4xx anything else is
      // a transition-not-valid kind of error — surface JIRA's detail.
      const message =
        extractErrorMessage(parsed) || `JIRA ${method} ${pathSegment} ${res.status}`;
      throw new JiraError(res.status, message, parsed);
    }
    return parsed;
  }

  return {
    async getIssue(key: string): Promise<JiraIssueSummary> {
      // Limit returned fields — JIRA's default response includes hundreds of
      // fields and rendered HTML. We only need status/assignee/labels/sprint.
      const fields = "status,assignee,labels,customfield_10020";
      const data = (await request(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`,
      )) as RawIssue;
      return projectIssue(data);
    },

    async listTransitions(key: string): Promise<JiraTransition[]> {
      const data = (await request(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
      )) as { transitions?: RawTransition[] };
      const raw = data.transitions ?? [];
      return raw.map((t) => ({
        id: t.id,
        name: t.name,
        toStatus: t.to?.name ?? "",
      }));
    },

    async transitionIssue(key: string, transitionId: string): Promise<void> {
      await request(
        "POST",
        `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
        { transition: { id: transitionId } },
      );
    },
  };
}

interface RawIssue {
  key: string;
  fields?: {
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string } | null;
    labels?: string[];
    // Sprint customfield key varies per JIRA instance — Glassdoor's is the
    // common Atlassian default 10020 (array of sprint blobs). If a different
    // tenant ever needs another id, make this configurable.
    customfield_10020?: Array<{ name?: string; state?: string }> | null;
  };
}

interface RawTransition {
  id: string;
  name: string;
  to?: { name?: string };
}

function projectIssue(data: RawIssue): JiraIssueSummary {
  const sprints = data.fields?.customfield_10020 ?? [];
  const activeSprint = sprints.find((s) => s?.state === "active");
  return {
    key: data.key,
    status: data.fields?.status?.name ?? "",
    statusCategory: data.fields?.status?.statusCategory?.key ?? "",
    assignee: data.fields?.assignee?.displayName,
    sprint: activeSprint?.name,
    labels: data.fields?.labels ?? [],
  };
}

function extractErrorMessage(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as {
    errorMessages?: unknown;
    errors?: Record<string, unknown>;
    message?: unknown;
  };
  if (Array.isArray(p.errorMessages) && p.errorMessages.length > 0) {
    return p.errorMessages.filter((x) => typeof x === "string").join("; ");
  }
  if (p.errors && typeof p.errors === "object") {
    const parts = Object.entries(p.errors)
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => `${k}: ${v as string}`);
    if (parts.length > 0) return parts.join("; ");
  }
  if (typeof p.message === "string") return p.message;
  return null;
}
