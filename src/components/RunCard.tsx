import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RunRecord, ScriptInfo } from "@/types";
import {
  CheckCircle,
  XCircle,
  Loader,
  Skull,
  ChevronRight,
  Clock,
} from "lucide-react";

interface RunCardProps {
  run: RunRecord;
  scriptInfo?: ScriptInfo;
  onExpand: (id: string) => Promise<RunRecord | null>;
}

function StatusIcon({ status }: { status: RunRecord["status"] }) {
  switch (status) {
    case "running":
      return <Loader className="h-4 w-4 text-blue-500 animate-spin" />;
    case "success":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "killed":
      return <Skull className="h-4 w-4 text-amber-500" />;
  }
}

function statusVariant(status: RunRecord["status"]) {
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string): string {
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

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function RunCard({ run, scriptInfo, onExpand }: RunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);

  const handleToggle = async () => {
    if (!expanded && output === null) {
      setLoadingOutput(true);
      const detail = await onExpand(run.id);
      setOutput(detail?.output || "(no output captured)");
      setLoadingOutput(false);
    }
    setExpanded(!expanded);
  };

  const displayName = scriptInfo?.name || run.script;

  return (
    <Collapsible open={expanded} onOpenChange={handleToggle}>
      <Card className="p-0 overflow-hidden">
        <CollapsibleTrigger className="w-full cursor-pointer">
          <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
            <StatusIcon status={run.status} />

            <div className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">
                  {displayName}
                </span>
                <Badge variant={statusVariant(run.status)} className="text-xs">
                  {run.status}
                </Badge>
                {run.exitCode !== undefined && run.exitCode !== 0 && (
                  <span className="text-xs text-muted-foreground">
                    exit {run.exitCode}
                  </span>
                )}
              </div>
              {scriptInfo?.description && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {scriptInfo.description}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
              {run.duration !== undefined && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(run.duration)}
                </span>
              )}
              <span title={new Date(run.startedAt).toLocaleString()}>
                {formatDate(run.startedAt)} {formatTime(run.startedAt)}
              </span>
              <span className="text-muted-foreground/60">
                {timeAgo(run.startedAt)}
              </span>
              <ChevronRight
                className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t px-4 py-3 bg-muted/30">
            {loadingOutput ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader className="h-3 w-3 animate-spin" />
                Loading output...
              </div>
            ) : (
              <ScrollArea className="max-h-80">
                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/80">
                  {output}
                </pre>
              </ScrollArea>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
