// Loads the canonical JIRA → Task Note `status` mapping from
// lib/jira-status-mapping.json. Lookups are case-insensitive and
// whitespace/punctuation-tolerant — "Ready for QA", "ready-for-qa",
// "READYFORQA" all resolve to the same entry.
//
// Why a separate file: this mapping is also referenced by the
// todo-sync-processor agent's prompt. Keeping it in JSON (loaded by both
// surfaces) prevents the agent's prose table from drifting away from what
// the server actually does.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RawMappingFile {
  mappings?: Array<{ jira?: unknown; local?: unknown }>;
}

export interface JiraStatusMapping {
  // Normalized JIRA name (lowercase + alphanumeric only) → local status.
  lookup: Map<string, string>;
}

const DEFAULT_PATH = path.join(__dirname, "..", "lib", "jira-status-mapping.json");

export function normalizeStatusKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function loadStatusMapping(
  filePath = DEFAULT_PATH,
): JiraStatusMapping {
  const lookup = new Map<string, string>();
  if (!fs.existsSync(filePath)) return { lookup };

  let parsed: RawMappingFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RawMappingFile;
  } catch {
    return { lookup };
  }

  const entries = parsed.mappings;
  if (!Array.isArray(entries)) return { lookup };

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { jira, local } = entry;
    if (typeof jira !== "string" || typeof local !== "string") continue;
    if (!jira || !local) continue;
    lookup.set(normalizeStatusKey(jira), local);
  }

  return { lookup };
}

// Returns the canonical local status for a JIRA status name, or null if there
// is no mapping (a new workflow state we haven't classified). Null is a
// signal to the endpoint to leave local `status` alone — never write the raw
// JIRA string into a field that uses the local taxonomy.
export function jiraToLocalStatus(
  jiraStatus: string,
  mapping: JiraStatusMapping,
): string | null {
  const key = normalizeStatusKey(jiraStatus);
  return mapping.lookup.get(key) ?? null;
}
