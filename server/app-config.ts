import path from "path";
import os from "os";
import { loadArtifactsConfig, type ArtifactsConfig } from "./artifacts.js";
import { createJiraClient, type JiraClient } from "./jira.js";
import {
  loadStatusMapping,
  type JiraStatusMapping,
} from "./jira-status-mapping.js";

// Everything a createApp instance needs, injected rather than read from
// module-level globals — so tests construct it against temp dirs and the
// standalone server builds it from the environment via defaultConfig().
export interface AppConfig {
  runsDir: string;
  suppressedFile: string;
  artifactsConfig: ArtifactsConfig;
  jira: JiraClient | null;
  statusMapping: JiraStatusMapping;
  staleThresholdMinutes: number;
}

// Passed to each route registrar: the config plus the SSE broadcast hook.
export interface RouteContext {
  config: AppConfig;
  broadcast: () => void;
}

export function defaultConfig(): AppConfig {
  const runsDir =
    process.env.SCRIPT_RUNS_DIR ||
    path.join(os.homedir(), ".script-runs", "runs");
  const artifactsConfig = loadArtifactsConfig();
  return {
    runsDir,
    suppressedFile:
      process.env.SCRIPT_SUPPRESSED_FILE ||
      path.join(path.dirname(runsDir), ".suppressed.json"),
    artifactsConfig,
    jira: artifactsConfig.jira ? createJiraClient(artifactsConfig.jira) : null,
    statusMapping: loadStatusMapping(),
    staleThresholdMinutes: parseInt(
      process.env.STALE_RUN_THRESHOLD_MINUTES || "30",
      10,
    ),
  };
}
