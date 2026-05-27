#!/usr/bin/env bash
# report-skill-start.sh — Open a "running" dashboard record for a skill/slash command.
#
# Pairs with report-skill-end.sh. Use this when a skill takes long enough that
# you want it visible on the dashboard while it runs (not just after it finishes).
#
# Prints the new run ID to stdout. Capture it and pass it to report-skill-end.sh
# at the end of the skill.
#
# Usage (from a Bash tool call inside a skill):
#   RUN_ID=$(bash ~/Repos/personal/script-dashboard/lib/report-skill-start.sh \
#     "refresh-schedule" "Mid-day schedule refresh")
#
# With category:
#   bash report-skill-start.sh "my-skill" "Description" --category skill
#
# Because each Bash tool call runs in a fresh subshell, the library's usual
# `source report.sh` + EXIT-trap pattern doesn't work across calls. This
# script disables the trap before exit so the "running" record persists until
# report-skill-end.sh finalizes it.

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: report-skill-start.sh SCRIPT_NAME [DESCRIPTION] [--category C]" >&2
    exit 2
fi

SCRIPT_NAME="$1"
shift

# Env var lets a wrapping launchd job pin the dashboard lane without needing
# to plumb a CLI flag through every skill invocation. Explicit --category
# still wins (handled below).
CATEGORY="${SCRIPT_DASH_CATEGORY:-skill}"
DESCRIPTION=""

# Optional positional description (anything not starting with --).
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
    DESCRIPTION="$1"
    shift
fi

while [ $# -gt 0 ]; do
    case "$1" in
        --category)
            if [ $# -lt 2 ]; then
                echo "--category requires a value" >&2
                exit 2
            fi
            CATEGORY="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/report.sh"

# report.sh installs `trap _sd_cleanup EXIT`, which would finalize the record
# as "killed" when this short-lived script exits. We want the record to stay
# "running" until report-skill-end.sh is called, so clear the trap.
trap - EXIT

report_start "$SCRIPT_NAME" "$CATEGORY" "$DESCRIPTION"

printf '%s\n' "$_SD_RUN_ID"
