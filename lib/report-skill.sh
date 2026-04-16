#!/usr/bin/env bash
# report-skill.sh — One-shot reporter for Claude Code skills and slash commands.
#
# Usage (from a Bash tool call inside a skill):
#   bash ~/.script-runs/report-skill.sh "main-sync" "Pulled 12 commits from main. Key changes: ..."
#
# Or with explicit category:
#   bash ~/.script-runs/report-skill.sh "main-sync" "summary" "skill"
#
# This is a simpler alternative to sourcing report.sh when you just need
# to log a completed action with a summary — no start/end lifecycle.

set -euo pipefail

SCRIPT_NAME="${1:?Usage: report-skill.sh SCRIPT_NAME SUMMARY [CATEGORY]}"
SUMMARY="${2:?Usage: report-skill.sh SCRIPT_NAME SUMMARY [CATEGORY]}"
CATEGORY="${3:-skill}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/report.sh"

report_start "$SCRIPT_NAME" "$CATEGORY" "$SUMMARY"
report_log "$SUMMARY"
report_end 0
