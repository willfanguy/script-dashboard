# Script Dashboard

A local dashboard for monitoring automation script runs — launchd agents, MeetingBar triggers, and on-demand Claude Code skills.

## Quick Start

```bash
npm install
npm run dev          # Starts API (port 7890) + Vite dev server (port 5173)
```

Production:
```bash
npm run build        # Build frontend
npm start            # Start API server (serves from dist/)
```

## Testing

```bash
npm test             # Run tests once
npm run test:watch   # Watch mode
```

- **Framework**: Vitest
- **Test location**: `src/__tests__/`
- **Extracted utilities**: `src/utils/formatting.ts` (pure functions extracted from RunCard.tsx for testability)
- **Policy**: Follows workspace-level Testing Standards

### Test coverage

- `formatting.ts` — formatDuration, statusVariant, timeAgo, formatDate (all with frozen timers)
- `RunList.tsx` — groupByCategory ordering, registry respect, unknown categories, empty input

### Not yet tested

- `server/index.ts` — readRunFiles, Express endpoints, cleanup logic
- SSE event streaming
- `use-runs.ts` hook

## Architecture

```
┌──────────────────┐     source lib/report.sh     ┌──────────────────┐
│  Your Scripts     │ ──────────────────────────▶  │ ~/.script-runs/  │
│  (launchd, etc.)  │     writes JSON per run      │   runs/*.json    │
└──────────────────┘                               └────────┬─────────┘
                                                            │ reads
                                                   ┌────────▼─────────┐
                                                   │  Express API     │
                                                   │  :7890/api/runs  │
                                                   └────────┬─────────┘
                                                            │ fetch
                                                   ┌────────▼─────────┐
                                                   │  React Frontend  │
                                                   │  :5173 (dev)     │
                                                   └──────────────────┘
```

**Data flow:** Scripts source `lib/report.sh` which writes structured JSON to `~/.script-runs/runs/`. The Express backend reads that directory. The React frontend fetches from the API.

**Notifications:** On script completion, `report.sh` sends a macOS notification (via `terminal-notifier`) with a clickable link to the dashboard.

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui
- **Backend:** Express (TypeScript, run via tsx)
- **Shell Library:** Bash (POSIX-compatible where possible)
- **Notifications:** terminal-notifier (Homebrew)

## Key Files

| Path | Purpose |
|------|---------|
| `lib/report.sh` | Shell library — scripts source this to report runs |
| `lib/scripts.json` | Registry of known scripts (name, category, schedule) |
| `lib/config.example.sh` | Config template (copy to `~/.config/script-dashboard/config.sh`) |
| `server/index.ts` | Express API server |
| `src/App.tsx` | React dashboard entry point |
| `src/components/RunCard.tsx` | Expandable run card component |
| `src/components/RunList.tsx` | Grouped run list by category |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/runs` | List recent runs (no output field). Query: `?limit=N&category=X` |
| GET | `/api/runs/:id` | Single run with full output. For running runs, stitches in the live tail of the `.output` file. |
| GET | `/api/scripts` | Script registry |
| DELETE | `/api/runs/:id` | Delete a run record |
| POST | `/api/runs/cleanup` | Prune old runs. Body: `{ "completedDays": 7, "failedDays": 30 }` (defaults shown). `success` uses `completedDays`; `failed`/`killed` use `failedDays`; `running` is never touched. Legacy `{ "days": N }` applies to both. |
| POST | `/api/runs/sweep-stale` | Mark runs stuck in `running` past `STALE_RUN_THRESHOLD_MINUTES` (default 30) as `killed`. Runs automatically at startup and every 5 min; this endpoint forces an immediate sweep. |
| POST | `/api/runs/:id/reviewed` | Mark a run as reviewed (sets `reviewedAt`). Legacy bulk endpoint — the dashboard UI no longer calls it directly; the run-level `reviewedAt` is now derived automatically when all artifacts are marked reviewed. |
| DELETE | `/api/runs/:id/reviewed` | Un-mark a run as reviewed. Legacy companion to the POST above. |
| POST | `/api/runs/:id/artifacts/reviewed` | Body: `{ path }`. Mark a single artifact reviewed (sets `reviewedAt` on the artifact in the run record AND writes a `reviewed` entry to the suppression registry — see "Suppression registry" below). When ALL artifacts on the run have `reviewedAt`, the run's own `reviewedAt` is auto-set. |
| DELETE | `/api/runs/:id/artifacts/reviewed` | Body: `{ path }`. Un-mark a single artifact reviewed. Also removes the suppression registry entry IF its reason was `reviewed` (un-marking never undoes an `archived` suppression). |
| GET | `/api/artifacts?path=X` | Read a markdown artifact (frontmatter + body). Path must be inside a configured root. |
| PATCH | `/api/artifacts?path=X` | Update frontmatter (`status`, `priority`) and/or append to `## Notes`. |
| POST | `/api/artifacts/archive?path=X` | Move the artifact to its root's archive dir |
| POST | `/api/artifacts/pull-jira?path=X` | Body: `{ jiraKey, field }`. Fetches `field` from JIRA and writes it into the local Task Note. When `field === "status"` the server runs the JIRA value through `lib/jira-status-mapping.json` and writes BOTH `status` (mapped to local taxonomy) AND `jiraStatus` (raw JIRA snapshot) atomically. Unknown JIRA states write `jiraStatus` only and return a `warning` field — never clobber the local taxonomy. Other fields (`jiraStatus`, `sprint`, `jiraLabels`, `assignee`) write verbatim. 503 if no `jira` block in server config. |
| GET | `/api/jira/status-mapping` | Returns the canonical JIRA → local-status map as `{ mappings: { normalizedJiraKey: localStatus } }`. Used by the UI to preview the mapped value in the "JIRA wins" button label. |
| POST | `/api/artifacts/snooze?path=X` | Body: `{ untilDate: "YYYY-MM-DD" }`. Adds `sync-mute-until` frontmatter — todo-sync skips snoozed notes until the date. |
| GET | `/api/jira/:key/transitions` | List the workflow transitions currently valid for the JIRA issue. Returns `{ transitions: [{ id, name, toStatus }] }`. Used to build the "Push to JIRA" dropdown. |
| POST | `/api/jira/:key/transition` | Body: `{ transitionId }`. Applies a workflow transition. Returns the updated issue summary. |

## Integrating a Script

### Option 1: Source and call (most control)

```bash
source /path/to/script-dashboard/lib/report.sh
report_start "my-script" "scheduled"
# ... your logic ...
report_log "Key output line"
report_progress "Phase 2: started"   # heartbeat — updates dashboard "last activity"
report_end $?
```

**`report_log` vs `report_progress`:** Both append to the captured output. `report_progress` also rewrites the running JSON with a `lastProgressAt` timestamp, which the dashboard uses to distinguish "running and making progress" from "running but stalled." Use it sparingly — for phase transitions, pass-rate updates, errors — not firehose output.

### Option 2: Wrap a command (one-liner)

```bash
source /path/to/script-dashboard/lib/report.sh
report_exec "my-script" "scheduled" "Description here" -- your-command --with-args
```

### Option 3: Claude slash commands / agents (multi-step skills)

Slash commands and agents can't `source report.sh` because each Bash tool call runs in a fresh subshell — variables don't carry over. Use the split start/end pair:

**At the very start (before any real work):**

```bash
RUN_ID=$(bash ~/Repos/personal/script-dashboard/lib/report-skill-start.sh \
  "skill-name" "Short description")
echo "$RUN_ID"
```

The skill remembers `$RUN_ID` in conversational context across later Bash calls.

**At the end:**

```bash
bash ~/Repos/personal/script-dashboard/lib/report-skill-end.sh \
  "$RUN_ID" "Summary line" \
  --review \
  --artifact task-note "Short label" "/absolute/path/to/file.md"
```

`--review` and `--artifact` are optional — omit them when nothing new was created.

**Summary content convention:** pass the same wrap-up you presented to the user in chat — not a separate compressed one-liner. The dashboard card renders markdown, so bullets and bold work; the OS notification truncates at ~150 chars, so put the headline first. Mirroring keeps the dashboard, notification, and chat in sync — when a notification gets cut off, the dashboard card has the rest. Multi-line text: use `"$(cat <<'EOF' ... EOF)"` (quoted EOF) to preserve newlines and avoid accidental `$var` expansion in the body.

On abort or error, pass `--exit-code 1` so the record shows `failed` instead of `success`.

**One-shot alternative** (short-lived skills where mid-run visibility doesn't matter): `report-skill.sh` is still available. It calls both start and end back-to-back at the end of the work, which means `duration: 0` and no "running" card while the skill is working. Prefer the split pair for anything that takes more than a few seconds.

**Orphan protection:** a skill that calls `report-skill-start.sh` but never `report-skill-end.sh` leaves the record in `"running"` forever. The server sweeps runs with no progress older than `STALE_RUN_THRESHOLD_MINUTES` (default 30 min) and marks them `killed`, so orphans don't pile up. For skills that legitimately exceed 30 min, emit `report_progress` heartbeats to reset the idle clock — though since `report.sh` can't be sourced in a subagent Bash call, heartbeat-from-subagent isn't possible today, and you should keep sub-30-min runs or extend the threshold.

**Pair pattern (skill wraps agent):** when a slash-command skill invokes a subagent via the Agent tool, emit start/end from the **skill** only. The agent should NOT also call any `report-skill*` script — that would produce duplicate records with the same script name. Keep the agent silent to the dashboard; the skill owns the record.

### Categories

- `scheduled` — Launchd agents (timer-based)
- `meeting` — Recording/transcription pipeline
- `manual` — On-demand (CLI, Raycast, Claude skills)
- `skill` — Claude Code slash commands
- `eval` — Local eval runs (long-running; use `report_progress` to surface heartbeat)

## Configuration

Two separate config files:

**Shell config** — `~/.config/script-dashboard/config.sh` (sourced by `report.sh`):

```bash
SCRIPT_RUNS_DIR="$HOME/.script-runs/runs"    # Where run records live
SCRIPT_DASH_URL="http://localhost:7890"       # Dashboard URL for notifications
SCRIPT_DASH_BROWSER="Google Chrome for Testing"  # Browser for notification clicks
SCRIPT_DASH_NOTIFY="1"                        # Set to "0" to suppress notifications
```

**Server config** — `~/.config/script-dashboard/server-config.json` (read by the Express server at startup; controls which dirs the artifact-review endpoints can read/write):

```json
{
  "artifactRoots": [
    { "root": "/path/to/vault/Work Log/Tasks", "archive": "/path/to/vault/Work Log/Archive" },
    { "root": "/path/to/vault/Resources", "archive": "/path/to/vault/Resources-Archive" }
  ]
}
```

**Order matters**: roots are checked top-to-bottom and the first match wins. If a narrow root (e.g. `.../Work Log/Tasks`) is nested inside a broader one (e.g. `.../Resources` when Work Log lives inside Resources), list the narrow one **first** so its files archive to the right location.

If `artifactRoots` is empty or the file is missing, artifact endpoints return `503` and the dashboard falls back to showing plain output only. Server re-reads this file only at startup — restart the server after edits. See `lib/server-config.example.json`.

## Review workflow

Scripts that create files you want to review later can flag their run with `report_review_required` and emit artifact links with `report_artifact TYPE LABEL PATH` (or `--review` / `--artifact TYPE LABEL PATH` when using `report-skill.sh`). The dashboard surfaces those runs in a "Needs Review" badge and renders each artifact inline with editable status/priority, a notes-append field, and an archive button. All edits go straight to the file on disk — the vault stays the source of truth.

### Reconciliation decisions (todo-sync-style agents)

Agents that detect conflicts between local state and an external source (todo-sync between Task Notes and JIRA) can attach a `decision` block to each artifact. The dashboard reads it and renders kind-specific buttons.

**How to emit:** the agent writes a JSON file mapping artifact path → decision metadata, then passes it to `report-skill-end.sh --decisions-file PATH`.

```json
{
  "/abs/path/Tasks/SM-609.md": {
    "kind": "status-divergence",
    "jiraKey": "SM-609",
    "jiraStatus": "In Progress",
    "localStatus": "blocked",
    "note": "optional free text"
  }
}
```

**Kinds and what buttons they unlock:**

| `kind` | Buttons in the dashboard |
|---|---|
| `status-divergence` | JIRA wins (pull) • Push to JIRA (transition dropdown) |
| `local-ahead-of-jira` | Push to JIRA (transition dropdown) |
| `backlog-stale` | Snooze 30 days • Snooze 90 days |
| `local-done-jira-open` | Push to JIRA (transition dropdown, typically to Done) |
| `jira-now-done` | JIRA wins (pull) |

All kinds also retain the default Status/Priority/Notes/Archive controls.

Successful actions auto-archive the artifact card so the review queue clears one decision at a time. The Snooze actions write a `sync-mute-until: YYYY-MM-DD` frontmatter field that the agent should respect on subsequent runs.

## Suppression registry

Reviewed and archived artifacts are tracked in `~/.script-runs/.suppressed.json` so they don't reappear on every subsequent agent rerun.

**Schema** — single JSON object keyed by absolute artifact path:

```json
{
  "/abs/path/to/file.md": {
    "reason": "reviewed" | "archived",
    "suppressedAt": "ISO_TIMESTAMP",
    "viaScript": "todo-sync",
    "viaRunId": "todo-sync-2026-05-12T21-48-31Z-16303"
  }
}
```

(`viaScript` / `viaRunId` are omitted for archive entries, since the archive endpoint doesn't know which run/script the artifact came from.)

**Write path:**

- `POST /api/runs/:id/artifacts/reviewed` writes `reason: "reviewed"`.
- `POST /api/artifacts/archive` writes `reason: "archived"` for BOTH the original pre-move path AND the new `Archive/` path, because agents like todo-sync's Phase 1.5 scan the archive folder and would otherwise re-emit the moved file under its new path.
- `DELETE /api/runs/:id/artifacts/reviewed` removes the entry IFF its reason is `reviewed`. Un-marking reviewed must not undo an archive.

**Filter rule (server-side, applied in `GET /api/runs` and `GET /api/runs/:id`):**

```
drop artifact iff (path in registry) AND (artifact has no reviewedAt on this run record)
```

The asymmetry matters. The path appears in the registry only after the user marked it reviewed somewhere. That "somewhere" is a specific run record where the artifact's `reviewedAt` was also written. On that source run, the filter sees `reviewedAt` set and KEEPS the artifact visible — so the collapsed "Reviewed Xm ago" stub stays reachable and the user can undo. On any OTHER run record that emits the same path (a fresh agent run), the path-in-registry condition fires AND the artifact lacks `reviewedAt`, so it gets stripped from the response. Archived items always lack `reviewedAt` on every run, so they're filtered universally — that's intended (archive has no undo).

**Cross-script semantics:** The registry is keyed purely by path. If you reviewed an item via todo-sync, a different agent (slack-saved-sync, meeting-tasks-extractor) that later emits the same path will also have it filtered. This is intentional — same file → same suppression. If you find a case where you want one agent's surface to ignore another agent's suppression, revisit the schema (likely needs `(viaScript, path)` keying).

### Known trade-offs (revisit if any of these actually bite)

1. **No state-change re-surfacing.** A `status-divergence` reviewed today stays muted even if JIRA later moves to a new state. The follow-up path is a "state-snapshot" flavor: store the `(jiraStatus, localStatus)` tuple at review time and re-surface only when either value changes. About 3 hours of work, would replace the `SuppressionEntry` schema with a versioned form. Skipped because indefinite-mute solves the immediate pain.
2. **No inspection UI.** The registry is invisible by design — most of the time it should be. Inspect via `cat ~/.script-runs/.suppressed.json | jq` if needed. Build a panel if it becomes useful.
3. **Cross-script suppression is global.** Documented above. If this becomes wrong, switch to `(viaScript, path)` keying.
4. **No auto-expiry.** Entries live forever unless un-marked. A path that disappears from the filesystem (e.g., user manually deletes a Task Note) leaves a stale registry entry. Harmless — the entry just doesn't match anything. A periodic cleanup pass could drop entries whose path no longer exists; not built.

## Public Repo Notes

This repo is designed to be public. Personal configuration lives in:
- `~/.config/script-dashboard/config.sh` (gitignored, not in repo)
- `~/.script-runs/runs/` (runtime data, not in repo)

No hardcoded paths, credentials, or personal data in source files.
