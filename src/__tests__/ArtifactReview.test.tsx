// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ArtifactReview } from "@/components/ArtifactReview";
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

    render(<ArtifactReview artifact={TASK_ARTIFACT} />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it("renders frontmatter controls and markdown body after fetch resolves", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));

    render(<ArtifactReview artifact={TASK_ARTIFACT} />);

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

    render(<ArtifactReview artifact={TASK_ARTIFACT} />);
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

    render(<ArtifactReview artifact={TASK_ARTIFACT} />);
    expect(await screen.findByText(/boom/)).toBeTruthy();
  });

  it("enables the Add note button only when the textarea has content", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockFetchResponse(SAMPLE_DETAIL));

    render(<ArtifactReview artifact={TASK_ARTIFACT} />);
    const textarea = (await screen.findByPlaceholderText(
      /Add a dated note/,
    )) as HTMLTextAreaElement;
    const button = screen.getByRole("button", { name: /Add note/i });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: "a note" } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ArtifactReview — non-task-note artifacts", () => {
  it("renders a plain link for url-type artifacts without loading", () => {
    const fetchMock = vi.mocked(fetch);
    render(<ArtifactReview artifact={URL_ARTIFACT} />);

    // No API call — url artifacts open externally
    expect(fetchMock).not.toHaveBeenCalled();

    const link = screen.getByRole("link", { name: /Open/i }) as HTMLAnchorElement;
    expect(link.href).toBe(URL_ARTIFACT.path);
    expect(screen.getByText(URL_ARTIFACT.label)).toBeTruthy();
  });
});
