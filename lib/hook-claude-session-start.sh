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

# Read Claude's JSON payload. Default to {} so missing stdin doesn't break parsing.
input=$(cat 2>/dev/null || echo '{}')

session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
source_kind=$(printf '%s' "$input" | jq -r '.source // empty' 2>/dev/null)

# Without a session_id we have no way to correlate with SessionEnd / Stop. Bail.
if [ -z "$session_id" ]; then
    exit 0
fi

# Bridge directory: maps Claude session_id → dashboard RUN_ID.
runs_root="${SCRIPT_RUNS_DIR:-$HOME/.script-runs/runs}"
state_dir="$(dirname "$runs_root")/.claude-sessions"
mkdir -p "$state_dir"

# Idempotent: don't double-open if SessionStart fires twice for the same session.
if [ -f "$state_dir/${session_id}.runid" ]; then
    exit 0
fi

# Description: cwd plus the source kind when it adds signal (resume, etc.).
desc="${cwd:-unknown cwd}"
if [ -n "$source_kind" ] && [ "$source_kind" != "startup" ]; then
    desc="$desc (source: $source_kind)"
fi

# Open the dashboard record via the same script skills use. --category puts
# this run under "interactive" instead of the default "skill" lane.
script_dir="$(cd "$(dirname "$0")" && pwd)"
run_id=$(bash "$script_dir/report-skill-start.sh" \
    "claude-interactive" \
    "$desc" \
    --category interactive 2>/dev/null) || exit 0

# Persist the bridge so SessionEnd / Stop can find this run by session_id.
if [ -n "$run_id" ]; then
    printf '%s' "$run_id" > "$state_dir/${session_id}.runid"
fi
