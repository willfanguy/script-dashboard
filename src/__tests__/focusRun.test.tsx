// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useFocusRun } from "@/hooks/use-focus-run";
import { RunList } from "@/components/RunList";
import type { RunRecord } from "@/types";

const COLLAPSED_KEY = "script-dashboard:collapsed-categories";

// This jsdom config runs on an opaque origin, so it ships no Storage. RunList
// reads/writes window.localStorage (guarded by try/catch), and our tests need
// to seed a collapsed category, so install a minimal in-memory Storage.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return Array.from(this.m.keys())[i] ?? null;
  }
}

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    script: "refresh-schedule",
    category: "scheduled",
    status: "success",
    startedAt: "2026-06-05T12:00:00-05:00",
    startEpoch: 1_750_000_000,
    duration: 203,
    ...over,
  };
}

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView; the focus effect calls it.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useFocusRun", () => {
  it("returns the run id from ?run=", () => {
    window.history.replaceState({}, "", "/?run=scheduled-2026-06-05T17-00Z-42");
    const { result } = renderHook(() => useFocusRun());
    expect(result.current).toBe("scheduled-2026-06-05T17-00Z-42");
  });

  it("returns null when the param is absent", () => {
    window.history.replaceState({}, "", "/");
    const { result } = renderHook(() => useFocusRun());
    expect(result.current).toBeNull();
  });

  it("treats a blank ?run= as no focus", () => {
    window.history.replaceState({}, "", "/?run=%20%20");
    const { result } = renderHook(() => useFocusRun());
    expect(result.current).toBeNull();
  });
});

describe("RunList deep-link focus", () => {
  it("reveals a collapsed category, expands the focused card, and scrolls to it", async () => {
    // The user had the scheduled category collapsed; a deep link must override
    // that and surface the target run.
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["scheduled"]));
    const onExpand = vi
      .fn()
      .mockResolvedValue(makeRun({ output: "FOCUSED OUTPUT" }));

    render(
      <RunList
        runs={[makeRun()]}
        registry={null}
        onExpand={onExpand}
        view="grouped"
        focusRunId="r1"
      />,
    );

    // Category was collapsed in storage but the focus effect un-collapses it,
    // so the card (and its script name) becomes visible.
    expect(await screen.findByText("refresh-schedule")).toBeTruthy();

    // Card auto-expanded → its output loaded and rendered.
    await waitFor(() => expect(onExpand).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText("FOCUSED OUTPUT")).toBeTruthy();

    // Pulled into view and flashed.
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.querySelector(".ring-2")).toBeTruthy();
  });

  it("leaves a non-focused card collapsed and never scrolls", async () => {
    const onExpand = vi
      .fn()
      .mockResolvedValue(makeRun({ output: "SHOULD NOT APPEAR" }));

    render(
      <RunList
        runs={[makeRun()]}
        registry={null}
        onExpand={onExpand}
        view="grouped"
        focusRunId={null}
      />,
    );

    // Card header is visible (category not collapsed), but it stays closed:
    // no output fetch, no scroll, no highlight ring.
    expect(await screen.findByText("refresh-schedule")).toBeTruthy();
    expect(onExpand).not.toHaveBeenCalled();
    expect(screen.queryByText("SHOULD NOT APPEAR")).toBeNull();
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector(".ring-2")).toBeNull();
  });
});
