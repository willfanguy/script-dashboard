#!/usr/bin/env bash
# hook-claude-session-end.sh — Claude Code SessionEnd hook handler.
#
# Finalizes the dashboard record opened by hook-claude-session-start.sh,
# looked up by Claude's session_id via the bridge file in
# ~/.script-runs/.claude-sessions/.
#
# Wire from ~/.claude/settings.json:
#   "hooks": {
#     "SessionEnd": [
#       { "matcher": "", "hooks": [
#         { "type": "command",
#           "command": "/path/to/hook-claude-session-end.sh",
#           "timeout": 5 }
#       ]}
#     ]
#   }
#
# When SessionEnd never fires (Claude crashes, force-quit, system reboot),
# the stale-run sweep picks up the orphan after STALE_RUN_THRESHOLD_MINUTES
# (default 30) and marks it killed. The Stop hook's heartbeat keeps active
# sessions alive past that threshold.

set -uo pipefail

input=$(cat 2>/dev/null || echo '{}')

session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
[ -z "$session_id" ] && exit 0

runs_root="${SCRIPT_RUNS_DIR:-$HOME/.script-runs/runs}"
state_dir="$(dirname "$runs_root")/.claude-sessions"
runid_file="$state_dir/${session_id}.runid"

# No matching SessionStart record means this session was tracked elsewhere
# (or SessionStart didn't fire for it). Silent no-op.
[ ! -f "$runid_file" ] && exit 0

run_id=$(cat "$runid_file" 2>/dev/null)
if [ -z "$run_id" ]; then
    rm -f "$runid_file"
    exit 0
fi

# Reason for end. Claude may include "reason" in the payload (clear, logout,
# exit, etc.). Default to a generic "ended" when missing.
reason=$(printf '%s' "$input" | jq -r '.reason // "ended"' 2>/dev/null)
[ -z "$reason" ] && reason="ended"

script_dir="$(cd "$(dirname "$0")" && pwd)"
bash "$script_dir/report-skill-end.sh" "$run_id" "Session $reason" 2>/dev/null || true

rm -f "$runid_file"
