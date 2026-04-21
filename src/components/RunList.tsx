import type { RunRecord, ScriptRegistry } from "@/types";
import { RunCard } from "./RunCard";
import { Separator } from "@/components/ui/separator";
import { groupByCategory } from "@/utils/groupByCategory";

export type RunListView = "grouped" | "chronological" | "review";

interface RunListProps {
  runs: RunRecord[];
  registry: ScriptRegistry | null;
  onExpand: (id: string) => Promise<RunRecord | null>;
  view: RunListView;
}

export function RunList({ runs, registry, onExpand, view }: RunListProps) {
  const scriptMap = new Map(
    registry?.scripts.map((s) => [s.id, s]) || []
  );

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
    const sorted = [...runs].sort(
      (a, b) => (b.startEpoch || 0) - (a.startEpoch || 0)
    );
    return (
      <div className="space-y-2">
        {sorted.map((run) => (
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

  if (view === "review") {
    // Review queue: runs flagged reviewRequired that haven't been reviewed yet,
    // oldest first — handle the older ones before they get buried.
    const queue = runs
      .filter((r) => r.reviewRequired && !r.reviewedAt)
      .sort((a, b) => (a.startEpoch || 0) - (b.startEpoch || 0));

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
        return (
          <section key={category}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {catInfo?.label || category}
              </h2>
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">
                {categoryRuns.length} run{categoryRuns.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="space-y-2">
              {categoryRuns.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  scriptInfo={scriptMap.get(run.script)}
                  onExpand={onExpand}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
