#!/usr/bin/env bash
# hook-claude-session-end.sh — Claude Code SessionEnd hook handler.
#
# Finalizes the dashboard record opened by hook-claude-session-start.sh,
# looked up by Claude's session_id via the bridge file in
# ~/.script-runs/.claude-sessions/.
#
# Wire from ~/.claude/settings.json:
#   "hooks": {
#     "SessionEnd": [
#       { "matcher": "", "hooks": [
#         { "type": "command",
#           "command": "/path/to/hook-claude-session-end.sh",
#           "timeout": 5 }
#       ]}
#     ]
#   }
#
# When SessionEnd never fires (Claude crashes, force-quit, system reboot),
# the stale-run sweep picks up the orphan after STALE_RUN_THRESHOLD_MINUTES
# (default 30) and marks it killed. The Stop hook's heartbeat keeps active
# sessions alive past that threshold.

set -uo pipefail

input=$(cat 2>/dev/null || echo '{}')

session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
[ -z "$session_id" ] && exit 0

runs_root="${SCRIPT_RUNS_DIR:-$HOME/.script-runs/runs}"
state_dir="$(dirname "$runs_root")/.claude-sessions"
runid_file="$state_dir/${session_id}.runid"

# No matching SessionStart record means this session was tracked elsewhere
# (or SessionStart didn't fire for it). Silent no-op.
[ ! -f "$runid_file" ] && exit 0

# Bridge format may be JSON ({runid, transcript_path}) or plain text (legacy:
# just the run id). Try JSON first; fall back to treating the contents as raw
# text. Either way we exit cleanly if we can't extract a run id.
bridge=$(cat "$runid_file" 2>/dev/null)
run_id=$(printf '%s' "$bridge" | jq -r '.runid // empty' 2>/dev/null)
transcript_path=$(printf '%s' "$bridge" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$run_id" ]; then
    # Legacy plain-text bridge.
    run_id="$bridge"
    transcript_path=""
fi
if [ -z "$run_id" ]; then
    rm -f "$runid_file"
    exit 0
fi

# Reason for end. Claude may include "reason" in the payload (clear, logout,
# exit, etc.). Default to a generic "ended" when missing.
reason=$(printf '%s' "$input" | jq -r '.reason // "ended"' 2>/dev/null)
[ -z "$reason" ] && reason="ended"

# Extract enrichment from the JSONL transcript BEFORE finalizing the run, so
# we can pass it into the summary that report-skill-end writes to the output
# file. Best-effort: empty strings / zeros if extraction fails — finalization
# still proceeds with a bare reason.
topic=""
outcome=""
custom_title=""
git_branch=""
tools_total=0
tools_bash=0
tools_edit=0
tools_subagent=0
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    topic=$(jq -rs '
        (map(select(.type == "last-prompt")) | .[0]?.lastPrompt) // ""
    ' "$transcript_path" 2>/dev/null || printf '')
    custom_title=$(jq -rs '
        (map(select(.type == "custom-title")) | .[-1]?.customTitle) // ""
    ' "$transcript_path" 2>/dev/null || printf '')
    outcome=$(jq -rs '
        ((map(select(.type == "assistant")) | .[-1]?.message.content) // [])
        | map(select(.type == "text") | .text)
        | join("\n")
    ' "$transcript_path" 2>/dev/null || printf '')
    git_branch=$(jq -rs '
        ([.[] | select(.type == "attachment") | .gitBranch] | map(select(. != null and . != "")) | last) // ""
    ' "$transcript_path" 2>/dev/null || printf '')
    tools_total=$(jq -rs '
        [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")] | length
    ' "$transcript_path" 2>/dev/null || echo 0)
    tools_bash=$(jq -rs '
        [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Bash")] | length
    ' "$transcript_path" 2>/dev/null || echo 0)
    tools_edit=$(jq -rs '
        [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and (.name == "Edit" or .name == "Write" or .name == "MultiEdit"))] | length
    ' "$transcript_path" 2>/dev/null || echo 0)
    tools_subagent=$(jq -rs '
        [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Agent")] | length
    ' "$transcript_path" 2>/dev/null || echo 0)
fi

# Build a rich summary for the output file. Topic, outcome, and a meta line
# (branch + tool counts) — each section omitted if empty. Falls back to bare
# reason when no enrichment is available at all.
summary=""
[ -n "$topic" ] && summary="${summary}Topic:"$'\n'"$topic"$'\n\n'
[ -n "$outcome" ] && summary="${summary}Outcome:"$'\n'"$outcome"$'\n\n'

meta=""
[ -n "$git_branch" ] && meta="branch: $git_branch"
if [ "${tools_total:-0}" -gt 0 ] 2>/dev/null; then
    [ -n "$meta" ] && meta="$meta · "
    meta="${meta}${tools_total} tools (${tools_bash} bash, ${tools_edit} edits, ${tools_subagent} subagents)"
fi
[ -n "$meta" ] && summary="${summary}${meta}"$'\n\n'

if [ -n "$summary" ]; then
    summary="${summary}Ended ($reason)"
else
    summary="Session $reason"
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
bash "$script_dir/report-skill-end.sh" "$run_id" "$summary" 2>/dev/null || true

# Patch the finalized run record with structured enrichment fields. Topic and
# outcome cap at 500 chars (header rendering); tool counts and branch are tiny.
# Best-effort: any failure leaves the record valid (just un-enriched).
if [ -n "$topic" ] || [ -n "$outcome" ] || [ -n "$custom_title" ] || [ -n "$git_branch" ] || [ "${tools_total:-0}" -gt 0 ] 2>/dev/null; then
    run_file="$runs_root/${run_id}.json"
    if [ -f "$run_file" ]; then
        python3 - "$run_file" "$topic" "$outcome" "$custom_title" "$git_branch" \
            "$tools_total" "$tools_bash" "$tools_edit" "$tools_subagent" \
            <<'PY' 2>/dev/null || true
import json
import os
import sys
import tempfile

(run_file, topic, outcome, custom_title, git_branch,
 t_total, t_bash, t_edit, t_subagent) = sys.argv[1:10]

def cap(s, n=500):
    s = (s or "").strip()
    if not s:
        return ""
    return s[: n - 1] + "…" if len(s) > n else s

def int_or_zero(s):
    try:
        return int(s)
    except (TypeError, ValueError):
        return 0

with open(run_file) as f:
    rec = json.load(f)

t = cap(topic)
o = cap(outcome)
ct = cap(custom_title)
if t:
    rec["topic"] = t
if o:
    rec["outcome"] = o
if ct:
    rec["customTitle"] = ct
gb = (git_branch or "").strip()
if gb:
    rec["gitBranch"] = gb

total = int_or_zero(t_total)
if total > 0:
    rec["tools"] = {
        "total": total,
        "bash": int_or_zero(t_bash),
        "edit": int_or_zero(t_edit),
        "subagent": int_or_zero(t_subagent),
    }

target_dir = os.path.dirname(run_file) or "."
fd, tmp = tempfile.mkstemp(prefix=".run-enrich-", dir=target_dir)
try:
    with os.fdopen(fd, "w") as f:
        json.dump(rec, f, indent=2)
    os.replace(tmp, run_file)
except Exception:
    try:
        os.unlink(tmp)
    except FileNotFoundError:
        pass
    raise
PY
    fi
fi

rm -f "$runid_file"

