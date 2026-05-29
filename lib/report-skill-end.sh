#!/usr/bin/env bash
# report-skill-end.sh — Finalize a dashboard record opened by report-skill-start.sh.
#
# Rehydrates the in-progress JSON written by report-skill-start.sh, appends the
# summary to the output capture file, and updates the record with final status.
#
# Usage:
#   bash ~/Repos/personal/script-dashboard/lib/report-skill-end.sh RUN_ID "Summary line"
#
# With review flag and artifacts:
#   bash report-skill-end.sh "$RUN_ID" "Created 2 task notes" \
#     --review \
#     --artifact task-note "Follow up - Jane" "/path/to/file.md"
#
# With non-zero exit code (marks as failed):
#   bash report-skill-end.sh "$RUN_ID" "Aborted mid-phase" --exit-code 1

set -euo pipefail

if [ $# -lt 2 ]; then
    echo "Usage: report-skill-end.sh RUN_ID SUMMARY [--review] [--artifact TYPE LABEL PATH]... [--decisions-file PATH] [--exit-code N]" >&2
    exit 2
fi

RUN_ID="$1"
SUMMARY="$2"
shift 2

REVIEW_REQUIRED="false"
EXIT_CODE=0
ARTIFACT_ARGS=()
DECISIONS_FILE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --review)
            REVIEW_REQUIRED="true"
            shift
            ;;
        --exit-code)
            if [ $# -lt 2 ]; then
                echo "--exit-code requires a value" >&2
                exit 2
            fi
            case "$2" in
                ''|*[!0-9]*)
                    echo "--exit-code must be a non-negative integer, got: $2" >&2
                    exit 2
                    ;;
            esac
            EXIT_CODE="$2"
            shift 2
            ;;
        --artifact)
            if [ $# -lt 4 ]; then
                echo "--artifact requires TYPE LABEL PATH" >&2
                exit 2
            fi
            ARTIFACT_ARGS+=("$2" "$3" "$4")
            shift 4
            ;;
        --decisions-file)
            # JSON file mapping artifact path → decision metadata object.
            # See server/index.ts ArtifactDecision for the schema. The end
            # script merges these into the run record's artifacts array.
            if [ $# -lt 2 ]; then
                echo "--decisions-file requires a path" >&2
                exit 2
            fi
            DECISIONS_FILE="$2"
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

# Disable report.sh's EXIT trap — we're manually rehydrating state and don't
# want cleanup second-guessing us.
trap - EXIT

RUN_FILE="${SCRIPT_RUNS_DIR}/${RUN_ID}.json"
OUTPUT_FILE="${SCRIPT_RUNS_DIR}/${RUN_ID}.output"

if [ ! -f "$RUN_FILE" ]; then
    echo "Run record not found: $RUN_FILE" >&2
    exit 1
fi

# Rehydrate the internal state report_end needs. Description and progress
# heartbeats live on the running record; pull them in so the finalized record
# retains them instead of dropping context the start script wrote.
_SD_RUN_ID="$RUN_ID"
_SD_RUN_FILE="$RUN_FILE"
_SD_OUTPUT_FILE="$OUTPUT_FILE"
_SD_ARTIFACTS=""
_SD_REVIEW_REQUIRED="false"

# Read all rehydrated fields in a single python3 call (was five) — fewer
# subprocesses and one failure path under `set -e` instead of five. Fields are
# NUL-separated so descriptions / progress messages containing newlines or tabs
# survive intact (bash can't hold NULs in a variable, so we stream + read).
{
    IFS= read -r -d '' _SD_SCRIPT_NAME
    IFS= read -r -d '' _SD_CATEGORY
    IFS= read -r -d '' _SD_START_EPOCH
    IFS= read -r -d '' _SD_DESCRIPTION
    IFS= read -r -d '' _SD_LAST_PROGRESS_AT
    IFS= read -r -d '' _SD_LAST_PROGRESS_MSG
} < <(python3 - "$RUN_FILE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for v in (
    d.get("script") or "",
    d.get("category") or "",
    str(d.get("startEpoch") or ""),
    d.get("description") or "",
    d.get("lastProgressAt") or "",
    d.get("lastProgressMessage") or "",
):
    sys.stdout.write(v + "\0")
PY
)

# Ensure the output file exists (report-skill-start.sh creates it, but guard anyway).
[ -f "$_SD_OUTPUT_FILE" ] || : > "$_SD_OUTPUT_FILE"

report_log "$SUMMARY"

if [ "$REVIEW_REQUIRED" = "true" ]; then
    report_review_required
fi

i=0
while [ $i -lt ${#ARTIFACT_ARGS[@]} ]; do
    report_artifact "${ARTIFACT_ARGS[$i]}" "${ARTIFACT_ARGS[$((i + 1))]}" "${ARTIFACT_ARGS[$((i + 2))]}"
    i=$((i + 3))
done

report_end "$EXIT_CODE"

# If a decisions file was provided, merge it into the artifacts array after
# report_end writes the final JSON. Python handles the JSON edit atomically so
# we don't risk a corrupt half-write if anything errors mid-merge.
if [ -n "$DECISIONS_FILE" ]; then
    if [ ! -f "$DECISIONS_FILE" ]; then
        echo "Decisions file not found: $DECISIONS_FILE" >&2
        exit 1
    fi
    python3 - "$RUN_FILE" "$DECISIONS_FILE" <<'PY'
import json
import os
import sys
import tempfile

run_file, decisions_file = sys.argv[1], sys.argv[2]

with open(run_file) as f:
    record = json.load(f)
with open(decisions_file) as f:
    decisions = json.load(f)
if not isinstance(decisions, dict):
    raise SystemExit(f"Decisions file must be a JSON object, got {type(decisions).__name__}")

artifacts = record.get("artifacts") or []
for art in artifacts:
    path = art.get("path")
    if path and path in decisions:
        art["decision"] = decisions[path]
record["artifacts"] = artifacts

# Atomic rewrite — write to a temp file in the same dir, then rename.
target_dir = os.path.dirname(run_file) or "."
fd, tmp = tempfile.mkstemp(prefix=".run-merge-", dir=target_dir)
try:
    with os.fdopen(fd, "w") as f:
        json.dump(record, f, indent=2)
    os.replace(tmp, run_file)
except Exception:
    os.unlink(tmp)
    raise
PY
fi
