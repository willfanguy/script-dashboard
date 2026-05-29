import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  defaultConfig,
  type AppConfig,
  type RouteContext,
} from "./app-config.js";
import { createSse } from "./sse.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerJiraRoutes } from "./routes/jira.js";
import { sweepStaleRunning } from "./stale-runs.js";

// Re-exported so tests and tooling can import them from the entry point.
export type { AppConfig } from "./app-config.js";
export { defaultConfig } from "./app-config.js";
export type { RunRecord } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STALE_RUN_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// Per-category sweep thresholds. Interactive Claude sessions are alive across
// long idle periods (meetings, reading, lunch) and shouldn't be killed by the
// 30-min cadence that catches genuinely hung scripted jobs. 8h covers a workday
// of intermittent typing; orphans still get cleaned up within one calendar day
// if Claude Code crashes without SessionEnd.
const STALE_CATEGORY_OVERRIDES_MS: Record<string, number> = {
  interactive: 8 * 60 * 60 * 1000,
};

function runStaleSweep(config: AppConfig, broadcast: () => void): void {
  const thresholdMs = config.staleThresholdMinutes * 60 * 1000;
  const { sweptIds } = sweepStaleRunning(
    config.runsDir,
    thresholdMs,
    Date.now(),
    STALE_CATEGORY_OVERRIDES_MS,
  );
  if (sweptIds.length > 0) {
    console.log(
      `[stale-sweep] marked ${sweptIds.length} run(s) killed:`,
      sweptIds.join(", "),
    );
    broadcast();
  }
}

export interface DashboardApp {
  app: express.Express;
  broadcastUpdate: () => void;
  runStaleSweep: () => void;
}

// Wire every route over an injected config so the app holds no module-level
// filesystem globals — tests construct it against a temp runs dir, the
// standalone server constructs it from defaultConfig().
export function createApp(config: AppConfig): DashboardApp {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const sse = createSse();
  const ctx: RouteContext = { config, broadcast: sse.broadcast };

  registerRunRoutes(app, ctx);
  registerArtifactRoutes(app, ctx);
  registerJiraRoutes(app, ctx);

  app.get("/api/events", sse.handler);

  // Serve the built frontend (production). Registered after all /api routes so
  // the SPA fallback can't shadow them.
  const distDir = path.join(__dirname, "..", "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  return {
    app,
    broadcastUpdate: sse.broadcast,
    runStaleSweep: () => runStaleSweep(config, sse.broadcast),
  };
}

// --- Standalone server bootstrap (skipped when imported by tests) ---

function startServer(): void {
  const config = defaultConfig();
  const { app, broadcastUpdate, runStaleSweep: sweep } = createApp(config);
  const port = parseInt(process.env.PORT || "7890", 10);

  if (!fs.existsSync(config.runsDir)) {
    fs.mkdirSync(config.runsDir, { recursive: true });
  }

  // Watch the runs directory and broadcast SSE updates on change.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  fs.watch(config.runsDir, (_eventType, filename) => {
    if (!filename?.endsWith(".json")) return; // ignore .output / .tmp
    // Debounce: report.sh writes a .tmp then renames, so a single logical
    // update can fire multiple events.
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      broadcastUpdate();
      debounceTimer = null;
    }, 300);
  });

  app.listen(port, () => {
    console.log(`Script Dashboard API running on http://localhost:${port}`);
    console.log(`Reading runs from: ${config.runsDir}`);
    console.log(`SSE endpoint: http://localhost:${port}/api/events`);
    console.log(
      `Stale-run sweep: threshold=${config.staleThresholdMinutes}min, interval=${
        STALE_RUN_SWEEP_INTERVAL_MS / 1000
      }s`,
    );
    sweep();
    setInterval(sweep, STALE_RUN_SWEEP_INTERVAL_MS);
  });
}

// Only boot when run directly (tsx server/index.ts), not when imported by a
// test that constructs createApp with its own config.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  startServer();
}
