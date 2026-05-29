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

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$script_dir/hook-claude-common.sh"
sd_hook_have_jq || exit 0

input=$(cat 2>/dev/null || echo '{}')
session_id=$(sd_hook_session_id "$input")
[ -z "$session_id" ] && exit 0

runid_file="$(sd_hook_runid_file "$session_id")"
[ ! -f "$runid_file" ] && exit 0

sd_hook_read_bridge "$runid_file" || exit 0
run_id="$SD_RUN_ID"
transcript_path="$SD_TRANSCRIPT_PATH"

run_file="$(sd_hook_runs_root)/${run_id}.json"
[ ! -f "$run_file" ] && exit 0

# Only beat the heart on records still in "running" status. Finalized records
# (success/failed/killed) shouldn't have lastProgressAt overwritten — that
# would re-open them visually in the dashboard.
status=$(jq -r '.status // empty' "$run_file" 2>/dev/null)
[ "$status" != "running" ] && exit 0

ts=$(date "+%Y-%m-%dT%H:%M:%S%z")

# Opportunistic topic extraction: only pull the first user prompt if the
# record doesn't yet have a topic (SessionEnd sets it authoritatively later),
# so a running row shows what it's about. Best-effort — the heartbeat update
# below proceeds regardless.
topic=""
existing_topic=$(jq -r '.topic // empty' "$run_file" 2>/dev/null)
if [ -z "$existing_topic" ]; then
    topic="$(sd_hook_extract_topic "$transcript_path")"
fi

# Always re-pull the latest custom title — Claude Code refines it as the
# conversation grows, so we want the freshest value on every heartbeat.
custom_title="$(sd_hook_extract_custom_title "$transcript_path")"

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
