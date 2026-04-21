import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  ArtifactError,
  archiveArtifact,
  loadArtifactsConfig,
  patchArtifact,
  readArtifact,
  resolveSafePath,
} from "./artifacts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "7890", 10);

// Run records directory — defaults to ~/.script-runs/runs
const RUNS_DIR =
  process.env.SCRIPT_RUNS_DIR ||
  path.join(os.homedir(), ".script-runs", "runs");

const ARTIFACTS_CONFIG = loadArtifactsConfig();

app.use(cors());
app.use(express.json());

interface Artifact {
  type: "task-note" | "file" | "url";
  label: string;
  path: string;
}

interface RunRecord {
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
}

function readRunFiles(): RunRecord[] {
  if (!fs.existsSync(RUNS_DIR)) return [];

  const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
  const runs: RunRecord[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(RUNS_DIR, file), "utf-8");
      const record = JSON.parse(raw) as RunRecord;
      runs.push(record);
    } catch {
      // Skip malformed files
    }
  }

  // Sort by start time, newest first
  runs.sort((a, b) => (b.startEpoch || 0) - (a.startEpoch || 0));
  return runs;
}

// GET /api/runs — list recent runs (without full output for performance)
app.get("/api/runs", (_req, res) => {
  const limit = parseInt((_req.query.limit as string) || "50", 10);
  const category = _req.query.category as string | undefined;

  let runs = readRunFiles();

  if (category) {
    runs = runs.filter((r) => r.category === category);
  }

  // Strip output from list view to keep the response lean
  const summary = runs.slice(0, limit).map(({ output: _output, ...rest }) => rest);
  res.json(summary);
});

// GET /api/runs/:id — get a single run with full output
app.get("/api/runs/:id", (req, res) => {
  const runFile = path.join(RUNS_DIR, `${req.params.id}.json`);

  if (!fs.existsSync(runFile)) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  try {
    const raw = fs.readFileSync(runFile, "utf-8");
    const record = JSON.parse(raw) as RunRecord;
    res.json(record);
  } catch {
    res.status(500).json({ error: "Failed to read run record" });
  }
});

// GET /api/scripts — return the known script registry
app.get("/api/scripts", (_req, res) => {
  const registryPath = path.join(__dirname, "..", "lib", "scripts.json");
  try {
    const raw = fs.readFileSync(registryPath, "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: "Failed to read script registry" });
  }
});

// DELETE /api/runs/:id — delete a run record
app.delete("/api/runs/:id", (req, res) => {
  const runFile = path.join(RUNS_DIR, `${req.params.id}.json`);
  const outputFile = path.join(RUNS_DIR, `${req.params.id}.output`);

  if (!fs.existsSync(runFile)) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  try {
    fs.unlinkSync(runFile);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: "Failed to delete run record" });
  }
});

// POST /api/runs/cleanup — delete runs older than N days
app.post("/api/runs/cleanup", (req, res) => {
  const days = parseInt(req.body.days || "7", 10);
  const cutoff = Date.now() / 1000 - days * 86400;

  const runs = readRunFiles();
  let deleted = 0;

  for (const run of runs) {
    if (run.startEpoch < cutoff && run.status !== "running") {
      const runFile = path.join(RUNS_DIR, `${run.id}.json`);
      const outputFile = path.join(RUNS_DIR, `${run.id}.output`);
      try {
        fs.unlinkSync(runFile);
        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
        deleted++;
      } catch {
        // Skip files that can't be deleted
      }
    }
  }

  res.json({ deleted, cutoffDays: days });
});

// --- Review state mutation ---

function readRunFile(id: string): RunRecord | null {
  const runFile = path.join(RUNS_DIR, `${id}.json`);
  if (!fs.existsSync(runFile)) return null;
  try {
    const raw = fs.readFileSync(runFile, "utf-8");
    return JSON.parse(raw) as RunRecord;
  } catch {
    return null;
  }
}

function writeRunFileAtomic(id: string, record: RunRecord): void {
  const runFile = path.join(RUNS_DIR, `${id}.json`);
  const tmp = `${runFile}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), "utf-8");
  fs.renameSync(tmp, runFile);
}

app.post("/api/runs/:id/reviewed", (req, res) => {
  const record = readRunFile(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  record.reviewedAt = new Date().toISOString();
  try {
    writeRunFileAtomic(req.params.id, record);
    res.json(record);
  } catch (err) {
    console.error(`[reviewed] failed to write run ${req.params.id}:`, err);
    res.status(500).json({ error: "Failed to write run record" });
  }
});

app.delete("/api/runs/:id/reviewed", (req, res) => {
  const record = readRunFile(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  delete record.reviewedAt;
  try {
    writeRunFileAtomic(req.params.id, record);
    res.json(record);
  } catch (err) {
    console.error(`[unreviewed] failed to write run ${req.params.id}:`, err);
    res.status(500).json({ error: "Failed to write run record" });
  }
});

// --- Artifact endpoints ---

function handleArtifactError(
  err: unknown,
  res: import("express").Response,
): void {
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

app.get("/api/artifacts", (req, res) => {
  try {
    const { absPath } = resolveSafePath(
      (req.query.path as string) ?? "",
      ARTIFACTS_CONFIG,
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
      ARTIFACTS_CONFIG,
    );
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = patchArtifact(absPath, {
      status:
        typeof body.status === "string" ? body.status : undefined,
      priority:
        typeof body.priority === "string" ? body.priority : undefined,
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
      ARTIFACTS_CONFIG,
    );
    const result = archiveArtifact(absPath, root);
    res.json(result);
    // Inform any listening clients so the artifact disappears from the UI.
    broadcastUpdate();
  } catch (err) {
    handleArtifactError(err, res);
  }
});

// --- Server-Sent Events for live updates ---

const sseClients = new Set<import("express").Response>();

app.get("/api/events", (_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":\n\n"); // SSE comment to establish connection

  sseClients.add(res);
  _req.on("close", () => sseClients.delete(res));
});

function broadcastUpdate() {
  const data = JSON.stringify({ type: "update", timestamp: Date.now() });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// Watch the runs directory for changes
if (!fs.existsSync(RUNS_DIR)) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
fs.watch(RUNS_DIR, (_eventType, filename) => {
  // Only react to JSON file changes (ignore .output and .tmp files)
  if (!filename?.endsWith(".json")) return;

  // Debounce: report.sh writes a .tmp then renames, so we may get
  // multiple events in quick succession for a single logical update
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    broadcastUpdate();
    debounceTimer = null;
  }, 300);
});

// Serve the built frontend (production). Registered after all /api routes so
// the SPA fallback can't shadow them.
const distDir = path.join(__dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Script Dashboard API running on http://localhost:${PORT}`);
  console.log(`Reading runs from: ${RUNS_DIR}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/api/events`);
});
