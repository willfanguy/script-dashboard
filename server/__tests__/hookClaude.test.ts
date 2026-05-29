import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Exercises the Claude Code lifecycle hooks end-to-end (session-start → stop →
// session-end) against a temp runs dir + a fake transcript. Guards the shared
// hook-claude-common.sh helpers all three hooks now depend on.

const LIB = path.resolve(__dirname, "../../lib");
const START = path.join(LIB, "hook-claude-session-start.sh");
const STOP = path.join(LIB, "hook-claude-stop.sh");
const END = path.join(LIB, "hook-claude-session-end.sh");

const HAS_JQ = (() => {
  try {
    execFileSync("jq", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let tmp: string;
let runsDir: string;
let transcript: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-hooks-"));
  runsDir = path.join(tmp, "runs");
  fs.mkdirSync(runsDir);
  transcript = path.join(tmp, "transcript.jsonl");
  fs.writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "last-prompt", lastPrompt: "refactor the dashboard" }),
      JSON.stringify({ type: "custom-title", customTitle: "Dashboard refactor" }),
      JSON.stringify({ type: "attachment", gitBranch: "refactor/x" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash" }, { type: "text", text: "All done." }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit" }] },
      }),
    ].join("\n") + "\n",
  );
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function hook(script: string, payload: object): void {
  execFileSync("bash", [script], {
    input: JSON.stringify(payload),
    env: { ...process.env, SCRIPT_RUNS_DIR: runsDir, SCRIPT_DASH_NOTIFY: "0" },
    stdio: ["pipe", "ignore", "pipe"],
  });
}

function bridgePath(sessionId: string): string {
  return path.join(tmp, ".claude-sessions", `${sessionId}.runid`);
}

function runidFor(sessionId: string): string {
  return JSON.parse(fs.readFileSync(bridgePath(sessionId), "utf-8")).runid;
}

function recordByRunId(runid: string): Record<string, any> {
  return JSON.parse(
    fs.readFileSync(path.join(runsDir, `${runid}.json`), "utf-8"),
  );
}

describe.skipIf(!HAS_JQ)("Claude lifecycle hooks", () => {
  const SID = "sess-abc";

  it("opens an interactive running record and writes a JSON bridge", () => {
    hook(START, {
      session_id: SID,
      cwd: "/repo",
      source: "startup",
      transcript_path: transcript,
    });
    const r = recordByRunId(runidFor(SID));
    expect(r.status).toBe("running");
    expect(r.category).toBe("interactive");
  });

  it("heartbeats and pulls topic + custom title on Stop", () => {
    hook(START, { session_id: SID, cwd: "/repo", transcript_path: transcript });
    hook(STOP, { session_id: SID });
    const r = recordByRunId(runidFor(SID));
    expect(r.topic).toBe("refactor the dashboard");
    expect(r.customTitle).toBe("Dashboard refactor");
    expect(typeof r.lastProgressAt).toBe("string");
    expect(r.status).toBe("running"); // heartbeat must not finalize
  });

  it("finalizes with enrichment and removes the bridge on SessionEnd", () => {
    hook(START, { session_id: SID, cwd: "/repo", transcript_path: transcript });
    const runid = runidFor(SID); // capture before SessionEnd removes the bridge
    hook(END, { session_id: SID, reason: "exit" });
    const r = recordByRunId(runid);
    expect(r.status).toBe("success");
    expect(r.gitBranch).toBe("refactor/x");
    expect(r.tools).toEqual({ total: 2, bash: 1, edit: 1, subagent: 0 });
    expect(fs.existsSync(bridgePath(SID))).toBe(false);
  });

  it("is a silent no-op when no bridge exists (untracked session)", () => {
    // Stop/End for a session that never had a SessionStart must not throw.
    expect(() => hook(STOP, { session_id: "never-started" })).not.toThrow();
    expect(() => hook(END, { session_id: "never-started" })).not.toThrow();
  });
});
