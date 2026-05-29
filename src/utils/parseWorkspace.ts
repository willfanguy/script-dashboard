// Parse the cmux workspace name out of a run description string of the form
// "/Users/will/Repos/personal (source: clear) [cmux: Personal]".
//
// The suffix is written by hook-claude-session-start.sh when CMUX_WORKSPACE_ID
// is set in the shell that launched the Claude Code session. Surfacing it as
// a standalone chip lets the row title carry workspace identity without
// burying it inside the description line.

const WORKSPACE_RE = /\s*\[cmux:\s*([^\]]+)\]/;

// Matches both the new plain-English form "(resumed)" / "(cleared)" written by
// the current hook AND the legacy "(source: resume)" / "(source: clear)" form
// written by older hook versions. Either way, returns the kind and strips the
// segment from the description so it can be surfaced as a chip on the title row.
const SOURCE_NEW_RE = /\s*\((resumed|cleared)\)/i;
const SOURCE_OLD_RE = /\s*\(source:\s*(resume|clear)\)/i;

export type SourceKind = "resumed" | "cleared";

export interface SplitSource {
  // Description with the source segment removed and trailing whitespace tidied.
  description: string;
  // null when no source tag was present, otherwise the normalized verb form.
  sourceKind: SourceKind | null;
}

export function splitSource(
  description: string | null | undefined,
): SplitSource {
  if (!description) return { description: "", sourceKind: null };

  const newMatch = description.match(SOURCE_NEW_RE);
  if (newMatch) {
    return {
      description: description.replace(SOURCE_NEW_RE, "").trimEnd(),
      sourceKind: newMatch[1].toLowerCase() as SourceKind,
    };
  }

  const oldMatch = description.match(SOURCE_OLD_RE);
  if (oldMatch) {
    const verb = oldMatch[1].toLowerCase();
    return {
      description: description.replace(SOURCE_OLD_RE, "").trimEnd(),
      sourceKind: verb === "resume" ? "resumed" : "cleared",
    };
  }

  return { description, sourceKind: null };
}

export interface SplitDescription {
  // Description with the [cmux: ...] segment removed and trailing whitespace
  // tidied. Original description returned untouched when no tag is present.
  description: string;
  // Trimmed workspace name, or null if no cmux tag was present.
  workspace: string | null;
}

export function splitWorkspace(
  description: string | null | undefined,
): SplitDescription {
  if (!description) return { description: "", workspace: null };
  const m = description.match(WORKSPACE_RE);
  if (!m) return { description, workspace: null };
  const workspace = m[1].trim();
  const cleaned = description.replace(WORKSPACE_RE, "").trimEnd();
  return {
    description: cleaned,
    workspace: workspace.length > 0 ? workspace : null,
  };
}
