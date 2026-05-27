#!/usr/bin/env bash
# hook-claude-stop.sh — Claude Code Stop hook handler (heartbeat).
#
# Stop fires after every Claude response. We use it to update
# `lastProgressAt` on the running interactive-session record so the
# stale-run sweep doesn't kill long but actively-used sessions.
#
# Wire from ~/.claude/settings.json (composable with other Stop hooks):
#   "hooks": {
#     "Stop": [
#       { "matcher": "", "hooks": [
#         { "type": "command",
#           "command": "/path/to/hook-claude-stop.sh",
#           "timeout": 5 }
#       ]}
#     ]
#   }
#
# Silent no-op when:
#   - no session_id in the payload
#   - no matching SessionStart bridge file (interactive tracking not active)
#   - the run record was already finalized

set -uo pipefail

input=$(cat 2>/dev/null || echo '{}')

session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
[ -z "$session_id" ] && exit 0

runs_root="${SCRIPT_RUNS_DIR:-$HOME/.script-runs/runs}"
state_dir="$(dirname "$runs_root")/.claude-sessions"
runid_file="$state_dir/${session_id}.runid"

[ ! -f "$runid_file" ] && exit 0

run_id=$(cat "$runid_file" 2>/dev/null)
[ -z "$run_id" ] && exit 0

run_file="$runs_root/${run_id}.json"
[ ! -f "$run_file" ] && exit 0

# Only beat the heart on records still in "running" status. Finalized records
# (success/failed/killed) shouldn't have lastProgressAt overwritten — that
# would re-open them visually in the dashboard.
status=$(jq -r '.status // empty' "$run_file" 2>/dev/null)
[ "$status" != "running" ] && exit 0

ts=$(date "+%Y-%m-%dT%H:%M:%S%z")
tmp="${run_file}.tmp.$$"
if jq --arg ts "$ts" '.lastProgressAt = $ts' "$run_file" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$run_file"
else
    rm -f "$tmp"
fi
