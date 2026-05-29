import type { Express, Response } from "express";
import type { RouteContext } from "../app-config.js";
import type { JiraClient } from "../jira.js";
import { ArtifactError, isJiraPullableField, resolveSafePath, setArtifactField, setArtifactFields } from "../artifacts.js";
import { jiraToLocalStatus } from "../jira-status-mapping.js";
import { handleArtifactError, handleJiraError } from "../http-errors.js";

// Issue keys look like ABC-123. Constrain before they reach JIRA / URL builders.
const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;

export function registerJiraRoutes(app: Express, ctx: RouteContext): void {
  const { config, broadcast } = ctx;

  function requireJira(res: Response): JiraClient | null {
    if (!config.jira) {
      res
        .status(503)
        .json({ error: "JIRA integration is not configured on this server." });
      return null;
    }
    return config.jira;
  }

  function validJiraKey(key: string, res: Response): boolean {
    if (!JIRA_KEY_PATTERN.test(key)) {
      res.status(400).json({ error: "Invalid JIRA key" });
      return false;
    }
    return true;
  }

  // GET /api/jira/:key/transitions — workflow transitions valid for this issue.
  app.get("/api/jira/:key/transitions", async (req, res) => {
    const jira = requireJira(res);
    if (!jira) return;
    if (!validJiraKey(req.params.key, res)) return;
    try {
      const transitions = await jira.listTransitions(req.params.key);
      res.json({ key: req.params.key, transitions });
    } catch (err) {
      handleJiraError(err, res);
    }
  });

  // POST /api/jira/:key/transition — apply a workflow transition by id.
  app.post("/api/jira/:key/transition", async (req, res) => {
    const jira = requireJira(res);
    if (!jira) return;
    if (!validJiraKey(req.params.key, res)) return;
    const body = (req.body ?? {}) as { transitionId?: unknown };
    if (typeof body.transitionId !== "string" || body.transitionId.length === 0) {
      res.status(400).json({ error: "transitionId (string) is required" });
      return;
    }
    try {
      await jira.transitionIssue(req.params.key, body.transitionId);
      const summary = await jira.getIssue(req.params.key);
      res.json(summary);
    } catch (err) {
      handleJiraError(err, res);
    }
  });

  // POST /api/artifacts/pull-jira?path=... — fetch a field from JIRA and write
  // it into the local Task Note. `field` is constrained to an allowlist.
  app.post("/api/artifacts/pull-jira", async (req, res) => {
    const jira = requireJira(res);
    if (!jira) return;
    try {
      const { absPath } = resolveSafePath(
        (req.query.path as string) ?? "",
        config.artifactsConfig,
      );
      const body = (req.body ?? {}) as { jiraKey?: unknown; field?: unknown };
      if (typeof body.jiraKey !== "string" || !JIRA_KEY_PATTERN.test(body.jiraKey)) {
        res.status(400).json({ error: "jiraKey is required and must look like ABC-123" });
        return;
      }
      if (typeof body.field !== "string" || !isJiraPullableField(body.field)) {
        res.status(400).json({
          error:
            "field must be one of: status, jiraStatus, sprint, jiraLabels, assignee",
        });
        return;
      }
      const summary = await jira.getIssue(body.jiraKey);

      // Two write modes:
      // - `status`: the local-taxonomy field. Map JIRA → local before writing,
      //   and refresh `jiraStatus` (raw) in the same write so they stay in sync.
      // - `jiraStatus`: raw snapshot, no mapping.
      // - everything else (sprint, labels, assignee): write verbatim.
      let updated;
      let mappingWarning: string | null = null;

      if (body.field === "status") {
        const localStatus = jiraToLocalStatus(summary.status, config.statusMapping);
        if (localStatus === null) {
          updated = setArtifactField(absPath, "jiraStatus", summary.status);
          mappingWarning = `No local mapping for JIRA status "${summary.status}". Updated jiraStatus snapshot; local status field left unchanged.`;
        } else {
          updated = setArtifactFields(absPath, {
            status: localStatus,
            jiraStatus: summary.status,
          });
        }
      } else if (body.field === "jiraStatus") {
        updated = setArtifactField(absPath, "jiraStatus", summary.status);
      } else {
        let value: unknown;
        switch (body.field) {
          case "sprint":
            value = summary.sprint ?? null;
            break;
          case "jiraLabels":
            value = summary.labels;
            break;
          case "assignee":
            value = summary.assignee ?? null;
            break;
        }
        updated = setArtifactField(absPath, body.field, value);
      }
      res.json({
        jira: summary,
        artifact: updated,
        ...(mappingWarning ? { warning: mappingWarning } : {}),
      });
      broadcast();
    } catch (err) {
      if (err instanceof ArtifactError) {
        handleArtifactError(err, res);
        return;
      }
      handleJiraError(err, res);
    }
  });

  // GET /api/jira/status-mapping — canonical JIRA → local status map so the UI
  // can preview the mapped value before the user clicks.
  app.get("/api/jira/status-mapping", (_req, res) => {
    const entries: Record<string, string> = {};
    for (const [k, v] of config.statusMapping.lookup) entries[k] = v;
    res.json({ mappings: entries });
  });
}
