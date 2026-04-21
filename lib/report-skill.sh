#!/usr/bin/env bash
# report-skill.sh — One-shot reporter for Claude Code skills and slash commands.
#
# Basic usage (from a Bash tool call inside a skill):
#   bash ~/Repos/personal/script-dashboard/lib/report-skill.sh "main-sync" "Pulled 12 commits from main."
#
# With category (legacy positional, or --category):
#   bash report-skill.sh "main-sync" "summary" "skill"
#   bash report-skill.sh "main-sync" "summary" --category skill
#
# With review flag and artifacts:
#   bash report-skill.sh "slack-saved-sync" "Created 2 Task Notes" \
#     --review \
#     --artifact task-note "Follow up - Jane" "/path/to/Slack follow-up - Jane.md" \
#     --artifact task-note "Follow up - Anurag" "/path/to/Slack follow-up - Anurag.md"
#
# This is a simpler alternative to sourcing report.sh when you just need
# to log a completed action with a summary — no start/end lifecycle.

set -euo pipefail

if [ $# -lt 2 ]; then
    echo "Usage: report-skill.sh SCRIPT_NAME SUMMARY [CATEGORY] [--category C] [--review] [--artifact TYPE LABEL PATH]..." >&2
    exit 2
fi

SCRIPT_NAME="$1"
SUMMARY="$2"
shift 2

CATEGORY="skill"
REVIEW_REQUIRED="false"
# Flat list of artifact arguments in groups of 3: TYPE LABEL PATH
ARTIFACT_ARGS=()

# Optional legacy positional category — accepted only if it's not a flag.
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
    CATEGORY="$1"
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
        --review)
            REVIEW_REQUIRED="true"
            shift
            ;;
        --artifact)
            if [ $# -lt 4 ]; then
                echo "--artifact requires TYPE LABEL PATH" >&2
                exit 2
            fi
            ARTIFACT_ARGS+=("$2" "$3" "$4")
            shift 4
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

report_start "$SCRIPT_NAME" "$CATEGORY" "$SUMMARY"
report_log "$SUMMARY"

if [ "$REVIEW_REQUIRED" = "true" ]; then
    report_review_required
fi

# Walk artifact triples (TYPE LABEL PATH)
i=0
while [ $i -lt ${#ARTIFACT_ARGS[@]} ]; do
    report_artifact "${ARTIFACT_ARGS[$i]}" "${ARTIFACT_ARGS[$((i + 1))]}" "${ARTIFACT_ARGS[$((i + 2))]}"
    i=$((i + 3))
done

report_end 0
