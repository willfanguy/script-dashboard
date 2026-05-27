import { describe, it, expect, vi } from "vitest";
import { createJiraClient, JiraError, type FetchFn } from "../jira.js";

const CONFIG = {
  baseUrl: "https://example.atlassian.net",
  username: "user@example.com",
  apiToken: "tkn",
};

function mockFetch(handler: FetchFn): FetchFn {
  return vi.fn(handler);
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function emptyResponse(status = 204): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => "",
  } as unknown as Response;
}

describe("createJiraClient — auth header", () => {
  it("sends Basic auth derived from username + apiToken", async () => {
    const fetch = mockFetch(async (_url, init) => {
      const headers = (init as { headers: Record<string, string> }).headers;
      const expected =
        "Basic " + Buffer.from("user@example.com:tkn").toString("base64");
      expect(headers.Authorization).toBe(expected);
      return jsonResponse({ key: "ABC-1", fields: {} });
    });
    const client = createJiraClient(CONFIG, fetch);
    await client.getIssue("ABC-1");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("strips trailing slash from baseUrl when concatenating", async () => {
    const seenUrls: string[] = [];
    const fetch = mockFetch(async (url) => {
      seenUrls.push(String(url));
      return jsonResponse({ key: "ABC-1", fields: {} });
    });
    const client = createJiraClient(
      { ...CONFIG, baseUrl: "https://example.atlassian.net/" },
      fetch,
    );
    // createJiraClient should have normalized — but trust isn't enough,
    // verify the URL we actually send doesn't double-slash before /rest/.
    await client.getIssue("ABC-1");
    expect(seenUrls[0]).toMatch(/^https:\/\/example\.atlassian\.net\/rest\//);
    expect(seenUrls[0]).not.toMatch(/\/\/rest\//);
  });
});

describe("getIssue — projection from raw response", () => {
  it("flattens status, assignee, sprint, labels", async () => {
    const raw = {
      key: "SM-609",
      fields: {
        status: {
          name: "In Progress",
          statusCategory: { key: "indeterminate" },
        },
        assignee: { displayName: "Will Fanguy" },
        labels: ["ai", "prompt"],
        customfield_10020: [
          { name: "Sprint 23", state: "closed" },
          { name: "Sprint 24", state: "active" },
        ],
      },
    };
    const client = createJiraClient(
      CONFIG,
      mockFetch(async () => jsonResponse(raw)),
    );
    const issue = await client.getIssue("SM-609");
    expect(issue).toEqual({
      key: "SM-609",
      status: "In Progress",
      statusCategory: "indeterminate",
      assignee: "Will Fanguy",
      sprint: "Sprint 24",
      labels: ["ai", "prompt"],
    });
  });

  it("handles missing optional fields without throwing", async () => {
    const raw = { key: "MS-1", fields: {} };
    const client = createJiraClient(
      CONFIG,
      mockFetch(async () => jsonResponse(raw)),
    );
    const issue = await client.getIssue("MS-1");
    expect(issue.status).toBe("");
    expect(issue.assignee).toBeUndefined();
    expect(issue.sprint).toBeUndefined();
    expect(issue.labels).toEqual([]);
  });

  it("returns no sprint when none are active (even if closed sprints exist)", async () => {
    const raw = {
      key: "AIF-9",
      fields: {
        customfield_10020: [
          { name: "Sprint 22", state: "closed" },
          { name: "Sprint 21", state: "closed" },
        ],
      },
    };
    const client = createJiraClient(
      CONFIG,
      mockFetch(async () => jsonResponse(raw)),
    );
    const issue = await client.getIssue("AIF-9");
    expect(issue.sprint).toBeUndefined();
  });
});

describe("listTransitions", () => {
  it("projects to {id, name, toStatus}", async () => {
    const raw = {
      transitions: [
        { id: "11", name: "Start Progress", to: { name: "In Progress" } },
        { id: "21", name: "Resolve", to: { name: "Done" } },
        { id: "31", name: "No-target" }, // missing `to`
      ],
    };
    const client = createJiraClient(
      CONFIG,
      mockFetch(async () => jsonResponse(raw)),
    );
    const transitions = await client.listTransitions("SM-609");
    expect(transitions).toEqual([
      { id: "11", name: "Start Progress", toStatus: "In Progress" },
      { id: "21", name: "Resolve", toStatus: "Done" },
      { id: "31", name: "No-target", toStatus: "" },
    ]);
  });

  it("returns empty array when JIRA returns no transitions block", async () => {
    const client = createJiraClient(
      CONFIG,
      mockFetch(async () => jsonResponse({})),
    );
    const transitions = await client.listTransitions("ABC-1");
    expect(transitions).toEqual([]);
  });
});

describe("transitionIssue", () => {
  it("POSTs the transition id and tolerates a 204 response", async () => {
    let capturedInit: unknown = null;
    const fetch = mockFetch(async (_url, init) => {
      capturedInit = init;
      return emptyResponse(204);
    });
    const client = createJiraClient(CONFIG, fetch);
    await client.transitionIssue("SM-609", "21");

    expect((capturedInit as { method: string }).method).toBe("POST");
    const body = JSON.parse((capturedInit as { body: string }).body);
    expect(body).toEqual({ transition: { id: "21" } });
  });
});

describe("error mapping", () => {
  it("throws JiraError with JIRA's errorMessages joined", async () => {
    const client = createJiraClient(
      CONFIG,
      mockFetch(async () =>
        jsonResponse(
          { errorMessages: ["Issue does not exist or you don't have permission"] },
          false,
          404,
        ),
      ),
    );
    await expect(client.getIssue("XXX-999")).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("does not exist"),
    });
  });

  it("throws JiraError with field-level errors when present", async () => {
    const client = createJiraClient(
      CONFIG,
      mockFetch(async () =>
        jsonResponse({ errors: { transition: "Invalid id" } }, false, 400),
      ),
    );
    let caught: unknown;
    try {
      await client.transitionIssue("SM-1", "999");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(JiraError);
    const err = caught as JiraError;
    expect(err.status).toBe(400);
    expect(err.message).toContain("transition");
  });

  it("falls back to a generic message when JIRA returns nothing useful", async () => {
    const client = createJiraClient(
      CONFIG,
      mockFetch(async () => jsonResponse({}, false, 500)),
    );
    await expect(client.getIssue("ABC-1")).rejects.toMatchObject({
      status: 500,
    });
  });
});
