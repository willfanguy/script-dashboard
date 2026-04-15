import { useRuns } from "@/hooks/use-runs";
import { RunList } from "@/components/RunList";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

function App() {
  const { runs, registry, loading, error, refresh, fetchRunDetail } = useRuns();

  const runningCount = runs.filter((r) => r.status === "running").length;
  const failedRecent = runs
    .slice(0, 20)
    .filter((r) => r.status === "failed").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Script Dashboard</h1>
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
          </div>
          <button
            onClick={refresh}
            className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
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
          />
        )}
      </main>
    </div>
  );
}

export default App;
