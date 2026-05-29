import type { RunRecord } from "@/types";

export function statusVariant(status: RunRecord["status"]) {
  switch (status) {
    case "running":
      return "default" as const;
    case "success":
      return "secondary" as const;
    case "failed":
      return "destructive" as const;
    case "killed":
      return "outline" as const;
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Format a time range for a cluster header. Drops redundant "Today" when
// both ends fall on today, drops the second date if same-day. Collapses
// to a single time when start and end land on the same minute.
export function formatTimeRange(
  earliestISO: string,
  latestISO: string,
): string {
  const earliest = new Date(earliestISO);
  const latest = new Date(latestISO);
  const sameDay = earliest.toDateString() === latest.toDateString();

  if (!sameDay) {
    return `${formatDate(earliestISO)} ${formatTime(earliestISO)} – ${formatDate(latestISO)} ${formatTime(latestISO)}`;
  }

  const earliestTime = formatTime(earliestISO);
  const latestTime = formatTime(latestISO);
  const dateLabel = formatDate(earliestISO);
  const isToday = dateLabel === "Today";

  // Same minute (likely several quick sessions): single time reads tighter.
  if (earliestTime === latestTime) {
    return isToday ? earliestTime : `${dateLabel}, ${earliestTime}`;
  }

  return isToday
    ? `${earliestTime} – ${latestTime}`
    : `${dateLabel}, ${earliestTime} – ${latestTime}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export type ProgressState = "fresh" | "slow" | "stalled" | "unknown";

// Classify a running script by time since last progress heartbeat.
// Scripts that never call report_progress report "unknown" — we can't
// distinguish stalled from just-quiet.
export function progressState(
  lastProgressAt: string | undefined,
  nowMs: number = Date.now(),
): ProgressState {
  if (!lastProgressAt) return "unknown";
  const ageSec = Math.floor((nowMs - new Date(lastProgressAt).getTime()) / 1000);
  if (ageSec < 60) return "fresh";
  if (ageSec < 300) return "slow";
  return "stalled";
}

export function elapsedSeconds(
  startedAt: string,
  nowMs: number = Date.now(),
): number {
  return Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 1000));
}
