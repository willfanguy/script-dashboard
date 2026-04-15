export interface RunRecord {
  id: string;
  script: string;
  category: string;
  description?: string;
  status: "running" | "success" | "failed" | "killed";
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
  startEpoch: number;
  endEpoch?: number;
  duration?: number;
  pid?: number;
  host?: string;
  output?: string;
}

export interface ScriptInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  schedule?: string;
}

export interface ScriptRegistry {
  scripts: ScriptInfo[];
  categories: Record<string, { label: string; description: string }>;
}
