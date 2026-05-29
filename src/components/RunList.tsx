import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RunRecord, ScriptRegistry } from "@/types";
import { RunCard } from "./RunCard";
import { RunClusterCard } from "./RunClusterCard";
import { ChronoFilterChips } from "./ChronoFilterChips";
import { Separator } from "@/components/ui/separator";
import { groupByCategory } from "@/utils/groupByCategory";
import { clusterChronoRuns, type ChronoEntry } from "@/utils/clusterRuns";
import { formatDate } from "@/utils/formatting";

// Pull the leading run from a chronological entry so we can group adjacent
// entries by day for the sticky-header timeline.
function entryStartedAt(entry: ChronoEntry): string {
  return entry.kind === "run"
    ? entry.run.startedAt
    : entry.cluster.runs[0].startedAt;
}

export type RunListView = "grouped" | "chronological" | "review";

interface RunListProps {
  runs: RunRecord[];
  registry: ScriptRegistry | null;
  onExpand: (id: string) => Promise<RunRecord | null>;
  view: RunListView;
}

const COLLAPSED_STORAGE_KEY = "script-dashboard:collapsed-categories";
const CHRONO_FILTER_STORAGE_KEY = "script-dashboard:chrono-filter-disabled";

function loadStringSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function loadCollapsed(): Set<string> {
  return loadStringSet(COLLAPSED_STORAGE_KEY);
}

function loadChronoFilter(): Set<string> {
  return loadStringSet(CHRONO_FILTER_STORAGE_KEY);
}

export function RunList({ runs, registry, onExpand, view }: RunListProps) {
  const scriptMap = new Map(
    registry?.scripts.map((s) => [s.id, s]) || []
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const [chronoDisabled, setChronoDisabled] = useState<Set<string>>(() =>
    loadChronoFilter(),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        COLLAPSED_STORAGE_KEY,
        JSON.stringify(Array.from(collapsed))
      );
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHRONO_FILTER_STORAGE_KEY,
        JSON.stringify(Array.from(chronoDisabled)),
      );
    } catch {
      // ignore
    }
  }, [chronoDisabled]);

  const toggleCategory = (category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const toggleChronoCategory = (category: string) => {
    setChronoDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  if (runs.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-lg">No script runs yet</p>
        <p className="text-sm mt-2">
          Source <code className="bg-muted px-1.5 py-0.5 rounded text-xs">report.sh</code> in your scripts to start tracking runs.
        </p>
      </div>
    );
  }

  if (view === "chronological") {
    const filtered = runs.filter((r) => !chronoDisabled.has(r.category));
    const entries = clusterChronoRuns(filtered);

    // Insert day-separator items between entries when the calendar day
    // changes. Entries are sorted newest-first, so the first item carries
    // the most recent day.
    type ChronoItem =
      | { kind: "day-header"; key: string; label: string }
      | { kind: "entry"; entry: ChronoEntry };
    const items: ChronoItem[] = [];
    let prevDayKey = "";
    for (const entry of entries) {
      const iso = entryStartedAt(entry);
      const dayKey = new Date(iso).toDateString();
      if (dayKey !== prevDayKey) {
        items.push({
          kind: "day-header",
          key: dayKey,
          label: formatDate(iso),
        });
        prevDayKey = dayKey;
      }
      items.push({ kind: "entry", entry });
    }

    return (
      <div>
        <ChronoFilterChips
          runs={runs}
          registry={registry}
          disabled={chronoDisabled}
          onToggle={toggleChronoCategory}
        />
        {entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">
              No runs match the current filter. Toggle a chip to bring a
              category back.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              if (item.kind === "day-header") {
                return (
                  <div
                    key={`day-${item.key}`}
                    className="flex items-center gap-3 pt-4 pb-1 first:pt-0"
                  >
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {item.label}
                    </h2>
                    <Separator className="flex-1" />
                  </div>
                );
              }
              const entry = item.entry;
              return entry.kind === "cluster" ? (
                <RunClusterCard
                  key={`cluster-${entry.cluster.runs[0].id}`}
                  cluster={entry.cluster}
                  scriptMap={scriptMap}
                  onExpand={onExpand}
                />
              ) : (
                <RunCard
                  key={entry.run.id}
                  run={entry.run}
                  scriptInfo={scriptMap.get(entry.run.script)}
                  onExpand={onExpand}
                  compactTime
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (view === "review") {
    // Review queue: runs flagged reviewRequired that haven't been reviewed yet,
    // newest first — matches the chronological view's ordering convention.
    const queue = runs
      .filter((r) => r.reviewRequired && !r.reviewedAt)
      .sort((a, b) => (b.startEpoch || 0) - (a.startEpoch || 0));

    if (queue.length === 0) {
      return (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg">Review queue is empty</p>
          <p className="text-sm mt-2">
            Runs that emit <code className="bg-muted px-1.5 py-0.5 rounded text-xs">--review</code> will appear here.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {queue.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            scriptInfo={scriptMap.get(run.script)}
            onExpand={onExpand}
          />
        ))}
      </div>
    );
  }

  const grouped = groupByCategory(runs, registry);

  return (
    <div className="space-y-8">
      {Array.from(grouped.entries()).map(([category, categoryRuns]) => {
        const catInfo = registry?.categories[category];
        const isCollapsed = collapsed.has(category);
        const label = catInfo?.label || category;
        return (
          <section key={category}>
            <button
              type="button"
              onClick={() => toggleCategory(category)}
              aria-expanded={!isCollapsed}
              aria-controls={`category-${category}`}
              className="flex items-center gap-3 mb-3 w-full text-left group"
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              )}
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
                {label}
              </h2>
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">
                {categoryRuns.length} run{categoryRuns.length !== 1 ? "s" : ""}
              </span>
            </button>
            {!isCollapsed && (
              <div id={`category-${category}`} className="space-y-2">
                {categoryRuns.map((run) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    scriptInfo={scriptMap.get(run.script)}
                    onExpand={onExpand}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
