import type { Express } from "express";
import type { RouteContext } from "../app-config.js";
import {
  archiveArtifact,
  patchArtifact,
  readArtifact,
  resolveSafePath,
  snoozeArtifact,
} from "../artifacts.js";
import { addSuppression } from "../suppression.js";
import { handleArtifactError } from "../http-errors.js";

export function registerArtifactRoutes(app: Express, ctx: RouteContext): void {
  const { config, broadcast } = ctx;

  app.get("/api/artifacts", (req, res) => {
    try {
      const { absPath } = resolveSafePath(
        (req.query.path as string) ?? "",
        config.artifactsConfig,
      );
      res.json(readArtifact(absPath));
    } catch (err) {
      handleArtifactError(err, res);
    }
  });

  app.patch("/api/artifacts", (req, res) => {
    try {
      const { absPath } = resolveSafePath(
        (req.query.path as string) ?? "",
        config.artifactsConfig,
      );
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = patchArtifact(absPath, {
        status: typeof body.status === "string" ? body.status : undefined,
        priority: typeof body.priority === "string" ? body.priority : undefined,
        appendNote:
          typeof body.appendNote === "string" ? body.appendNote : undefined,
      });
      res.json(updated);
    } catch (err) {
      handleArtifactError(err, res);
    }
  });

  app.post("/api/artifacts/archive", (req, res) => {
    try {
      const { absPath, root } = resolveSafePath(
        (req.query.path as string) ?? "",
        config.artifactsConfig,
      );
      const result = archiveArtifact(absPath, root);
      // Suppress BOTH the original and post-archive paths. Original handles run
      // records that still reference the pre-archive location; new handles
      // agents (like todo-sync Phase 1.5) that scan the archive folder and
      // would otherwise re-emit the moved file under its new path.
      const now = new Date().toISOString();
      addSuppression(config.suppressedFile, result.originalPath, {
        reason: "archived",
        suppressedAt: now,
      });
      if (result.newPath !== result.originalPath) {
        addSuppression(config.suppressedFile, result.newPath, {
          reason: "archived",
          suppressedAt: now,
        });
      }
      res.json(result);
      broadcast(); // make the artifact disappear from listening clients
    } catch (err) {
      handleArtifactError(err, res);
    }
  });

  // POST /api/artifacts/snooze?path=... — add `sync-mute-until` so the next
  // todo-sync run skips this note until the date passes.
  app.post("/api/artifacts/snooze", (req, res) => {
    try {
      const { absPath } = resolveSafePath(
        (req.query.path as string) ?? "",
        config.artifactsConfig,
      );
      const body = (req.body ?? {}) as { untilDate?: unknown };
      if (typeof body.untilDate !== "string") {
        res.status(400).json({ error: "untilDate (YYYY-MM-DD) is required" });
        return;
      }
      const updated = snoozeArtifact(absPath, body.untilDate);
      res.json(updated);
      broadcast();
    } catch (err) {
      handleArtifactError(err, res);
    }
  });
}
