import type { RunRecord, ScriptRegistry } from "@/types";
import { RunCard } from "./RunCard";
import { Separator } from "@/components/ui/separator";
import { groupByCategory } from "@/utils/groupByCategory";

interface RunListProps {
  runs: RunRecord[];
  registry: ScriptRegistry | null;
  onExpand: (id: string) => Promise<RunRecord | null>;
}

export function RunList({ runs, registry, onExpand }: RunListProps) {
  const grouped = groupByCategory(runs, registry);
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
