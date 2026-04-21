export type ArtifactType = "task-note" | "file" | "url";

export interface Artifact {
  type: ArtifactType;
  label: string;
  path: string;
}

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
  artifacts?: Artifact[];
  reviewRequired?: boolean;
  reviewedAt?: string;
}

export interface ArtifactDetail {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ArtifactPatch {
  status?: string;
  priority?: string;
  appendNote?: string;
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
