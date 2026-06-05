import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import os from "os";
import { createApp, type AppConfig, type RunRecord } from "../index.js";

// Endpoint-level tests against a createApp instance pointed at a temp runs dir.
// These pin the behavior the upcoming route-module split must preserve.

let runsDir: string;
let suppressedFile: string;
let app: import("express").Express;

function makeConfig(): AppConfig {
  return {
    runsDir,
    suppressedFile,
    artifactsConfig: { artifactRoots: [] },
    jira: null,
    statusMapping: { lookup: new Map() },
    staleThresholdMinutes: 30,
  };
}

function writeRun(rec: Partial<RunRecord> & { id: string }): void {
  const full: RunRecord = {
    script: rec.id.split("-")[0],
    category: "manual",
    status: "success",
    startedAt: "2026-05-29T00:00:00Z",
    startEpoch: 1_780_000_000,
    ...rec,
  } as RunRecord;
  fs.writeFileSync(
    path.join(runsDir, `${rec.id}.json`),
    JSON.stringify(full, null, 2),
  );
}

function readRun(id: string): RunRecord {
  return JSON.parse(
    fs.readFileSync(path.join(runsDir, `${id}.json`), "utf-8"),
  );
}

beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-api-"));
  runsDir = path.join(tmp, "runs");
  fs.mkdirSync(runsDir);
  suppressedFile = path.join(tmp, ".suppressed.json");
  app = createApp(makeConfig()).app;
});
afterEach(() => {
  fs.rmSync(path.dirname(runsDir), { recursive: true, force: true });
});

describe("GET /api/runs", () => {
  it("lists runs newest-first and strips output from the list view", async () => {
    writeRun({ id: "a-1", startEpoch: 100, output: "secret-a" });
    writeRun({ id: "b-2", startEpoch: 200, output: "secret-b" });
    const res = await request(app).get("/api/runs").expect(200);
    expect(res.body.map((r: RunRecord) => r.id)).toEqual(["b-2", "a-1"]);
    expect(res.body[0]).not.toHaveProperty("output");
  });

  it("respects ?limit and ?category", async () => {
    writeRun({ id: "s-1", startEpoch: 100, category: "scheduled" });
    writeRun({ id: "m-2", startEpoch: 200, category: "manual" });
    writeRun({ id: "m-3", startEpoch: 300, category: "manual" });
    const limited = await request(app).get("/api/runs?limit=1").expect(200);
    expect(limited.body).toHaveLength(1);
    const filtered = await request(app)
      .get("/api/runs?category=manual")
      .expect(200);
    expect(filtered.body.every((r: RunRecord) => r.category === "manual")).toBe(
      true,
    );
    expect(filtered.body).toHaveLength(2);
  });

  it("returns [] when the runs dir is empty", async () => {
    const res = await request(app).get("/api/runs").expect(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns the full record with output", async () => {
    writeRun({ id: "x-1", output: "full output here" });
    const res = await request(app).get("/api/runs/x-1").expect(200);
    expect(res.body.output).toBe("full output here");
  });

  it("404s for a missing run", async () => {
    await request(app).get("/api/runs/nope-1").expect(404);
  });

  it("rejects a path-traversal id with 400", async () => {
    // Express decodes %2f; the param guard must still reject the result.
    await request(app).get("/api/runs/..%2f..%2fetc%2fpasswd").expect(400);
  });

  it("stitches the live .output tail for a running run", async () => {
    writeRun({ id: "live-1", status: "running" });
    fs.writeFileSync(path.join(runsDir, "live-1.output"), "streaming tail");
    const res = await request(app).get("/api/runs/live-1").expect(200);
    expect(res.body.output).toBe("streaming tail");
  });
});

describe("DELETE /api/runs/:id", () => {
  it("deletes the record and its output file", async () => {
    writeRun({ id: "del-1" });
    fs.writeFileSync(path.join(runsDir, "del-1.output"), "x");
    await request(app).delete("/api/runs/del-1").expect(200);
    expect(fs.existsSync(path.join(runsDir, "del-1.json"))).toBe(false);
    expect(fs.existsSync(path.join(runsDir, "del-1.output"))).toBe(false);
  });

  it("404s for a missing run", async () => {
    await request(app).delete("/api/runs/nope-1").expect(404);
  });
});

describe("POST /api/runs/cleanup", () => {
  const dayAgo = (n: number) => Math.floor(Date.now() / 1000) - n * 86400;

  it("prunes old success vs failed by different cutoffs and never touches running", async () => {
    writeRun({ id: "old-success", status: "success", startEpoch: dayAgo(10) }); // > 7d
    writeRun({ id: "new-success", status: "success", startEpoch: dayAgo(2) }); // < 7d
    writeRun({ id: "old-failed", status: "failed", startEpoch: dayAgo(40) }); // > 30d
    writeRun({ id: "mid-failed", status: "failed", startEpoch: dayAgo(10) }); // < 30d
    writeRun({ id: "old-running", status: "running", startEpoch: dayAgo(99) }); // never

    const res = await request(app).post("/api/runs/cleanup").send({}).expect(200);
    expect(res.body.deletedCompleted).toBe(1);
    expect(res.body.deletedFailed).toBe(1);

    const remaining = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
    expect(remaining.sort()).toEqual([
      "mid-failed.json",
      "new-success.json",
      "old-running.json",
    ]);
  });

  it("rejects negative day counts with 400", async () => {
    await request(app)
      .post("/api/runs/cleanup")
      .send({ completedDays: -1 })
      .expect(400);
  });
});

describe("review state", () => {
  it("sets and clears run-level reviewedAt", async () => {
    writeRun({ id: "r-1" });
    await request(app).post("/api/runs/r-1/reviewed").expect(200);
    expect(readRun("r-1").reviewedAt).toBeTruthy();
    await request(app).delete("/api/runs/r-1/reviewed").expect(200);
    expect(readRun("r-1").reviewedAt).toBeUndefined();
  });

  it("marks an artifact reviewed, writes suppression, and rolls up the run", async () => {
    writeRun({
      id: "rev-1",
      reviewRequired: true,
      artifacts: [{ type: "task-note", label: "Note", path: "/vault/note.md" }],
    });
    const res = await request(app)
      .post("/api/runs/rev-1/artifacts/reviewed")
      .send({ path: "/vault/note.md" })
      .expect(200);
    expect(res.body.artifact.reviewedAt).toBeTruthy();
    // Single artifact reviewed → run rolls up to reviewed.
    expect(readRun("rev-1").reviewedAt).toBeTruthy();
    // Suppression registry records the reviewed path.
    const reg = JSON.parse(fs.readFileSync(suppressedFile, "utf-8"));
    expect(reg["/vault/note.md"]?.reason).toBe("reviewed");
  });

  it("does NOT roll up the run until every artifact is reviewed", async () => {
    writeRun({
      id: "rev-2",
      reviewRequired: true,
      artifacts: [
        { type: "task-note", label: "A", path: "/vault/a.md" },
        { type: "task-note", label: "B", path: "/vault/b.md" },
      ],
    });
    await request(app)
      .post("/api/runs/rev-2/artifacts/reviewed")
      .send({ path: "/vault/a.md" })
      .expect(200);
    expect(readRun("rev-2").reviewedAt).toBeUndefined(); // B still unreviewed
    await request(app)
      .post("/api/runs/rev-2/artifacts/reviewed")
      .send({ path: "/vault/b.md" })
      .expect(200);
    expect(readRun("rev-2").reviewedAt).toBeTruthy();
  });

  it("400s with no path, 404s for an unknown artifact", async () => {
    writeRun({ id: "rev-3", artifacts: [] });
    await request(app).post("/api/runs/rev-3/artifacts/reviewed").send({}).expect(400);
    await request(app)
      .post("/api/runs/rev-3/artifacts/reviewed")
      .send({ path: "/nope.md" })
      .expect(404);
  });
});

describe("suppression filtering on GET", () => {
  it("drops a suppressed-unreviewed artifact from a DIFFERENT run", async () => {
    // Run-1 emitted note.md and it was reviewed there (suppressed). The entry
    // carries the fingerprint of a decision-less artifact ("").
    fs.writeFileSync(
      suppressedFile,
      JSON.stringify({
        "/vault/shared.md": {
          reason: "reviewed",
          suppressedAt: "x",
          fingerprint: "",
        },
      }),
    );
    // Run-2 re-emits the same path (same "" fingerprint) without a reviewedAt →
    // should be filtered.
    writeRun({
      id: "run2-1",
      reviewRequired: true,
      artifacts: [{ type: "task-note", label: "Shared", path: "/vault/shared.md" }],
    });
    const res = await request(app).get("/api/runs/run2-1").expect(200);
    expect(res.body.artifacts).toEqual([]);
  });
});

describe("unified review rollup (read projection)", () => {
  it("projects reviewedAt when the only artifact was suppressed elsewhere", async () => {
    fs.writeFileSync(
      suppressedFile,
      JSON.stringify({
        "/vault/gone.md": { reason: "archived", suppressedAt: "x" },
      }),
    );
    writeRun({
      id: "allsupp-1",
      reviewRequired: true,
      artifacts: [{ type: "task-note", label: "Gone", path: "/vault/gone.md" }],
    });
    const res = await request(app).get("/api/runs/allsupp-1").expect(200);
    expect(res.body.artifacts).toEqual([]); // suppressed away
    expect(res.body.reviewedAt).toBeTruthy(); // ...but the run clears the queue
  });

  it("does NOT auto-review a run that never emitted artifacts", async () => {
    writeRun({ id: "noart-1", reviewRequired: true });
    const res = await request(app).get("/api/runs/noart-1").expect(200);
    expect(res.body.reviewedAt).toBeUndefined();
  });

  it("projects a STABLE reviewedAt across reads (not a fresh Date each time)", async () => {
    fs.writeFileSync(
      suppressedFile,
      JSON.stringify({
        "/vault/gone.md": { reason: "archived", suppressedAt: "x" },
      }),
    );
    writeRun({
      id: "stable-1",
      reviewRequired: true,
      startedAt: "2026-05-29T00:00:00Z",
      artifacts: [{ type: "task-note", label: "Gone", path: "/vault/gone.md" }],
    });
    const first = await request(app).get("/api/runs/stable-1").expect(200);
    const second = await request(app).get("/api/runs/stable-1").expect(200);
    expect(first.body.reviewedAt).toBeTruthy();
    // The bug this guards: projecting Date.now() reset the timestamp per read.
    expect(second.body.reviewedAt).toBe(first.body.reviewedAt);
  });
});

describe("fingerprint-aware suppression (state-change re-surfacing)", () => {
  // Regression for the SM-817 class: an item reviewed at one JIRA state stayed
  // muted forever even after JIRA moved to a new, materially different state.
  it("re-surfaces a reviewed divergence when the JIRA state later changes", async () => {
    fs.writeFileSync(
      suppressedFile,
      JSON.stringify({
        "/vault/SM-817.md": {
          reason: "reviewed",
          suppressedAt: "x",
          fingerprint: "status-divergence|In Progress|blocked",
        },
      }),
    );
    // A later run re-emits the same path, but JIRA has moved to Done.
    writeRun({
      id: "fp-1",
      reviewRequired: true,
      artifacts: [
        {
          type: "task-note",
          label: "SM-817",
          path: "/vault/SM-817.md",
          decision: {
            kind: "status-divergence",
            jiraKey: "SM-817",
            jiraStatus: "Done",
            localStatus: "blocked",
          },
        },
      ],
    });
    const res = await request(app).get("/api/runs/fp-1").expect(200);
    expect(res.body.artifacts).toHaveLength(1); // state changed → NOT suppressed
    expect(res.body.reviewedAt).toBeUndefined(); // run is back in the queue
  });

  it("keeps suppressing when the reviewed state is unchanged", async () => {
    fs.writeFileSync(
      suppressedFile,
      JSON.stringify({
        "/vault/SM-609.md": {
          reason: "reviewed",
          suppressedAt: "x",
          fingerprint: "status-divergence|In Progress|blocked",
        },
      }),
    );
    writeRun({
      id: "fp-2",
      reviewRequired: true,
      artifacts: [
        {
          type: "task-note",
          label: "SM-609",
          path: "/vault/SM-609.md",
          decision: {
            kind: "status-divergence",
            jiraKey: "SM-609",
            jiraStatus: "In Progress",
            localStatus: "blocked",
          },
        },
      ],
    });
    const res = await request(app).get("/api/runs/fp-2").expect(200);
    expect(res.body.artifacts).toEqual([]); // identical state → still muted
  });

  it("treats legacy entries (no fingerprint) as inert so they re-surface once", async () => {
    fs.writeFileSync(
      suppressedFile,
      JSON.stringify({
        // Pre-fingerprint entry — written by the old indefinite-mute code.
        "/vault/legacy.md": { reason: "reviewed", suppressedAt: "x" },
      }),
    );
    writeRun({
      id: "fp-3",
      reviewRequired: true,
      artifacts: [
        {
          type: "task-note",
          label: "Legacy",
          path: "/vault/legacy.md",
          decision: {
            kind: "status-divergence",
            jiraKey: "X",
            jiraStatus: "Done",
            localStatus: "open",
          },
        },
      ],
    });
    const res = await request(app).get("/api/runs/fp-3").expect(200);
    expect(res.body.artifacts).toHaveLength(1); // legacy mute no longer hides it
  });

  it("stores the decision fingerprint when an artifact is reviewed", async () => {
    writeRun({
      id: "fp-4",
      reviewRequired: true,
      artifacts: [
        {
          type: "task-note",
          label: "N",
          path: "/vault/n.md",
          decision: {
            kind: "status-divergence",
            jiraKey: "N",
            jiraStatus: "Done",
            localStatus: "open",
          },
        },
      ],
    });
    await request(app)
      .post("/api/runs/fp-4/artifacts/reviewed")
      .send({ path: "/vault/n.md" })
      .expect(200);
    const reg = JSON.parse(fs.readFileSync(suppressedFile, "utf-8"));
    expect(reg["/vault/n.md"].fingerprint).toBe("status-divergence|Done|open");
  });

  it("still suppresses archived items by path (archive has no undo)", async () => {
    fs.writeFileSync(
      suppressedFile,
      JSON.stringify({
        "/vault/arch.md": { reason: "archived", suppressedAt: "x" },
      }),
    );
    writeRun({
      id: "fp-5",
      reviewRequired: true,
      artifacts: [
        { type: "task-note", label: "Arch", path: "/vault/arch.md" },
      ],
    });
    const res = await request(app).get("/api/runs/fp-5").expect(200);
    expect(res.body.artifacts).toEqual([]); // archived → muted regardless of fingerprint
  });
});

describe("JIRA endpoints without configuration", () => {
  it("503s when JIRA is not configured", async () => {
    await request(app).get("/api/jira/ABC-1/transitions").expect(503);
    await request(app)
      .post("/api/artifacts/pull-jira?path=/x.md")
      .send({ jiraKey: "ABC-1", field: "status" })
      .expect(503);
  });

  it("serves the (empty) status mapping", async () => {
    const res = await request(app).get("/api/jira/status-mapping").expect(200);
    expect(res.body).toEqual({ mappings: {} });
  });
});

describe("artifact endpoints with no configured roots", () => {
  it("rejects reads outside any root", async () => {
    const res = await request(app).get("/api/artifacts?path=/etc/passwd");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
