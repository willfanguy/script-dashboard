import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Layers, Clock } from "lucide-react";
import { RunCard } from "./RunCard";
import { CollapsibleRow } from "./CollapsibleRow";
import type { RunCluster } from "@/utils/clusterRuns";
import type { RunRecord, ScriptInfo } from "@/types";
import { formatDuration, formatTimeRange } from "@/utils/formatting";
import { cn } from "@/lib/utils";

interface RunClusterCardProps {
  cluster: RunCluster;
  scriptMap: Map<string, ScriptInfo>;
  onExpand: (id: string) => Promise<RunRecord | null>;
}

export function RunClusterCard({
  cluster,
  scriptMap,
  onExpand,
}: RunClusterCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { runs, totalDuration, failedCount } = cluster;
  // Members are newest-first; earliest = last, latest = first.
  const latest = runs[0];
  const earliest = runs[runs.length - 1];
  const rangeLabel = formatTimeRange(earliest.startedAt, latest.startedAt);

  return (
    <CollapsibleRow
      open={expanded}
      onOpenChange={setExpanded}
      cardClassName={cn(
        "bg-muted/40",
        failedCount > 0 && "border-l-4 border-l-amber-500",
      )}
      triggerClassName="px-4 py-2.5 hover:bg-muted/60"
      leading={<Layers className="h-4 w-4 text-muted-foreground" />}
      header={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {runs.length} interactive sessions
          </span>
          {failedCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {failedCount} failed
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{rangeLabel}</span>
        </div>
      }
      trailing={
        totalDuration > 0 ? (
          <span
            className="flex items-center gap-1"
            title="Total time across all sessions"
          >
            <Clock className="h-3 w-3" />
            {formatDuration(totalDuration)}
          </span>
        ) : null
      }
    >
      <div className="border-t bg-background/60 px-2 py-2 space-y-2">
        {runs.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            scriptInfo={scriptMap.get(run.script)}
            onExpand={onExpand}
            compactTime
          />
        ))}
      </div>
    </CollapsibleRow>
  );
}
