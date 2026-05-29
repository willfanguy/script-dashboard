import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// These tests run the REAL shell library against a temp runs dir and assert the
// JSON it writes is valid and round-trips hostile input. They reproduce the
// silent-data-loss bug where unescaped id/script/category/host fields in the
// old heredoc produced invalid JSON that the server's JSON.parse dropped.

const LIB = path.resolve(__dirname, "../../lib");
const REPORT_SH = path.join(LIB, "report.sh");
const SKILL_START = path.join(LIB, "report-skill-start.sh");
const SKILL_END = path.join(LIB, "report-skill-end.sh");

// zsh is Will's shell and the site of the past `status` read-only collision, so
// we cover it — but skip when absent (e.g. a Linux CI runner) rather than fail.
const HAS_ZSH = (() => {
  try {
    execFileSync("zsh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// Quotes, backslash, ampersand, dollar, space, newline, tab, unicode — every
// character class that broke the heredoc or would word-split unquoted.
const HOSTILE_NAME = 'evil"name \\back & $x';
const HOSTILE_DESC = 'line1 "q"\nline2 ☃ \\ end\ttab';

let runsDir: string;

beforeEach(() => {
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-report-sh-"));
});
afterEach(() => {
  fs.rmSync(runsDir, { recursive: true, force: true });
});

function sh(
  shell: string,
  snippet: string,
  extraEnv: Record<string, string> = {},
): string {
  return execFileSync(shell, ["-c", snippet], {
    env: {
      ...process.env,
      SCRIPT_RUNS_DIR: runsDir,
      SCRIPT_DASH_NOTIFY: "0",
      ...extraEnv,
    },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readSoleRecord(): Record<string, unknown> {
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  expect(files).toHaveLength(1);
  // JSON.parse throwing here IS the failure the old code caused.
  return JSON.parse(fs.readFileSync(path.join(runsDir, files[0]), "utf-8"));
}

describe("report.sh record writing", () => {
  it("writes valid JSON when fields contain quotes/backslashes/unicode (bash)", () => {
    sh(
      "bash",
      `source "${REPORT_SH}"; report_start "$N" "$C" "$D"; report_log "out line"; report_end 0`,
      { N: HOSTILE_NAME, C: "interactive", D: HOSTILE_DESC },
    );
    const r = readSoleRecord();
    expect(r.script).toBe(HOSTILE_NAME);
    expect(r.category).toBe("interactive");
    expect(r.description).toBe(HOSTILE_DESC);
    expect(r.status).toBe("success");
    expect(r.exitCode).toBe(0);
    expect(typeof r.host).toBe("string");
    expect(typeof r.startEpoch).toBe("number");
    expect(r.output).toContain("out line");
  });

  it.skipIf(!HAS_ZSH)(
    "writes valid JSON under zsh (guards the `status` read-only collision)",
    () => {
      sh(
        "zsh",
        `source "${REPORT_SH}"; report_start "$N" scheduled "$D"; report_progress "halfway"; report_end 143`,
        { N: HOSTILE_NAME, D: HOSTILE_DESC },
      );
      const r = readSoleRecord();
      expect(r.script).toBe(HOSTILE_NAME);
      expect(r.status).toBe("killed"); // 143 = SIGTERM
      expect(r.lastProgressMessage).toBe("halfway");
    },
  );

  it("coerces a non-numeric exit code to a failure instead of crashing", () => {
    sh(
      "bash",
      `source "${REPORT_SH}"; report_start x manual ""; report_end "not-a-number"`,
    );
    const r = readSoleRecord();
    expect(r.status).toBe("failed");
    expect(r.exitCode).toBe(1);
  });

  it("round-trips artifacts with special characters", () => {
    sh(
      "bash",
      `source "${REPORT_SH}"; report_start n manual ""; report_review_required; report_artifact task-note "$L" "$P"; report_end 0`,
      { L: 'lbl "z" ☃ & \\x', P: "/tmp/a b/c.md" },
    );
    const r = readSoleRecord();
    expect(r.reviewRequired).toBe(true);
    expect(r.artifacts).toEqual([
      { type: "task-note", label: 'lbl "z" ☃ & \\x', path: "/tmp/a b/c.md" },
    ]);
  });
});

describe("report-skill-start.sh / report-skill-end.sh", () => {
  it("preserves a multiline description through rehydration", () => {
    const runId = sh("bash", `bash "${SKILL_START}" "$N" "$D"`, {
      N: 'my "skill"',
      D: HOSTILE_DESC,
    }).trim();
    sh(
      "bash",
      `bash "${SKILL_END}" "$RID" "$S" --review --artifact task-note "$L" "$P" --exit-code 0`,
      { RID: runId, S: 'summary "q" ☃', L: "lbl", P: "/tmp/x.md" },
    );
    const r = JSON.parse(
      fs.readFileSync(path.join(runsDir, `${runId}.json`), "utf-8"),
    );
    expect(r.description).toBe(HOSTILE_DESC);
    expect(r.status).toBe("success");
    expect(r.reviewRequired).toBe(true);
    expect(r.output).toContain('summary "q" ☃');
  });

  it("rejects a non-numeric --exit-code", () => {
    const runId = sh("bash", `bash "${SKILL_START}" n d`).trim();
    expect(() =>
      sh("bash", `bash "${SKILL_END}" "$RID" summary --exit-code foo`, {
        RID: runId,
      }),
    ).toThrow();
  });
});
