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
| GET | `/api/runs/:id` | Single run with full output |
| GET | `/api/scripts` | Script registry |
| DELETE | `/api/runs/:id` | Delete a run record |
| POST | `/api/runs/cleanup` | Delete runs older than N days. Body: `{ "days": 7 }` |

## Integrating a Script

### Option 1: Source and call (most control)

```bash
source /path/to/script-dashboard/lib/report.sh
report_start "my-script" "scheduled"
# ... your logic ...
report_log "Key output line"
report_end $?
```

### Option 2: Wrap a command (one-liner)

```bash
source /path/to/script-dashboard/lib/report.sh
report_exec "my-script" "scheduled" "Description here" -- your-command --with-args
```

### Categories

- `scheduled` — Launchd agents (timer-based)
- `meeting` — Recording/transcription pipeline
- `manual` — On-demand (CLI, Raycast, Claude skills)

## Configuration

Copy `lib/config.example.sh` to `~/.config/script-dashboard/config.sh` and customize:

```bash
SCRIPT_RUNS_DIR="$HOME/.script-runs/runs"    # Where run records live
SCRIPT_DASH_URL="http://localhost:7890"       # Dashboard URL for notifications
SCRIPT_DASH_BROWSER="Google Chrome for Testing"  # Browser for notification clicks
SCRIPT_DASH_NOTIFY="1"                        # Set to "0" to suppress notifications
```

## Public Repo Notes

This repo is designed to be public. Personal configuration lives in:
- `~/.config/script-dashboard/config.sh` (gitignored, not in repo)
- `~/.script-runs/runs/` (runtime data, not in repo)

No hardcoded paths, credentials, or personal data in source files.
