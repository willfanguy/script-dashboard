import { useState } from "react";

/**
 * Reads the `?run=<id>` deep-link param once, on first render.
 *
 * macOS notifications emitted by `lib/report.sh` point their click target at
 * `${SCRIPT_DASH_URL}?run=${RUN_ID}` (see `_sd_notify` call site). This hook
 * lets a click on that notification land on — and reveal — the specific run's
 * card instead of dumping the user at the dashboard root.
 *
 * Read-once semantics: we snapshot the param in a lazy `useState` initializer
 * so later re-renders don't re-trigger focus, and we intentionally leave the
 * param in the URL. Leaving it means a manual browser refresh re-focuses the
 * same run, which is the behavior you want when re-opening a notification's tab.
 */
export function useFocusRun(): string | null {
  const [focusRunId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const id = new URLSearchParams(window.location.search).get("run");
    return id && id.trim() ? id : null;
  });
  return focusRunId;
}
