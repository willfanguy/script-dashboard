import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatDuration,
  statusVariant,
  timeAgo,
  formatDate,
  progressState,
  elapsedSeconds,
} from "@/utils/formatting";

// --- formatDuration ---

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60)).toBe("1m 0s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3599)).toBe("59m 59s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(3665)).toBe("1h 1m");
    expect(formatDuration(7260)).toBe("2h 1m");
  });
});

// --- statusVariant ---

describe("statusVariant", () => {
  it("maps each status to the correct badge variant", () => {
    expect(statusVariant("running")).toBe("default");
    expect(statusVariant("success")).toBe("secondary");
    expect(statusVariant("failed")).toBe("destructive");
    expect(statusVariant("killed")).toBe("outline");
  });
});

// --- timeAgo ---

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for recent timestamps', () => {
    const thirtySecsAgo = new Date("2026-04-16T11:59:30Z").toISOString();
    expect(timeAgo(thirtySecsAgo)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const fiveMinAgo = new Date("2026-04-16T11:55:00Z").toISOString();
    expect(timeAgo(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const threeHoursAgo = new Date("2026-04-16T09:00:00Z").toISOString();
    expect(timeAgo(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days ago", () => {
    const twoDaysAgo = new Date("2026-04-14T12:00:00Z").toISOString();
    expect(timeAgo(twoDaysAgo)).toBe("2d ago");
  });
});

// --- formatDate ---

describe("formatDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Today" for today\'s date', () => {
    expect(formatDate("2026-04-16T09:00:00")).toBe("Today");
  });

  it('returns "Yesterday" for yesterday\'s date', () => {
    expect(formatDate("2026-04-15T14:00:00")).toBe("Yesterday");
  });

  it("returns formatted date for older dates", () => {
    const result = formatDate("2026-04-10T12:00:00");
    // Should include day-of-week and month
    expect(result).toMatch(/Fri/);
    expect(result).toMatch(/Apr/);
    expect(result).toMatch(/10/);
  });
});

// --- progressState ---

describe("progressState", () => {
  const NOW = new Date("2026-04-21T12:00:00Z").getTime();

  it("returns 'unknown' when no heartbeat has been reported", () => {
    expect(progressState(undefined, NOW)).toBe("unknown");
  });

  it("returns 'fresh' for heartbeats under 60s old", () => {
    const t = new Date(NOW - 30_000).toISOString();
    expect(progressState(t, NOW)).toBe("fresh");
  });

  it("returns 'fresh' at the 0s boundary", () => {
    const t = new Date(NOW).toISOString();
    expect(progressState(t, NOW)).toBe("fresh");
  });

  it("returns 'slow' at 60s and under 5m", () => {
    const t60 = new Date(NOW - 60_000).toISOString();
    const t4m = new Date(NOW - 4 * 60_000).toISOString();
    expect(progressState(t60, NOW)).toBe("slow");
    expect(progressState(t4m, NOW)).toBe("slow");
  });

  it("returns 'stalled' at 5m and older", () => {
    const t5m = new Date(NOW - 5 * 60_000).toISOString();
    const t1h = new Date(NOW - 3_600_000).toISOString();
    expect(progressState(t5m, NOW)).toBe("stalled");
    expect(progressState(t1h, NOW)).toBe("stalled");
  });

  it("handles future timestamps defensively (clock skew)", () => {
    const future = new Date(NOW + 30_000).toISOString();
    // Negative age still < 60, so callers see 'fresh'. Invariant: never throws.
    expect(progressState(future, NOW)).toBe("fresh");
  });
});

// --- elapsedSeconds ---

describe("elapsedSeconds", () => {
  const NOW = new Date("2026-04-21T12:00:00Z").getTime();

  it("returns seconds since start", () => {
    const started = new Date(NOW - 125_000).toISOString();
    expect(elapsedSeconds(started, NOW)).toBe(125);
  });

  it("clamps to 0 for future start times", () => {
    const future = new Date(NOW + 10_000).toISOString();
    expect(elapsedSeconds(future, NOW)).toBe(0);
  });

  it("returns 0 when start equals now", () => {
    const same = new Date(NOW).toISOString();
    expect(elapsedSeconds(same, NOW)).toBe(0);
  });
});
