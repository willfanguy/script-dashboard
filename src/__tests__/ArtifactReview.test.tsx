// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ArtifactReview } from "@/components/ArtifactReview";
import { __resetStatusMappingCacheForTests } from "@/lib/artifacts-api";
import type { Artifact, ArtifactDetail } from "@/types";

// Minimal Artifact fixtures
const TASK_ARTIFACT: Artifact = {
  type: "task-note",
  label: "Follow up - Jane",
  path: "/vault/Tasks/Follow up - Jane.md",
};

const URL_ARTIFACT: Artifact = {
  type: "url",
  label: "Linear ticket",
  path: "https://linear.app/abc/issue/FOO-42",
};

const SAMPLE_DETAIL: ArtifactDetail = {
  path: TASK_ARTIFACT.path,
  frontmatter: {
    title: "Follow up — Jane",
    status: "open",
    priority: "3-medium",
    projects: ["[[SuperFit]]"],
  },
  body: "## Description\n\nTest body.\n\n## Notes\n\n",
};

// Vitest doesn't auto-reset between tests — we stub fetch per test.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  // Status mapping is cached at module level once successfully fetched. Reset
  // it so each test's mocked fetch sees the same call sequence regardless of
  // the order tests run in.
  __resetStatusMappingCacheForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetchResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

describe("ArtifactReview — task-note", () => {
  it("renders a loading state before the artifact fetch resolves", () => {
    // Delayed fetch: never resolves during this test
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="test-run-1" />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it("renders frontmatter controls and markdown body after fetch resolves", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));

    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="test-run-1" />);

    // Description heading from the markdown body
    expect(await screen.findByText("Description")).toBeTruthy();

    // Status select reflects current value
    const statusSelect = screen.getByLabelText(/Status/i) as HTMLSelectElement;
    expect(statusSelect.value).toBe("open");

    // Priority select reflects current value
    const prioritySelect = screen.getByLabelText(/Priority/i) as HTMLSelectElement;
    expect(prioritySelect.value).toBe("3-medium");

    // Project chip rendered with WikiLink brackets stripped
    expect(screen.getByText("SuperFit")).toBeTruthy();
  });

  it("PATCHes the artifact when status changes", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        ...SAMPLE_DETAIL,
        frontmatter: { ...SAMPLE_DETAIL.frontmatter, status: "done" },
      }),
    );

    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="test-run-1" />);
    const statusSelect = (await screen.findByLabelText(
      /Status/i,
    )) as HTMLSelectElement;

    fireEvent.change(statusSelect, { target: { value: "done" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [, patchCall] = fetchMock.mock.calls;
    expect(String(patchCall[0])).toContain("/api/artifacts?path=");
    expect(patchCall[1]?.method).toBe("PATCH");
    expect(String(patchCall[1]?.body)).toContain('"status":"done"');
  });

  it("surfaces an error when the initial fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockFetchResponse({ error: "boom" }, false, 500),
    );

    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="test-run-1" />);
    expect(await screen.findByText(/boom/)).toBeTruthy();
  });

  it("enables the Add note button only when the textarea has content", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));

    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="test-run-1" />);
    const textarea = (await screen.findByPlaceholderText(
      /Add a dated note/,
    )) as HTMLTextAreaElement;
    const button = screen.getByRole("button", { name: /Add note/i });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: "a note" } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ArtifactReview — decision actions", () => {
  function decisionArtifact(
    decision: Artifact["decision"],
  ): Artifact {
    return {
      type: "task-note",
      label: "SM-609 — divergent",
      path: "/vault/Tasks/SM-609.md",
      decision,
    };
  }

  it("renders no decision panel when artifact has no decision", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="test-run-1" />);
    await screen.findByText("Description");
    expect(
      screen.queryByRole("button", { name: /Push to JIRA/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /JIRA wins/i }),
    ).toBeNull();
  });

  it("status-divergence renders BOTH pull and push buttons", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockFetchResponse({ mappings: { inprogress: "in-progress" } }),
    );
    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "status-divergence",
          jiraKey: "SM-609",
          jiraStatus: "In Progress",
          localStatus: "blocked",
        })}
      runId="test-run-1"
      />,
    );
    await screen.findByText("Description");
    expect(screen.getByRole("button", { name: /JIRA wins/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Push to JIRA/i })).toBeTruthy();
    // Title surfaces both sides of the conflict
    expect(screen.getByText(/JIRA: In Progress, Local: blocked/)).toBeTruthy();
  });

  it("pull-status button label previews the MAPPED local status, not raw JIRA", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    // Status mapping fetch fires after detail load.
    vi.mocked(fetch).mockResolvedValueOnce(
      mockFetchResponse({
        mappings: { inprogress: "in-progress", readyforqa: "ready-for-qa" },
      }),
    );
    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "status-divergence",
          jiraKey: "SM-609",
          jiraStatus: "In Progress",
          localStatus: "blocked",
        })}
      runId="test-run-1"
      />,
    );
    // Wait for both fetches + state update before asserting label.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /pull → in-progress/i }),
      ).toBeTruthy();
    });
    // Importantly: the button does NOT read "pull In Progress" — that was the
    // bug we caught (would clobber local taxonomy with JIRA's casing).
    expect(
      screen.queryByRole("button", { name: /pull In Progress\b/i }),
    ).toBeNull();
  });

  it("pull-status button warns when JIRA returned an unmapped state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockFetchResponse({ mappings: { inprogress: "in-progress" } }),
    );
    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "jira-now-done",
          jiraKey: "AIF-99",
          jiraStatus: "Frobnicating",
        })}
      runId="test-run-1"
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /pull Frobnicating, no local mapping/i,
        }),
      ).toBeTruthy();
    });
  });

  it("local-ahead-of-jira renders only Push (no pull)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockFetchResponse({ mappings: {} }),
    );
    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "local-ahead-of-jira",
          jiraKey: "SM-685",
          jiraStatus: "Backlog",
          localStatus: "in-progress",
        })}
      runId="test-run-1"
      />,
    );
    await screen.findByText("Description");
    expect(screen.queryByRole("button", { name: /JIRA wins/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Push to JIRA/i })).toBeTruthy();
  });

  it("backlog-stale renders snooze buttons (no JIRA buttons)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockFetchResponse({ mappings: {} }),
    );
    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "backlog-stale",
          jiraKey: "AIF-749",
        })}
      runId="test-run-1"
      />,
    );
    await screen.findByText("Description");
    expect(screen.queryByRole("button", { name: /JIRA wins/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Push to JIRA/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Snooze 30 days/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Snooze 90 days/i })).toBeTruthy();
  });

  it("jira-now-done renders pull (JIRA wins) only", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockFetchResponse({ mappings: { done: "done" } }),
    );
    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "jira-now-done",
          jiraKey: "MS-100",
          jiraStatus: "Done",
        })}
      runId="test-run-1"
      />,
    );
    await screen.findByText("Description");
    expect(screen.getByRole("button", { name: /JIRA wins/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Push to JIRA/i })).toBeNull();
  });

  it("snooze button POSTs the snooze endpoint with a YYYY-MM-DD untilDate", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ mappings: {} }));
    fetchMock.mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    // After snooze, the component calls performArchive → archiveArtifact
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ originalPath: "x", newPath: "y" }),
    );

    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "backlog-stale",
          jiraKey: "AIF-749",
        })}
      runId="test-run-1"
      />,
    );
    const snooze = await screen.findByRole("button", { name: /Snooze 30 days/i });
    fireEvent.click(snooze);

    await waitFor(() => {
      // 1: initial detail. 2: status mapping. 3: snooze. 4: archive.
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    // The snooze call is the 3rd. Index it explicitly so reorderings surface.
    const snoozeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/artifacts/snooze"),
    );
    expect(snoozeCall).toBeTruthy();
    const body = JSON.parse(String(snoozeCall?.[1]?.body));
    expect(body.untilDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("Push to JIRA first fetches transitions then renders them in a dropdown", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ mappings: {} }));
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        key: "SM-685",
        transitions: [
          { id: "21", name: "Start", toStatus: "In Progress" },
          { id: "31", name: "Done", toStatus: "Done" },
        ],
      }),
    );

    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "local-ahead-of-jira",
          jiraKey: "SM-685",
          jiraStatus: "Backlog",
          localStatus: "in-progress",
        })}
      runId="test-run-1"
      />,
    );
    const push = await screen.findByRole("button", { name: /Push to JIRA/i });
    fireEvent.click(push);

    await waitFor(() => {
      // 1: detail. 2: mapping. 3: transitions list.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const transitionsCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/jira/SM-685/transitions"),
    );
    expect(transitionsCall).toBeTruthy();

    // Dropdown options now visible
    expect(await screen.findByText(/Transition to/)).toBeTruthy();
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("selecting a transition POSTs to /transition and clears the card", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ mappings: {} }));
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        transitions: [
          { id: "21", name: "Start", toStatus: "In Progress" },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ key: "SM-685" }));
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ originalPath: "x", newPath: "y" }),
    );

    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "local-ahead-of-jira",
          jiraKey: "SM-685",
          jiraStatus: "Backlog",
        })}
      runId="test-run-1"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Push to JIRA/i }),
    );
    const select = (await screen.findByRole("combobox", {
      name: /JIRA transition for SM-685/i,
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "21" } });

    await waitFor(() => {
      // 1: detail. 2: mapping. 3: transitions. 4: transition POST. 5: archive.
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
    const transitionPost = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("/api/jira/SM-685/transition") &&
        !String(c[0]).includes("/transitions"),
    );
    expect(transitionPost).toBeTruthy();
    expect(transitionPost?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(transitionPost?.[1]?.body))).toEqual({
      transitionId: "21",
    });
  });

  it("surfaces an error if the JIRA transitions fetch fails (e.g., 503 no JIRA configured)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ mappings: {} }));
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(
        { error: "JIRA integration is not configured on this server." },
        false,
        503,
      ),
    );

    render(
      <ArtifactReview
        artifact={decisionArtifact({
          kind: "status-divergence",
          jiraKey: "SM-609",
        })}
      runId="test-run-1"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Push to JIRA/i }),
    );

    expect(await screen.findByText(/not configured/i)).toBeTruthy();
  });
});

describe("ArtifactReview — per-artifact Mark Reviewed", () => {
  it("renders a Mark Reviewed button on a task-note card", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="run-99" />);
    await screen.findByText("Description");
    expect(
      screen.getByRole("button", { name: /Mark reviewed/i }),
    ).toBeTruthy();
  });

  it("collapses card to a reviewed stub after Mark reviewed is clicked", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        artifact: {
          ...TASK_ARTIFACT,
          reviewedAt: "2026-05-12T22:00:00.000Z",
        },
        run: { id: "run-99" },
      }),
    );
    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="run-99" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Mark reviewed/i }),
    );

    // After collapse, the Description body and Status select should be gone,
    // and the "reviewed" stub + undo button should be visible.
    await waitFor(() => {
      expect(screen.queryByText("Description")).toBeNull();
    });
    expect(screen.getByText(/reviewed/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /undo/i })).toBeTruthy();

    // Verify the fetch hit the per-artifact reviewed endpoint with the path
    // in the body. Search the call list explicitly so the assertion doesn't
    // assume call-order with the initial fetchArtifact.
    const reviewedCall = fetchMock.mock.calls.find(
      ([url]) =>
        typeof url === "string" &&
        url.includes("/api/runs/run-99/artifacts/reviewed"),
    );
    expect(reviewedCall).toBeTruthy();
    const init = reviewedCall![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      path: TASK_ARTIFACT.path,
    });
  });

  it("un-marks reviewed and re-expands the card when undo is clicked", async () => {
    const fetchMock = vi.mocked(fetch);
    // Mount fires the detail fetch in a useEffect even when the card renders
    // the collapsed stub first — load() runs regardless of which JSX branch
    // returned. So the initial fetch is the artifact detail.
    fetchMock.mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));
    // Then the DELETE response for the un-mark click.
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        artifact: { ...TASK_ARTIFACT, reviewedAt: undefined },
        run: { id: "run-99" },
      }),
    );

    const REVIEWED_ARTIFACT: Artifact = {
      ...TASK_ARTIFACT,
      reviewedAt: "2026-05-12T22:00:00.000Z",
    };
    render(<ArtifactReview artifact={REVIEWED_ARTIFACT} runId="run-99" />);

    expect(screen.getByText(/reviewed/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));

    // After un-mark, the body re-renders with the detail already loaded.
    await screen.findByText("Description");

    const unmarkCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/api/runs/run-99/artifacts/reviewed") &&
        (init as RequestInit)?.method === "DELETE",
    );
    expect(unmarkCall).toBeTruthy();
  });
});

describe("ArtifactReview — missing-file stub", () => {
  it("renders a click-through stub on 404 with Mark reviewed enabled and Archive disabled", async () => {
    // Server returns 404 because the Task Note got renamed/moved after the
    // run was recorded. The dashboard must NOT swallow this into an opaque
    // error — it should render a friendly stub so Will can still dismiss.
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ error: "artifact not found" }, false, 404),
    );

    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="run-missing" />);

    // The warning copy proves we hit the stub branch, not the error toast.
    expect(
      await screen.findByText(/File moved, renamed, or deleted/i),
    ).toBeTruthy();

    // Mark reviewed must stay clickable — its server endpoint is path-keyed
    // and doesn't touch the file, so it works even when the file is gone.
    const markBtn = screen.getByRole("button", { name: /Mark reviewed/i });
    expect((markBtn as HTMLButtonElement).disabled).toBe(false);

    // Archive must be disabled — its endpoint would also 404.
    const archiveBtn = screen.getByRole("button", { name: /^Archive$/i });
    expect((archiveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Mark reviewed on a missing-file stub POSTs to the per-artifact reviewed endpoint", async () => {
    // The promise this test guards: the queue clears even when the file is
    // gone. Path is the stable identity — server doesn't need the file to
    // exist to write the run record + suppression entry.
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ error: "artifact not found" }, false, 404),
    );
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        artifact: {
          ...TASK_ARTIFACT,
          reviewedAt: "2026-05-14T15:00:00.000Z",
        },
        run: { id: "run-missing" },
      }),
    );

    render(<ArtifactReview artifact={TASK_ARTIFACT} runId="run-missing" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Mark reviewed/i }),
    );

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) =>
          typeof url === "string" &&
          url.includes("/api/runs/run-missing/artifacts/reviewed"),
      );
      expect(call).toBeTruthy();
      const init = call![1] as RequestInit;
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        path: TASK_ARTIFACT.path,
      });
    });
  });
});

describe("ArtifactReview — non-task-note artifacts", () => {
  it("renders a plain link for url-type artifacts without loading", () => {
    const fetchMock = vi.mocked(fetch);
    render(<ArtifactReview artifact={URL_ARTIFACT} runId="test-run-1" />);

    // No API call — url artifacts open externally
    expect(fetchMock).not.toHaveBeenCalled();

    const link = screen.getByRole("link", { name: /Open/i }) as HTMLAnchorElement;
    expect(link.href).toBe(URL_ARTIFACT.path);
    expect(screen.getByText(URL_ARTIFACT.label)).toBeTruthy();
  });
});
