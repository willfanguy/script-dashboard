import { useState, useEffect, useCallback } from "react";
import type { RunRecord, ScriptRegistry } from "@/types";

export function useRuns() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [registry, setRegistry] = useState<ScriptRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch runs");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRegistry = useCallback(async () => {
    try {
      const res = await fetch("/api/scripts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRegistry(data);
    } catch {
      // Registry is optional — dashboard still works without it
    }
  }, []);

  const fetchRunDetail = useCallback(async (id: string): Promise<RunRecord | null> => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    fetchRegistry();
  }, [fetchRuns, fetchRegistry]);

  return { runs, registry, loading, error, refresh: fetchRuns, fetchRunDetail };
}
