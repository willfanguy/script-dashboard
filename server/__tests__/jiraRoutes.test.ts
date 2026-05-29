import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import os from "os";
import { createApp, type AppConfig } from "../index.js";
import type {
  JiraClient,
  JiraIssueSummary,
  JiraTransition,
} from "../jira.js";

let tmp: string;
let vaultRoot: string;
let archiveRoot: string;
let runsDir: string;
let suppressedFile: string;
let notePath: string;
let jira: JiraClient;

beforeEach(() => {
  // realpath so macOS /var → /private/var symlinks don't break containment.
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sd-jira-")));
  vaultRoot = path.join(tmp, "vault");
  archiveRoot = path.join(tmp, "archive");
  runsDir = path.join(tmp, "runs");
  fs.mkdirSync(vaultRoot);
  fs.mkdirSync(archiveRoot);
  fs.mkdirSync(runsDir);
  suppressedFile = path.join(tmp, ".suppressed.json");
  notePath = path.join(vaultRoot, "SM-1.md");
  fs.writeFileSync(notePath, "---\nstatus: open\n---\n\nbody\n");

  jira = {
    getIssue: vi.fn(
      async (key: string): Promise<JiraIssueSummary> => ({
        key,
        status: "In Progress",
        statusCategory: "indeterminate",
        labels: ["backend"],
        sprint: "Sprint 5",
      }),
    ),
    listTransitions: vi.fn(
      async (): Promise<JiraTransition[]> => [
        { id: "21", name: "Done", toStatus: "Done" },
      ],
    ),
    transitionIssue: vi.fn(async () => {}),
  };
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeApp(statusMapping = { lookup: new Map<string, string>() }) {
  const config: AppConfig = {
    runsDir,
    suppressedFile,
    artifactsConfig: { artifactRoots: [{ root: vaultRoot, archive: archiveRoot }] },
    jira,
    statusMapping,
    staleThresholdMinutes: 30,
  };
  return createApp(config).app;
}

const pullUrl = () =>
  `/api/artifacts/pull-jira?path=${encodeURIComponent(notePath)}`;

describe("JIRA transition routes", () => {
  it("lists transitions for a valid key", async () => {
    const res = await request(makeApp())
      .get("/api/jira/SM-1/transitions")
      .expect(200);
    expect(res.body.transitions).toEqual([
      { id: "21", name: "Done", toStatus: "Done" },
    ]);
    expect(jira.listTransitions).toHaveBeenCalledWith("SM-1");
  });

  it("rejects a malformed key with 400 and never calls JIRA", async () => {
    await request(makeApp()).get("/api/jira/not-a-key/transitions").expect(400);
    expect(jira.listTransitions).not.toHaveBeenCalled();
  });

  it("applies a transition then returns the refreshed issue", async () => {
    const res = await request(makeApp())
      .post("/api/jira/SM-1/transition")
      .send({ transitionId: "21" })
      .expect(200);
    expect(jira.transitionIssue).toHaveBeenCalledWith("SM-1", "21");
    expect(res.body.key).toBe("SM-1");
  });

  it("400s a transition with no transitionId", async () => {
    await request(makeApp())
      .post("/api/jira/SM-1/transition")
      .send({})
      .expect(400);
    expect(jira.transitionIssue).not.toHaveBeenCalled();
  });
});

describe("pull-jira", () => {
  it("writes the raw jiraStatus snapshot into the note", async () => {
    const res = await request(makeApp())
      .post(pullUrl())
      .send({ jiraKey: "SM-1", field: "jiraStatus" })
      .expect(200);
    expect(res.body.jira.status).toBe("In Progress");
    expect(fs.readFileSync(notePath, "utf-8")).toMatch(
      /jiraStatus:\s*['"]?In Progress['"]?/,
    );
  });

  it("on an unmappable status: writes the snapshot, warns, and leaves local status untouched", async () => {
    // Empty mapping → jiraToLocalStatus returns null → snapshot-only branch.
    const res = await request(makeApp())
      .post(pullUrl())
      .send({ jiraKey: "SM-1", field: "status" })
      .expect(200);
    expect(res.body.warning).toMatch(/No local mapping/);
    const after = fs.readFileSync(notePath, "utf-8");
    expect(after).toMatch(/jiraStatus:\s*['"]?In Progress['"]?/);
    expect(after).toMatch(/status:\s*open/); // local taxonomy field untouched
  });

  it("rejects an unknown field with 400", async () => {
    await request(makeApp())
      .post(pullUrl())
      .send({ jiraKey: "SM-1", field: "bogus" })
      .expect(400);
    expect(jira.getIssue).not.toHaveBeenCalled();
  });

  it("rejects a malformed jiraKey with 400", async () => {
    await request(makeApp())
      .post(pullUrl())
      .send({ jiraKey: "lowercase", field: "jiraStatus" })
      .expect(400);
  });

  it("503s when JIRA is not configured", async () => {
    const config: AppConfig = {
      runsDir,
      suppressedFile,
      artifactsConfig: { artifactRoots: [{ root: vaultRoot, archive: archiveRoot }] },
      jira: null,
      statusMapping: { lookup: new Map() },
      staleThresholdMinutes: 30,
    };
    await request(createApp(config).app)
      .post(pullUrl())
      .send({ jiraKey: "SM-1", field: "jiraStatus" })
      .expect(503);
  });
});
