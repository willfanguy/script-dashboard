import type { Response } from "express";
import { ArtifactError } from "./artifacts.js";
import { JiraError } from "./jira.js";

// Map an ArtifactError to its HTTP status; anything else is a 500. Shared by
// the artifact routes and the JIRA pull-jira route (which can throw either).
export function handleArtifactError(err: unknown, res: Response): void {
  if (err instanceof ArtifactError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[artifacts] internal error:", err);
  res.status(500).json({
    error: "Internal error",
    detail: err instanceof Error ? err.message : String(err),
  });
}

export function handleJiraError(err: unknown, res: Response): void {
  if (err instanceof JiraError) {
    res.status(err.status).json({ error: err.message, detail: err.detail });
    return;
  }
  console.error("[jira] internal error:", err);
  res.status(500).json({
    error: "Internal error",
    detail: err instanceof Error ? err.message : String(err),
  });
}
