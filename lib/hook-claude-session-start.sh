#!/usr/bin/env bash
# hook-claude-session-start.sh — Claude Code SessionStart hook handler.
#
# Opens a dashboard "running" record under the "interactive" category and
# stores a session_id → RUN_ID bridge so SessionEnd / Stop can find it.
#
# Wire from ~/.claude/settings.json:
#   "hooks": {
#     "SessionStart": [
#       { "matcher": "", "hooks": [
#         { "type": "command",
#           "command": "/path/to/hook-claude-session-start.sh",
#           "timeout": 5 }
#       ]}
#     ]
#   }
#
# Claude Code passes a JSON payload on stdin with at least:
#   { "session_id": "uuid", "cwd": "/some/path", "source": "startup" | "resume" | ... }

set -uo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$script_dir/hook-claude-common.sh"
sd_hook_have_jq || exit 0

# Read Claude's JSON payload. Default to {} so missing stdin doesn't break parsing.
input=$(cat 2>/dev/null || echo '{}')

session_id=$(sd_hook_session_id "$input")
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
source_kind=$(printf '%s' "$input" | jq -r '.source // empty' 2>/dev/null)
transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)

# Without a session_id we have no way to correlate with SessionEnd / Stop. Bail.
if [ -z "$session_id" ]; then
    exit 0
fi

# Bridge file: maps Claude session_id → dashboard RUN_ID.
runid_file="$(sd_hook_runid_file "$session_id")"
mkdir -p "$(dirname "$runid_file")"

# Idempotent: don't double-open if SessionStart fires twice for the same session.
if [ -f "$runid_file" ]; then
    exit 0
fi

# Description: cwd plus the source kind when it adds signal (resume, etc.).
# Plain-English label for readability; "startup" is suppressed because it's
# the default and adds no signal.
desc="${cwd:-unknown cwd}"
if [ -n "$source_kind" ] && [ "$source_kind" != "startup" ]; then
    case "$source_kind" in
        resume) desc="$desc (resumed)" ;;
        clear)  desc="$desc (cleared)" ;;
        *)      desc="$desc ($source_kind)" ;;
    esac
fi

# Append cmux workspace context if claude was invoked inside a cmux pane.
# CMUX_WORKSPACE_ID propagates from the shell when claude started; cmux CLI
# lets us resolve the UUID to the human-readable workspace name.
if [ -n "${CMUX_WORKSPACE_ID:-}" ] && command -v cmux >/dev/null 2>&1; then
    # cmux validates CMUX_SURFACE_ID even on commands that don't need a
    # surface (e.g., list-workspaces), so strip it before invoking. The
    # selected workspace line is prefixed with `*`, which shifts column
    # positions — find the UUID's field index, then read the name from the
    # fields after it (stopping at any trailing [selected] marker).
    workspace_name=$(env -u CMUX_SURFACE_ID cmux list-workspaces --id-format both 2>/dev/null \
        | awk -v id="$CMUX_WORKSPACE_ID" '
            index($0, id) {
                for (i = 1; i <= NF; i++) {
                    if ($i == id) {
                        name = ""
                        for (j = i + 1; j <= NF; j++) {
                            if ($j == "[selected]") break
                            name = name (name ? " " : "") $j
                        }
                        print name
                        exit
                    }
                }
            }')
    if [ -n "$workspace_name" ]; then
        desc="$desc [cmux: $workspace_name]"
    fi
fi

# Open the dashboard record via the same script skills use. --category puts
# this run under "interactive" instead of the default "skill" lane.
run_id=$(bash "$script_dir/report-skill-start.sh" \
    "claude-interactive" \
    "$desc" \
    --category interactive 2>/dev/null) || exit 0

# Persist the bridge so SessionEnd / Stop can find this run by session_id.
# JSON format: { runid, transcript_path }. The hooks also accept the legacy
# plain-text format (just the runid) for sessions in flight across the change.
if [ -n "$run_id" ]; then
    jq -cn --arg rid "$run_id" --arg tp "$transcript_path" \
        '{runid: $rid, transcript_path: $tp}' \
        > "$runid_file"
fi
