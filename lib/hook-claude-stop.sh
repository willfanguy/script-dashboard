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

# Bridge format may be JSON ({runid, transcript_path}) or plain text (legacy:
# just the run id). Mirror SessionEnd's parsing so the SessionStart hook's
# JSON format doesn't silently break heartbeats.
bridge=$(cat "$runid_file" 2>/dev/null)
run_id=$(printf '%s' "$bridge" | jq -r '.runid // empty' 2>/dev/null)
transcript_path=$(printf '%s' "$bridge" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$run_id" ]; then
    run_id="$bridge"
    transcript_path=""
fi
[ -z "$run_id" ] && exit 0

run_file="$runs_root/${run_id}.json"
[ ! -f "$run_file" ] && exit 0

# Only beat the heart on records still in "running" status. Finalized records
# (success/failed/killed) shouldn't have lastProgressAt overwritten — that
# would re-open them visually in the dashboard.
status=$(jq -r '.status // empty' "$run_file" 2>/dev/null)
[ "$status" != "running" ] && exit 0

ts=$(date "+%Y-%m-%dT%H:%M:%S%z")

# Opportunistic topic extraction: if the record doesn't yet have a topic
# (set later by SessionEnd) and the transcript is readable, pull the first
# user prompt now so the row shows what the session is about while it's
# still running. Best-effort — heartbeat update proceeds regardless.
needs_topic="false"
existing_topic=$(jq -r '.topic // empty' "$run_file" 2>/dev/null)
if [ -z "$existing_topic" ] && [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    needs_topic="true"
fi

topic=""
if [ "$needs_topic" = "true" ]; then
    topic=$(jq -rs '
        (map(select(.type == "last-prompt")) | .[0]?.lastPrompt) // ""
    ' "$transcript_path" 2>/dev/null || printf '')
fi

# Always re-pull the latest custom-title — Claude Code refines the title as
# the conversation grows (auto-renames many times per session), so we want
# the freshest value on every heartbeat, not just once.
custom_title=""
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    custom_title=$(jq -rs '
        (map(select(.type == "custom-title")) | .[-1]?.customTitle) // ""
    ' "$transcript_path" 2>/dev/null || printf '')
fi

tmp="${run_file}.tmp.$$"
# Build the jq patch dynamically: always update lastProgressAt; set topic on
# first capture; set customTitle every heartbeat if the JSONL has one. Each
# field caps at 500 chars to keep run records small.
jq_filter='.lastProgressAt = $ts'
if [ -n "$topic" ]; then
    jq_filter="$jq_filter | .topic = (if (\$topic | length) > 500 then (\$topic[0:499] + \"…\") else \$topic end)"
fi
if [ -n "$custom_title" ]; then
    jq_filter="$jq_filter | .customTitle = (if (\$customTitle | length) > 500 then (\$customTitle[0:499] + \"…\") else \$customTitle end)"
fi

if jq \
    --arg ts "$ts" \
    --arg topic "$topic" \
    --arg customTitle "$custom_title" \
    "$jq_filter" \
    "$run_file" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$run_file"
else
    rm -f "$tmp"
fi
