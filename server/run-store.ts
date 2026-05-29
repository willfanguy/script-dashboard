import fs from "fs";
import path from "path";
import { atomicWriteJson } from "./fs-utils.js";
import type { RunRecord } from "./types.js";

// Run-record filesystem access. All run JSON lives flat in runsDir as
// `${id}.json`, with a sibling `${id}.output` capture file while running.

// Cap live-output responses so an unbounded log can't blow up the JSON payload.
// Matches the 100KB tail truncation that report.sh applies at end-of-run.
export const LIVE_OUTPUT_TAIL_BYTES = 102_400;

export function readRunFiles(runsDir: string): RunRecord[] {
  if (!fs.existsSync(runsDir)) return [];
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  const runs: RunRecord[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(runsDir, file), "utf-8");
      runs.push(JSON.parse(raw) as RunRecord);
    } catch {
      // Skip malformed files
    }
  }
  // Sort by start time, newest first.
  runs.sort((a, b) => (b.startEpoch || 0) - (a.startEpoch || 0));
  return runs;
}

export function readRunFile(runsDir: string, id: string): RunRecord | null {
  const runFile = path.join(runsDir, `${id}.json`);
  if (!fs.existsSync(runFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(runFile, "utf-8")) as RunRecord;
  } catch {
    return null;
  }
}

export function writeRunFileAtomic(
  runsDir: string,
  id: string,
  record: RunRecord,
): void {
  atomicWriteJson(path.join(runsDir, `${id}.json`), record);
}

// Read the tail of a running run's live .output file (the final output is
// folded into the JSON once the run ends). Returns null when there's no file.
export function readLiveOutputTail(runsDir: string, id: string): string | null {
  const outputFile = path.join(runsDir, `${id}.output`);
  if (!fs.existsSync(outputFile)) return null;
  try {
    const stat = fs.statSync(outputFile);
    if (stat.size === 0) return "";
    const start = Math.max(0, stat.size - LIVE_OUTPUT_TAIL_BYTES);
    const fd = fs.openSync(outputFile, "r");
    try {
      const len = stat.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      return buf.toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
