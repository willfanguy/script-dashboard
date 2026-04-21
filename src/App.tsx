import { useEffect, useState } from "react";
import { useRuns } from "@/hooks/use-runs";
import { RunList, type RunListView } from "@/components/RunList";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, LayoutList, Clock, Inbox } from "lucide-react";

const VIEW_STORAGE_KEY = "script-dashboard:view";

function loadView(): RunListView {
  const stored = localStorage.getItem(VIEW_STORAGE_KEY);
  if (stored === "chronological" || stored === "review") return stored;
  return "grouped";
}

function App() {
  const { runs, registry, loading, error, connected, refresh, fetchRunDetail } =
    useRuns();
  const [view, setView] = useState<RunListView>(loadView);

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  const runningCount = runs.filter((r) => r.status === "running").length;
  const failedRecent = runs
    .slice(0, 20)
    .filter((r) => r.status === "failed").length;
  const needsReviewCount = runs.filter(
    (r) => r.reviewRequired && !r.reviewedAt,
  ).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Script Dashboard</h1>
            <span
              className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-muted-foreground/30"}`}
              title={connected ? "Live — updates automatically" : "Disconnected — using manual refresh"}
            />
            {runningCount > 0 && (
              <Badge variant="default" className="text-xs">
                {runningCount} running
              </Badge>
            )}
            {failedRecent > 0 && (
              <Badge variant="destructive" className="text-xs">
                {failedRecent} failed
              </Badge>
            )}
            {needsReviewCount > 0 && (
              <Badge
                variant="outline"
                className="text-xs border-amber-500 text-amber-600"
              >
                {needsReviewCount} needs review
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <div
              role="group"
              aria-label="View mode"
              className="flex items-center rounded-md border bg-background p-0.5"
            >
              <button
                onClick={() => setView("grouped")}
                aria-pressed={view === "grouped"}
                title="Group by category"
                className={`p-1.5 rounded-sm transition-colors ${
                  view === "grouped"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutList className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("chronological")}
                aria-pressed={view === "chronological"}
                title="Reverse chronological"
                className={`p-1.5 rounded-sm transition-colors ${
                  view === "chronological"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Clock className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("review")}
                aria-pressed={view === "review"}
                title="Review queue (needs review, oldest first)"
                className={`relative p-1.5 rounded-sm transition-colors ${
                  view === "review"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Inbox className="h-4 w-4" />
                {needsReviewCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-amber-500 text-[9px] leading-none text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-1">
                    {needsReviewCount}
                  </span>
                )}
              </button>
            </div>
            <button
              onClick={refresh}
              className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            Loading...
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-destructive font-medium">
              Failed to connect to API
            </p>
            <p className="text-sm text-muted-foreground mt-2">{error}</p>
            <button
              onClick={refresh}
              className="mt-4 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        ) : (
          <RunList
            runs={runs}
            registry={registry}
            onExpand={fetchRunDetail}
            view={view}
          />
        )}
      </main>
    </div>
  );
}

export default App;
