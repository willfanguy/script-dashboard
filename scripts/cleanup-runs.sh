#!/usr/bin/env bash
# Nightly cleanup of old run records.
#
# Prunes successful runs after COMPLETED_DAYS and failed/killed runs after
# FAILED_DAYS by calling POST /api/runs/cleanup. Running runs are never touched.
#
# Intended to be invoked by a launchd agent (see launchd/com.user.script-dashboard.cleanup.plist).

set -u
set -o pipefail 2>/dev/null || true

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=../lib/report.sh
source "$SCRIPT_DIR/../lib/report.sh"

COMPLETED_DAYS="${COMPLETED_DAYS:-7}"
FAILED_DAYS="${FAILED_DAYS:-30}"

report_start "cleanup-runs" "scheduled" "Prune run records (completed ${COMPLETED_DAYS}d, failed ${FAILED_DAYS}d)"

url="${SCRIPT_DASH_URL:-http://localhost:7890}/api/runs/cleanup"
payload=$(printf '{"completedDays":%s,"failedDays":%s}' "$COMPLETED_DAYS" "$FAILED_DAYS")

report_log "POST $url $payload"

if ! response=$(curl -fsS -X POST "$url" -H "Content-Type: application/json" -d "$payload" 2>&1); then
    report_log "Cleanup request failed: $response"
    report_end 1
    exit 1
fi

report_log "$response"
report_end 0
