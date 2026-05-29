#!/usr/bin/env bash
# hook-claude-common.sh — shared helpers for the Claude Code lifecycle hooks
# (hook-claude-session-start.sh, hook-claude-stop.sh, hook-claude-session-end.sh).
#
# Sourced, not executed. Keeps the session_id/bridge/transcript plumbing in one
# place so the three hooks can't drift — stop and session-end previously each
# carried their own copy of the bridge parser, with a comment warning one to
# "mirror" the other.

# sd_hook_have_jq — true when jq is available. The hooks parse Claude's JSON
# payload and the JSONL transcript with jq; without it they no-op silently
# (interactive tracking just stops) rather than erroring on every response.
sd_hook_have_jq() {
    command -v jq >/dev/null 2>&1
}

# sd_hook_session_id INPUT — echo the session_id from a Claude hook payload.
sd_hook_session_id() {
    printf '%s' "$1" | jq -r '.session_id // empty' 2>/dev/null
}

# sd_hook_runs_root — echo the dashboard runs directory root.
sd_hook_runs_root() {
    printf '%s' "${SCRIPT_RUNS_DIR:-$HOME/.script-runs/runs}"
}

# sd_hook_runid_file SESSION_ID — echo the bridge-file path mapping a Claude
# session_id to its dashboard run id.
sd_hook_runid_file() {
    local runs_root state_dir
    runs_root="$(sd_hook_runs_root)"
    state_dir="$(dirname "$runs_root")/.claude-sessions"
    printf '%s/%s.runid' "$state_dir" "$1"
}

# sd_hook_read_bridge RUNID_FILE — read the bridge file and set SD_RUN_ID and
# SD_TRANSCRIPT_PATH. The bridge is JSON ({runid, transcript_path}) written by
# session-start, or legacy plain text (just the run id) for sessions in flight
# across the format change. Returns non-zero (and leaves SD_RUN_ID empty) when
# no run id can be extracted.
sd_hook_read_bridge() {
    local bridge
    bridge=$(cat "$1" 2>/dev/null)
    SD_RUN_ID=$(printf '%s' "$bridge" | jq -r '.runid // empty' 2>/dev/null)
    SD_TRANSCRIPT_PATH=$(printf '%s' "$bridge" | jq -r '.transcript_path // empty' 2>/dev/null)
    if [ -z "$SD_RUN_ID" ]; then
        SD_RUN_ID="$bridge"
        SD_TRANSCRIPT_PATH=""
    fi
    [ -n "$SD_RUN_ID" ]
}

# sd_hook_extract_topic TRANSCRIPT — echo the session's first user prompt (its
# "topic"), or empty. Safe on a missing/unreadable transcript.
sd_hook_extract_topic() {
    { [ -n "$1" ] && [ -f "$1" ]; } || return 0
    jq -rs '(map(select(.type == "last-prompt")) | .[0]?.lastPrompt) // ""' \
        "$1" 2>/dev/null || printf ''
}

# sd_hook_extract_custom_title TRANSCRIPT — echo the latest Claude-assigned
# custom title (refined as the conversation grows), or empty.
sd_hook_extract_custom_title() {
    { [ -n "$1" ] && [ -f "$1" ]; } || return 0
    jq -rs '(map(select(.type == "custom-title")) | .[-1]?.customTitle) // ""' \
        "$1" 2>/dev/null || printf ''
}
