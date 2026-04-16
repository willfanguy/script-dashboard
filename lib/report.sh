#!/usr/bin/env bash
# report.sh — Shell library for reporting script runs to the dashboard.
#
# Usage:
#   source /path/to/script-dashboard/lib/report.sh
#   report_start "morning-plan" "scheduled"
#   # ... your script logic ...
#   report_end $?
#
# Or wrap an existing command:
#   source /path/to/script-dashboard/lib/report.sh
#   report_exec "morning-plan" "scheduled" -- your-command --with-args
#
# Environment:
#   SCRIPT_RUNS_DIR  — where run records are stored (default: ~/.script-runs/runs)
#   SCRIPT_DASH_URL  — dashboard URL for notifications (default: http://localhost:7890)
#   SCRIPT_DASH_NOTIFY — set to "0" to suppress notifications

set -o pipefail 2>/dev/null || true

# --- Configuration (overridable via env or config file) ---

_SD_CONFIG_FILE="${SCRIPT_DASH_CONFIG:-${HOME}/.config/script-dashboard/config.sh}"
if [ -f "$_SD_CONFIG_FILE" ]; then
    # shellcheck source=/dev/null
    source "$_SD_CONFIG_FILE"
fi

SCRIPT_RUNS_DIR="${SCRIPT_RUNS_DIR:-${HOME}/.script-runs/runs}"
SCRIPT_DASH_URL="${SCRIPT_DASH_URL:-http://localhost:7890}"
SCRIPT_DASH_BROWSER="${SCRIPT_DASH_BROWSER:-}"
SCRIPT_DASH_NOTIFY="${SCRIPT_DASH_NOTIFY:-1}"

# --- Internal state ---
_SD_RUN_ID=""
_SD_RUN_FILE=""
_SD_OUTPUT_FILE=""
_SD_START_EPOCH=""
_SD_SCRIPT_NAME=""
_SD_CATEGORY=""

# --- Helpers ---

_sd_epoch() {
    date +%s
}

_sd_iso_date() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

_sd_ensure_dir() {
    mkdir -p "$SCRIPT_RUNS_DIR"
}

_sd_json_escape() {
    # Escape a string for safe JSON embedding.
    # Handles backslashes, quotes, newlines, tabs, and control characters.
    local str="$1"
    printf '%s' "$str" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()), end="")' 2>/dev/null \
        || printf '"%s"' "$(printf '%s' "$str" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' ')"
}

_sd_notify() {
    local title="$1"
    local message="$2"
    local url="${3:-}"

    [ "$SCRIPT_DASH_NOTIFY" = "0" ] && return 0

    if command -v terminal-notifier &>/dev/null; then
        local args=(-title "$title" -message "$message" -group "script-dashboard")
        if [ -n "$url" ]; then
            if [ -n "$SCRIPT_DASH_BROWSER" ]; then
                # Open in a specific browser app when clicked
                args+=(-execute "open -a '$SCRIPT_DASH_BROWSER' '$url'")
            else
                # Open in default browser when clicked
                args+=(-open "$url")
            fi
        fi
        terminal-notifier "${args[@]}" &>/dev/null &
    else
        osascript -e "display notification \"$message\" with title \"$title\"" &>/dev/null &
    fi
}

# --- Public API ---

# report_start SCRIPT_NAME CATEGORY [DESCRIPTION]
#
# Call at the start of a script run. Creates the run record with status "running".
# CATEGORY: one of "scheduled", "meeting", "manual", "hook"
report_start() {
    local name="$1"
    local category="${2:-manual}"
    local description="${3:-}"

    _sd_ensure_dir

    _SD_SCRIPT_NAME="$name"
    _SD_CATEGORY="$category"
    _SD_START_EPOCH=$(_sd_epoch)
    _SD_RUN_ID="${name}-$(_sd_iso_date | tr ':' '-')-$$"
    _SD_RUN_FILE="${SCRIPT_RUNS_DIR}/${_SD_RUN_ID}.json"
    _SD_OUTPUT_FILE="${SCRIPT_RUNS_DIR}/${_SD_RUN_ID}.output"

    # Create output capture file
    : > "$_SD_OUTPUT_FILE"

    # Write initial run record
    local desc_json
    desc_json=$(_sd_json_escape "$description")

    cat > "${_SD_RUN_FILE}.tmp" << ENDJSON
{
  "id": "$_SD_RUN_ID",
  "script": "$name",
  "category": "$category",
  "description": $desc_json,
  "status": "running",
  "startedAt": "$(_sd_iso_date)",
  "startEpoch": $_SD_START_EPOCH,
  "pid": $$,
  "host": "$(hostname -s)"
}
ENDJSON
    mv "${_SD_RUN_FILE}.tmp" "$_SD_RUN_FILE"
}

# report_log MESSAGE
#
# Append a line to the run's output capture file.
# Use this inside your script to capture key output without redirecting all of stdout.
report_log() {
    [ -z "$_SD_OUTPUT_FILE" ] && return 0
    printf '%s\n' "$*" >> "$_SD_OUTPUT_FILE"
}

# report_end [EXIT_CODE]
#
# Call at the end of a script run. Updates the run record with final status.
# If EXIT_CODE is omitted, uses $? from the last command.
report_end() {
    local exit_code="${1:-$?}"
    local status="success"
    local end_epoch

    [ -z "$_SD_RUN_FILE" ] && return 0

    end_epoch=$(_sd_epoch)
    local duration=$(( end_epoch - _SD_START_EPOCH ))

    if [ "$exit_code" -eq 137 ] || [ "$exit_code" -eq 143 ]; then
        status="killed"
    elif [ "$exit_code" -ne 0 ]; then
        status="failed"
    fi

    # Read captured output (truncate to ~100KB to avoid bloat)
    local output=""
    if [ -f "$_SD_OUTPUT_FILE" ] && [ -s "$_SD_OUTPUT_FILE" ]; then
        output=$(tail -c 102400 "$_SD_OUTPUT_FILE")
    fi
    local output_json
    output_json=$(_sd_json_escape "$output")

    # Update run record atomically
    local desc_json
    desc_json=$(_sd_json_escape "${3:-}")

    cat > "${_SD_RUN_FILE}.tmp" << ENDJSON
{
  "id": "$_SD_RUN_ID",
  "script": "$_SD_SCRIPT_NAME",
  "category": "$_SD_CATEGORY",
  "status": "$status",
  "exitCode": $exit_code,
  "startedAt": "$(date -u -r "$_SD_START_EPOCH" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "endedAt": "$(_sd_iso_date)",
  "startEpoch": $_SD_START_EPOCH,
  "endEpoch": $end_epoch,
  "duration": $duration,
  "pid": $$,
  "host": "$(hostname -s)",
  "output": $output_json
}
ENDJSON
    mv "${_SD_RUN_FILE}.tmp" "$_SD_RUN_FILE"

    # Send notification
    local icon=""
    case "$status" in
        success) icon="OK" ;;
        failed)  icon="FAIL" ;;
        killed)  icon="KILLED" ;;
    esac

    local duration_str
    if [ "$duration" -ge 60 ]; then
        duration_str="$((duration / 60))m $((duration % 60))s"
    else
        duration_str="${duration}s"
    fi

    _sd_notify \
        "Script Dashboard" \
        "[$icon] $_SD_SCRIPT_NAME (${duration_str})" \
        "${SCRIPT_DASH_URL}?run=${_SD_RUN_ID}"

    # Clean up output capture file (content is in the JSON now)
    rm -f "$_SD_OUTPUT_FILE"

    # Clear state so the EXIT trap doesn't re-fire
    _SD_RUN_FILE=""
    _SD_OUTPUT_FILE=""
}

# report_exec SCRIPT_NAME CATEGORY [DESCRIPTION] -- COMMAND [ARGS...]
#
# Convenience wrapper: calls report_start, runs the command (capturing output),
# then calls report_end with the command's exit code.
report_exec() {
    local name="$1"; shift
    local category="$1"; shift
    local description=""

    # Check for optional description before --
    if [ "$1" != "--" ]; then
        description="$1"; shift
    fi

    # Consume the -- separator
    [ "$1" = "--" ] && shift

    report_start "$name" "$category" "$description"

    # Run the command, teeing output to our capture file
    local rc=0
    "$@" 2>&1 | tee -a "$_SD_OUTPUT_FILE" || rc=${PIPESTATUS[0]:-$?}

    report_end "$rc"
    return "$rc"
}

# --- Cleanup on unexpected exit ---
_sd_cleanup() {
    if [ -n "$_SD_RUN_FILE" ] && [ -f "$_SD_RUN_FILE" ]; then
        local current_status
        current_status=$(python3 -c "import json; print(json.load(open('$_SD_RUN_FILE'))['status'])" 2>/dev/null || echo "unknown")
        if [ "$current_status" = "running" ]; then
            report_end 130  # Treat as interrupted
        fi
    fi
}
trap _sd_cleanup EXIT
