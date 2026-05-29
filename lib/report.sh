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
# When "0" (default), suppress notifications for successful interactive Claude
# sessions — too many per day to be useful. Interactive failures still notify.
SCRIPT_DASH_NOTIFY_INTERACTIVE="${SCRIPT_DASH_NOTIFY_INTERACTIVE:-0}"

# python3 owns all JSON serialization (escaping + atomic writes). It is a hard
# requirement: when absent, record-writing no-ops loudly rather than emit the
# corrupt JSON the old shell-level sed/tr fallback could produce.
_SD_PY="$(command -v python3 2>/dev/null || true)"

# --- Internal state ---
_SD_RUN_ID=""
_SD_RUN_FILE=""
_SD_OUTPUT_FILE=""
_SD_START_EPOCH=""
_SD_SCRIPT_NAME=""
_SD_CATEGORY=""
_SD_DESCRIPTION=""
_SD_ARTIFACTS=""        # Comma-separated JSON object entries, accumulated across report_artifact calls
_SD_REVIEW_REQUIRED="false"
_SD_LAST_PROGRESS_AT=""
_SD_LAST_PROGRESS_MSG=""
# Terminal-write fields, populated by report_end before the final record write.
_SD_EXIT_CODE=""
_SD_END_EPOCH=""
_SD_DURATION=""
_SD_OUTPUT=""

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

# _sd_write_record STATUS
#
# Write the run record atomically as valid JSON via python3, which owns all
# escaping and the tempfile+os.replace. Every field — including id/script/
# category/host — is passed through json.dumps, so no special character in any
# value can corrupt the record. (The previous heredoc left those four fields
# unescaped; a stray quote produced invalid JSON the server silently drops.)
#
# STATUS "running" writes the in-progress record (metadata only; the server
# serves the live .output file for running runs). A terminal status
# (success|failed|killed) additionally writes exitCode/endedAt/endEpoch/
# duration/output plus any artifacts and reviewRequired.
_sd_write_record() {
    local _sd_rec_status="$1"  # not `status` — that's read-only in zsh
    [ -z "$_SD_RUN_FILE" ] && return 0
    if [ -z "$_SD_PY" ]; then
        echo "script-dashboard: python3 required for run reporting; record not written" >&2
        return 0
    fi

    SD_REC_FILE="$_SD_RUN_FILE" \
    SD_ID="$_SD_RUN_ID" \
    SD_SCRIPT="$_SD_SCRIPT_NAME" \
    SD_CATEGORY="$_SD_CATEGORY" \
    SD_DESCRIPTION="$_SD_DESCRIPTION" \
    SD_STATUS="$_sd_rec_status" \
    SD_START_EPOCH="$_SD_START_EPOCH" \
    SD_PID="$$" \
    SD_HOST="$(hostname -s 2>/dev/null)" \
    SD_EXIT_CODE="$_SD_EXIT_CODE" \
    SD_END_EPOCH="$_SD_END_EPOCH" \
    SD_DURATION="$_SD_DURATION" \
    SD_OUTPUT="$_SD_OUTPUT" \
    SD_ARTIFACTS="$_SD_ARTIFACTS" \
    SD_REVIEW_REQUIRED="$_SD_REVIEW_REQUIRED" \
    SD_LAST_PROGRESS_AT="$_SD_LAST_PROGRESS_AT" \
    SD_LAST_PROGRESS_MSG="$_SD_LAST_PROGRESS_MSG" \
    "$_SD_PY" - <<'PY'
import json, os, tempfile
from datetime import datetime, timezone


def env(k):
    return os.environ.get(k, "")


def iso(epoch):
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


status = env("SD_STATUS")
rec = {
    "id": env("SD_ID"),
    "script": env("SD_SCRIPT"),
    "category": env("SD_CATEGORY"),
    "description": env("SD_DESCRIPTION"),
    "status": status,
    "startedAt": iso(env("SD_START_EPOCH")),
    "startEpoch": int(env("SD_START_EPOCH")),
    "pid": int(env("SD_PID")),
    "host": env("SD_HOST"),
}

if env("SD_LAST_PROGRESS_AT"):
    rec["lastProgressAt"] = env("SD_LAST_PROGRESS_AT")
    rec["lastProgressMessage"] = env("SD_LAST_PROGRESS_MSG")

if status != "running":
    rec["exitCode"] = int(env("SD_EXIT_CODE") or 0)
    rec["endedAt"] = iso(env("SD_END_EPOCH"))
    rec["endEpoch"] = int(env("SD_END_EPOCH"))
    rec["duration"] = int(env("SD_DURATION") or 0)
    rec["output"] = env("SD_OUTPUT")
    arts = env("SD_ARTIFACTS").strip()
    if arts:
        # Artifact entries are produced by report_artifact via json.dumps, so
        # this is always valid; tolerate a malformed accumulator rather than
        # losing the whole record.
        try:
            rec["artifacts"] = json.loads("[" + arts + "]")
        except json.JSONDecodeError:
            pass
    if env("SD_REVIEW_REQUIRED") == "true":
        rec["reviewRequired"] = True

dest = env("SD_REC_FILE")
fd, tmp = tempfile.mkstemp(
    dir=os.path.dirname(dest) or ".", prefix=".rec-", suffix=".tmp"
)
try:
    with os.fdopen(fd, "w") as f:
        json.dump(rec, f, indent=2)
    os.replace(tmp, dest)
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
PY
}

_sd_cmux_hook() {
    # Optional cmux integration. Set CMUX_WORKSPACE_ID and CMUX_SURFACE_ID
    # in ~/.config/script-dashboard/config.sh to route session-start/stop
    # events into a cmux workspace tab. No-op when unconfigured.
    local event="$1"  # session-start | stop
    [ -z "${CMUX_WORKSPACE_ID:-}" ] && return 0
    [ -z "${CMUX_SURFACE_ID:-}" ] && return 0
    command -v cmux >/dev/null 2>&1 || return 0

    local cmux_sid="${_SD_RUN_ID:-script-dash}"
    printf '{"session_id":"%s"}' "$cmux_sid" \
        | cmux claude-hook "$event" \
            --workspace "$CMUX_WORKSPACE_ID" \
            --surface "$CMUX_SURFACE_ID" \
            >/dev/null 2>&1 || true
}

_sd_notify() {
    local title="$1"
    local subtitle="$2"
    local message="$3"
    local url="${4:-}"

    [ "$SCRIPT_DASH_NOTIFY" = "0" ] && return 0

    if command -v terminal-notifier &>/dev/null; then
        local args=(-title "$title" -message "$message" -group "script-dashboard")
        [ -n "$subtitle" ] && args+=(-subtitle "$subtitle")
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
        # osascript fallback: subtitle goes inline with the title since the
        # `display notification` AppleScript verb has no separate subtitle.
        local osa_title="$title"
        [ -n "$subtitle" ] && osa_title="$title — $subtitle"
        osascript -e "display notification \"$message\" with title \"$osa_title\"" &>/dev/null &
    fi
}

# _sd_extract_notification_body OUTPUT
#
# Pull a useful one-liner from the captured output for the notification body.
# Skips structural labels ("Topic:", "Outcome:", "Ended (...)", etc.) and
# returns the first non-empty content line. Empty if nothing usable.
_sd_extract_notification_body() {
    local output="$1"
    [ -z "$output" ] && return 0
    printf '%s\n' "$output" | awk '
        # Skip section labels that exist only to structure the output for the
        # expanded card view. They are not useful as a notification body.
        /^(Topic|Outcome):?[[:space:]]*$/ { next }
        /^Ended[[:space:]]*\(/             { next }
        /^[[:space:]]*$/                   { next }
        { print; exit }
    '
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
    _SD_DESCRIPTION="$description"
    _SD_ARTIFACTS=""
    _SD_REVIEW_REQUIRED="false"
    _SD_LAST_PROGRESS_AT=""
    _SD_LAST_PROGRESS_MSG=""
    _SD_EXIT_CODE=""
    _SD_END_EPOCH=""
    _SD_DURATION=""
    _SD_OUTPUT=""
    _SD_START_EPOCH=$(_sd_epoch)
    _SD_RUN_ID="${name}-$(_sd_iso_date | tr ':' '-')-$$"
    _SD_RUN_FILE="${SCRIPT_RUNS_DIR}/${_SD_RUN_ID}.json"
    _SD_OUTPUT_FILE="${SCRIPT_RUNS_DIR}/${_SD_RUN_ID}.output"

    # Create output capture file
    : > "$_SD_OUTPUT_FILE"

    _sd_write_running_json
    _sd_cmux_hook session-start
}

# _sd_write_running_json
#
# (Re)write the in-progress run record. Called from report_start and
# report_progress. The server serves the live .output file for running runs,
# so the record carries metadata only — not the output.
_sd_write_running_json() {
    _sd_write_record "running"
}

# report_log MESSAGE
#
# Append a line to the run's output capture file.
# Use this inside your script to capture key output without redirecting all of stdout.
report_log() {
    [ -z "$_SD_OUTPUT_FILE" ] && return 0
    printf '%s\n' "$*" >> "$_SD_OUTPUT_FILE"
}

# report_progress MESSAGE
#
# Record a heartbeat: appends to the output file like report_log, then atomically
# rewrites the run JSON with lastProgressAt + a short message. The dashboard uses
# this to distinguish "running and making progress" from "running but stalled."
#
# Use sparingly — only for notable signal lines (phase transitions, pass-rate
# updates, errors). High-volume per-line output belongs in report_log.
report_progress() {
    local message="$*"
    [ -z "$_SD_RUN_FILE" ] && return 0
    printf '%s\n' "$message" >> "$_SD_OUTPUT_FILE"
    _SD_LAST_PROGRESS_AT=$(_sd_iso_date)
    _SD_LAST_PROGRESS_MSG="$message"
    _sd_write_running_json
}

# report_artifact TYPE LABEL PATH
#
# Declare an artifact the run produced. The dashboard uses this to offer
# in-browser review of the output (rendering, status/priority edits, archive).
#
# TYPE:  task-note | file | url
#   - task-note: a markdown file with YAML frontmatter that the dashboard can edit
#   - file:      any file (opens externally)
#   - url:       external link
# LABEL: human-readable label shown in the dashboard
# PATH:  absolute filesystem path (for task-note/file) or URL (for url type)
report_artifact() {
    local type="$1"
    local label="$2"
    local path="$3"
    [ -z "$_SD_PY" ] && return 0
    # Build the entry via json.dumps so every field (including type) is escaped;
    # the accumulator is then always valid JSON for _sd_write_record to splice.
    local entry
    entry=$(SD_T="$type" SD_L="$label" SD_P="$path" "$_SD_PY" -c \
'import json,os; print(json.dumps({"type":os.environ["SD_T"],"label":os.environ["SD_L"],"path":os.environ["SD_P"]}))')
    if [ -z "$_SD_ARTIFACTS" ]; then
        _SD_ARTIFACTS="$entry"
    else
        _SD_ARTIFACTS="$_SD_ARTIFACTS,$entry"
    fi
}

# report_artifacts TYPE LABEL PATH [TYPE LABEL PATH ...]
#
# Declare several artifacts from a flat list of (TYPE, LABEL, PATH) triples —
# the shape report-skill-end.sh and report-skill.sh accumulate from repeated
# --artifact flags. A trailing partial triple is ignored.
report_artifacts() {
    while [ $# -ge 3 ]; do
        report_artifact "$1" "$2" "$3"
        shift 3
    done
}

# report_review_required
#
# Flag the run as needing human review in the dashboard. Combine with
# report_artifact calls to make the outputs actionable.
report_review_required() {
    _SD_REVIEW_REQUIRED="true"
}

# report_end [EXIT_CODE]
#
# Call at the end of a script run. Updates the run record with final status.
# If EXIT_CODE is omitted, uses $? from the last command.
report_end() {
    local exit_code="${1:-$?}"
    local _sd_status="success"  # `status` collides with zsh's readonly built-in
    local end_epoch

    [ -z "$_SD_RUN_FILE" ] && return 0

    # Coerce a non-numeric exit code (e.g. a stray --exit-code arg) to a
    # failure so the comparisons and python int() below can't crash finalize
    # and strand the record in "running".
    case "$exit_code" in
        ''|*[!0-9]*) exit_code=1 ;;
    esac

    end_epoch=$(_sd_epoch)
    local duration=$(( end_epoch - _SD_START_EPOCH ))

    if [ "$exit_code" -eq 137 ] || [ "$exit_code" -eq 143 ]; then
        _sd_status="killed"
    elif [ "$exit_code" -ne 0 ]; then
        _sd_status="failed"
    fi

    # Read captured output (truncate to ~100KB to avoid bloat)
    local output=""
    if [ -f "$_SD_OUTPUT_FILE" ] && [ -s "$_SD_OUTPUT_FILE" ]; then
        output=$(tail -c 102400 "$_SD_OUTPUT_FILE")
    fi

    # Hand the terminal fields to the central writer (escaping + atomic write).
    _SD_EXIT_CODE="$exit_code"
    _SD_END_EPOCH="$end_epoch"
    _SD_DURATION="$duration"
    _SD_OUTPUT="$output"
    _sd_write_record "$_sd_status"

    # Format duration for notification
    local duration_str
    if [ "$duration" -ge 60 ]; then
        duration_str="$((duration / 60))m $((duration % 60))s"
    else
        duration_str="${duration}s"
    fi

    # Suppress noisy interactive-success notifications by default. Failures
    # always notify so they don't get lost.
    local _sd_should_notify=1
    if [ "$_SD_CATEGORY" = "interactive" ] \
        && [ "$_sd_status" = "success" ] \
        && [ "$SCRIPT_DASH_NOTIFY_INTERACTIVE" = "0" ]; then
        _sd_should_notify=0
    fi

    if [ "$_sd_should_notify" = "1" ]; then
        # Build status-aware title. Failures/kills get a verb so the title
        # itself reads as the alert; successes just carry the script name.
        local notif_title
        case "$_sd_status" in
            success) notif_title="$_SD_SCRIPT_NAME" ;;
            failed)  notif_title="$_SD_SCRIPT_NAME failed" ;;
            killed)  notif_title="$_SD_SCRIPT_NAME killed" ;;
            *)       notif_title="$_SD_SCRIPT_NAME" ;;
        esac

        local notif_subtitle="${_SD_CATEGORY} · ${duration_str}"

        # Try to extract a meaningful body line from the captured output;
        # fall back to the previous bracketed-icon format if nothing usable.
        local notif_body
        notif_body=$(_sd_extract_notification_body "$output")
        if [ -z "$notif_body" ]; then
            local icon=""
            case "$_sd_status" in
                success) icon="OK" ;;
                failed)  icon="FAIL" ;;
                killed)  icon="KILLED" ;;
            esac
            notif_body="[$icon] $_SD_SCRIPT_NAME (${duration_str})"
        fi

        _sd_notify \
            "$notif_title" \
            "$notif_subtitle" \
            "$notif_body" \
            "${SCRIPT_DASH_URL}?run=${_SD_RUN_ID}"
    fi

    _sd_cmux_hook stop

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
