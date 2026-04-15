import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import os from "os";

const app = express();
const PORT = parseInt(process.env.PORT || "7890", 10);

// Run records directory — defaults to ~/.script-runs/runs
const RUNS_DIR =
  process.env.SCRIPT_RUNS_DIR ||
  path.join(os.homedir(), ".script-runs", "runs");

app.use(cors());
app.use(express.json());

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
  const summary = runs.slice(0, limit).map(({ output, ...rest }) => rest);
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

app.listen(PORT, () => {
  console.log(`Script Dashboard API running on http://localhost:${PORT}`);
  console.log(`Reading runs from: ${RUNS_DIR}`);
});
