# Script Dashboard

A local web dashboard for monitoring shell script and automation runs on macOS. Click a notification to see what just happened.

Built for tracking launchd agents, MeetingBar triggers, and on-demand CLI automations -- but works with any script you can add two lines to.

## How It Works

1. **Scripts report** -- Source `lib/report.sh` in your script to write a structured JSON run record
2. **API serves** -- Express reads the run records directory and serves them
3. **Dashboard shows** -- React frontend groups runs by category with expandable output
4. **Notification links** -- `terminal-notifier` sends a macOS notification on completion; click it to open the dashboard

## Quick Start

```bash
git clone https://github.com/yourname/script-dashboard.git
cd script-dashboard
npm install
npm run dev
```

Then integrate a script:

```bash
#!/bin/bash
source /path/to/script-dashboard/lib/report.sh

report_start "my-backup" "scheduled"

# your script logic here
rsync -a ~/Documents /Volumes/Backup/

report_end $?
```

Or wrap an existing command:

```bash
source /path/to/script-dashboard/lib/report.sh
report_exec "my-backup" "scheduled" "Nightly backup" -- rsync -a ~/Documents /Volumes/Backup/
```

## Configuration

Copy `lib/config.example.sh` to `~/.config/script-dashboard/config.sh`:

```bash
# Where run records are stored
SCRIPT_RUNS_DIR="$HOME/.script-runs/runs"

# Dashboard URL for notification click-through
SCRIPT_DASH_URL="http://localhost:7890"

# Browser to open (leave empty for system default)
SCRIPT_DASH_BROWSER="Google Chrome"

# Set to "0" to disable notifications
SCRIPT_DASH_NOTIFY="1"
```

## Requirements

- Node.js 18+
- macOS (for `terminal-notifier` notifications; the dashboard itself works anywhere)
- `brew install terminal-notifier` (optional, falls back to `osascript`)

## Stack

React, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Express

## License

MIT
