import fs from "fs";
import path from "path";

// Minimal shape we need to sweep — kept independent of the full RunRecord type
// in index.ts so this module stays free of server-internal imports.
interface StaleCandidate {
  id: string;
  script?: string;
  status?: string;
  startedAt?: string;
  startEpoch?: number;
  lastProgressAt?: string;
}

export interface SweepResult {
  sweptIds: string[];
  scanned: number;
}

function parseIsoEpoch(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function writeJsonAtomic(file: string, record: unknown): void {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

// Scan RUNS_DIR for runs stuck in "running" past the threshold and mark them
// killed. Activity is measured by lastProgressAt when present, otherwise by
// startedAt. Runs swept get an explanatory `output` and a duration computed
// from their last-known activity (not from now) — a run that stalled 10 min
// after starting should show duration=10m, not duration=thresholdElapsed.
export function sweepStaleRunning(
  runsDir: string,
  thresholdMs: number,
  nowMs: number = Date.now(),
): SweepResult {
  if (!fs.existsSync(runsDir)) return { sweptIds: [], scanned: 0 };

  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  const sweptIds: string[] = [];
  const thresholdSec = Math.floor(thresholdMs / 1000);
  const nowSec = Math.floor(nowMs / 1000);

  for (const file of files) {
    const full = path.join(runsDir, file);
    let record: StaleCandidate & Record<string, unknown>;
    try {
      record = JSON.parse(fs.readFileSync(full, "utf-8"));
    } catch {
      continue;
    }

    if (record.status !== "running") continue;

    const progressEpoch = parseIsoEpoch(record.lastProgressAt);
    const startEpoch =
      typeof record.startEpoch === "number"
        ? record.startEpoch
        : parseIsoEpoch(record.startedAt);
    const lastActivityEpoch = progressEpoch ?? startEpoch;
    if (lastActivityEpoch == null) continue;

    const idleSec = nowSec - lastActivityEpoch;
    if (idleSec < thresholdSec) continue;

    const duration =
      startEpoch != null ? Math.max(0, lastActivityEpoch - startEpoch) : 0;
    const idleMinutes = Math.round(idleSec / 60);
    const reason = record.lastProgressAt
      ? `Marked killed by server sweep: no progress for ${idleMinutes} min`
      : `Marked killed by server sweep: no start-to-end report for ${idleMinutes} min`;

    record.status = "killed";
    record.exitCode = record.exitCode ?? 124;
    record.endEpoch = lastActivityEpoch;
    record.endedAt = new Date(lastActivityEpoch * 1000).toISOString();
    record.duration = duration;
    const existingOutput =
      typeof record.output === "string" ? record.output : "";
    record.output = existingOutput
      ? `${existingOutput}\n${reason}`
      : reason;

    try {
      writeJsonAtomic(full, record);
      if (typeof record.id === "string") sweptIds.push(record.id);
    } catch {
      // Leave the record alone if we can't persist the change.
    }
  }

  return { sweptIds, scanned: files.length };
}
