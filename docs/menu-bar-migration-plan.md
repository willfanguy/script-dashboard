# Menu Bar App Migration Plan

**Status:** Drafted 2026-05-08. Not active. Pull this out if the PWA installation proves insufficient — typical triggers would be: notification-click handoff to the wrong window, the launchd-managed Express server going down without recovery, the dock icon getting closed accidentally, or wanting offline-style "always there" affordance that a browser tab can't provide.

**Recommendation:** Convert to a **Tauri 2.x menu bar app**. Reuse the React frontend wholesale (~95%), rewrite the Express server as Rust Tauri commands, replace the SSE channel with Tauri events, replace the directory watcher with `notify-debouncer-full`. Estimated effort: **5–7 focused days**. Swift+WKWebView is viable (Will already has shipped a menu bar app in `cmux-color-tabs/`) but doesn't save meaningful time and gives up the cleaner React→Tauri command/event boundary.

---

## 1. Why this would replace the PWA

The PWA fix (added 2026-05-08 in commits to `index.html`, `public/manifest.webmanifest`, `public/sw.js`, `src/main.tsx`) addresses the **window/affordance** problem: dock icon, standalone window, no tab strip. It does **not** address two deeper sources of brittleness:

1. **Server is a separate process under launchd.** If `npm start` dies in a way `KeepAlive` can't recover from cleanly (port stuck, `tsx` crash, npm hang), the app window shows `ERR_CONNECTION_REFUSED` and there's no in-app recourse. The PWA is just a viewing surface for a server that lives elsewhere.
2. **HTTP indirection for what is really a file-watch problem.** Every request fans through Express, which reads the same JSON files on disk. A native app collapses that into one process: file events → in-memory state → UI update.

If either becomes a daily annoyance, this plan exists.

## 2. Target architecture

```
┌─────────────────────┐
│  Scripts (launchd,  │
│  meeting recorder,  │
│  skills, agents)    │
└──────────┬──────────┘
           │ source lib/report.sh, write JSON
           ▼
┌─────────────────────┐
│  ~/.script-runs/    │   (data is still on disk; same schema)
│  runs/*.json        │
└──────────┬──────────┘
           │ FSEvents via notify-debouncer-full
           ▼
┌──────────────────────────────────────────┐
│  Tauri 2.x app (one .app bundle)          │
│  ┌─────────────────┐  ┌────────────────┐  │
│  │ Rust core       │  │ Webview        │  │
│  │  - FS watcher   │◀▶│  React UI      │  │
│  │  - Tauri cmds   │  │  (existing)    │  │
│  │  - Stale sweep  │  │                │  │
│  │  - YAML edits   │  │                │  │
│  └─────────────────┘  └────────────────┘  │
│  NSStatusItem (menu bar) + popover/window  │
└──────────────────────────────────────────┘
           │
           │ tauri-plugin-deep-link: scriptdash://run/{id}
           ▼
┌─────────────────────┐
│  macOS Notification │   (still triggered from report.sh)
└─────────────────────┘
```

Key inversions vs. today:

- **No HTTP server.** Express is gone. The cleanup launchd job stops calling `POST /api/runs/cleanup` and either calls a CLI face on the Tauri binary or runs the same logic as a standalone shell script.
- **No polling, no SSE.** Frontend listens for Tauri events (`runs-changed`, `run-output-appended`) emitted by the Rust core when the FS watcher fires.
- **The app IS the data layer.** `~/.script-runs/runs/` remains the source of truth for runs; the vault remains the source of truth for artifacts. The Tauri app reads/writes both directly.

## 3. Phased migration plan

### Phase 0 — Spike (half a day)

Goal: validate the menu-bar UX feels right before committing.

- Clone [`ahkohd/tauri-macos-menubar-app-example`](https://github.com/ahkohd/tauri-macos-menubar-app-example).
- Verify: tray icon clicks open a webview window anchored where you want it, dismisses cleanly, the `Accessory` activation policy hides the dock icon. Confirm cmd-Q quitting feels right (vs. only quit-from-status-menu).
- **Decision gate:** if the popover-anchored-to-tray UX feels worse than just an `NSPanel`-style detached window, decide which model to use before continuing.

### Phase 1 — Scaffold parallel project (1 day)

- New folder: `script-dashboard-tauri/` next to current `script-dashboard/`. Same git repo or sibling — easier to compare side by side during migration.
- `cargo create-tauri-app` with React+TypeScript+Vite preset.
- Copy `src/` from current dashboard wholesale into the Tauri project's frontend dir.
- Strip `vite.config.ts`'s `proxy` block (no longer hitting Express).
- Wire `tauri.conf.json`:
  - `productName: "Script Dashboard"`, `identifier: "com.user.script-dashboard"`.
  - `bundle.macOS.minimumSystemVersion: "13.0"` (matches `MenuBarExtra` and modern Tauri requirements).
  - `app.macOSPrivateApi: true` if you need transparent windows.
  - Activation policy: `Accessory` (the v2 replacement for `LSUIElement`).
  - URL schemes: register `scriptdash` for deep links.

### Phase 2 — Port the API surface (2–3 days)

The current Express server has 12 endpoints (see `server/index.ts`). Each becomes a Tauri command. Map:

| Express endpoint | Tauri command | Notes |
|---|---|---|
| `GET /api/runs?limit&category` | `list_runs(limit, category) -> Vec<RunSummary>` | No `output` field; sort by `startEpoch` desc |
| `GET /api/runs/:id` | `get_run(id) -> RunDetail` | If running, include live tail of `.output` file (last 100 KB) |
| `GET /api/scripts` | `get_registry() -> ScriptRegistry` | Reads `lib/scripts.json` from app bundle resources |
| `DELETE /api/runs/:id` | `delete_run(id)` | Removes `{id}.json` and `{id}.output` |
| `POST /api/runs/cleanup` | `cleanup_runs(completedDays, failedDays)` | Same age-bucket logic; can also be invoked via CLI flag for the launchd job |
| `POST /api/runs/sweep-stale` | `sweep_stale_running()` | Plus an internal timer running this every 5 min on a tokio task |
| `POST /api/runs/:id/reviewed` | `mark_reviewed(id)` | Atomic write |
| `DELETE /api/runs/:id/reviewed` | `unmark_reviewed(id)` | Atomic write |
| `GET /api/artifacts?path` | `read_artifact(path) -> Artifact` | Validate path against `artifactRoots` |
| `PATCH /api/artifacts?path` | `patch_artifact(path, patch)` | `gray_matter` Rust crate; preserve YAML date strings (`yaml::JSON_SCHEMA` equivalent) |
| `POST /api/artifacts/archive?path` | `archive_artifact(path) -> ArchivedPath` | Disambiguate with timestamp on collision |
| `GET /api/events` (SSE) | Tauri event channel | Emit `runs-changed`, `run-output-appended` from the Rust watcher; frontend uses `listen()` instead of `EventSource` |

Frontend changes:

- `src/hooks/use-runs.ts`: replace `fetch('/api/runs')` with `invoke<RunSummary[]>('list_runs', { ... })`. Replace `EventSource('/api/events')` with `await listen('runs-changed', () => refetch())`.
- `src/lib/artifacts-api.ts`: same pattern — every `fetch` becomes `invoke`.
- `src/components/RunCard.tsx`: the 3-second polling for live output while expanded becomes a `listen('run-output-appended', ...)` filtered by run id. (Or keep polling — the polling is cheap and avoids per-run subscriptions.)

Rust dependencies:
- `tauri = "2"`, `tauri-plugin-deep-link = "2"`, `tauri-plugin-notification = "2"`, `tauri-plugin-updater = "2"`.
- `notify = "6"`, `notify-debouncer-full = "0.3"`.
- `gray_matter = "0.3"` with `yaml-rust2` engine (date strings stay as strings, matching the current JS engine pinned to `JSON_SCHEMA`).
- `serde`, `serde_json`, `tokio` (for the periodic sweep task).

### Phase 3 — Notification handoff (1 day)

This is the thorny bit because notification-click → bring-window-forward isn't a built-in Tauri callback.

**Approach:**

1. Register `scriptdash://` as a URL scheme in `tauri.conf.json` and via `tauri-plugin-deep-link`.
2. In `lib/report.sh` `_sd_notify()`, change the URL passed to `terminal-notifier`:
   - Current: `http://localhost:7890?run=${_SD_RUN_ID}`
   - New: `scriptdash://run/${_SD_RUN_ID}`
3. macOS dispatches the URL → Tauri's `RunEvent::Opened` handler → `window.show()` + `set_focus()` + emit a frontend event to scroll/expand the matching run card.
4. Drop `SCRIPT_DASH_BROWSER` from `~/.config/script-dashboard/config.sh`. The Puppeteer Chrome detour is no longer needed.

Failure modes to watch for: scheme not registered until first launch (the bundle has to be opened once before LaunchServices indexes its `CFBundleURLSchemes`); deep link handler firing before the webview is ready (use Tauri's `app.once("tauri://ready", ...)` or buffer the deep link payload).

### Phase 4 — File watcher + stale sweep (half a day)

- Spawn a thread on `setup()` running `notify-debouncer-full` against `RUNS_DIR`.
- On batch event: `app.emit("runs-changed", payload)`. Debounce 300 ms (matches current behavior).
- For running runs that are expanded in the UI, also emit `run-output-appended` with the new tail bytes when the corresponding `.output` file changes. Optimization: only watch `.output` files for runs the frontend has subscribed to, to avoid noisy events.
- Stale sweep: a tokio interval task every 5 minutes calls the same `sweep_stale_running()` function the command exposes. Mirrors current server behavior.
- Sleep/wake: register for `NSWorkspace.didWakeNotification` via Tauri's macOS API and force a re-scan + watcher restart on wake. (FSEvents *usually* survives sleep; the explicit re-scan is belt-and-suspenders.)

### Phase 5 — Update the launchd / shell layer (half a day)

External integration points (from the integration audit):

- **`lib/report.sh` line 305:** Change notification URL to `scriptdash://run/${_SD_RUN_ID}`. Drop `SCRIPT_DASH_BROWSER` branch in `_sd_notify()`.
- **`scripts/cleanup-runs.sh`:** Replace `curl POST /api/runs/cleanup` with one of:
  - (a) Direct CLI invocation of the Tauri bundle: `/Applications/Script\ Dashboard.app/Contents/MacOS/script-dashboard --cleanup --completed-days 7 --failed-days 30`. Requires a small `clap`-based CLI mode in the Rust entry point that runs the cleanup logic and exits without launching the UI.
  - (b) Move the cleanup logic into a small standalone shell/Python script that walks `~/.script-runs/runs/` directly. Simplest, no IPC. Recommended.
- **`~/Library/LaunchAgents/com.user.script-dashboard.plist`:** Replace the `npm start` ProgramArguments with `["/usr/bin/open", "-a", "/Applications/Script Dashboard.app"]` and remove `KeepAlive` (the app is a foreground app the user opens, not a daemon). Or move app-launch to a Login Item via the macOS UI and delete the plist entirely.
- **`~/Library/LaunchAgents/com.user.script-dashboard.cleanup.plist`:** Update `ProgramArguments` to point at the new cleanup mechanism from the previous bullet.
- **`vite.config.ts`:** Drop the `proxy` block. Tauri intercepts `invoke` calls; there's no localhost server in dev anymore. Use `npm run tauri dev` instead of `npm run dev`.
- **`SCRIPT_DASH_URL` in `~/.config/script-dashboard/config.sh`:** Either drop entirely or repurpose to the scheme URL prefix.

**Things that DO NOT need to change:**

- All 7 launchd jobs that `source lib/report.sh` (`com.user.morning-plan`, `daily-summary`, `daily-context-updater`, `midday-refresh`, `weekly-standup`, `weekly-summary`, `weekly-reflection`).
- All 10 skills/agents using the `report-skill-*` helpers.
- `meeting-recorder/scripts/transcribe-and-process.sh`'s use of `report.sh`.
- The on-disk JSON schema (`server/index.ts:60-80`).
- The `lib/scripts.json` registry shape.
- The artifact roots config (`~/.config/script-dashboard/server-config.json`).

### Phase 6 — Distribution + auto-update (1 day, can defer)

- Ad-hoc sign for solo install on Will's two machines: `codesign --force --deep --sign - "Script Dashboard.app"`. macOS Sequoia closed the Finder right-click "Open Anyway" path for unnotarized apps, but ad-hoc-signed apps that aren't quarantined (i.e., copied via Finder/`scp`/Homebrew tap, not downloaded via browser) still launch. For solo install this is sufficient.
- Optional later: notarize via `notarytool` (~$99/yr Apple Developer ID required) only if you ever want to share the `.dmg`.
- Auto-update via `tauri-plugin-updater`: host a `latest.json` on a static host (Cloudflare Pages, GitHub Pages, even a local file) with the version and signature. The plugin handles download/verify/swap-and-relaunch.

### Phase 7 — Cutover (half a day)

- Run both old and new dashboards in parallel for a few days. Both read from `~/.script-runs/runs/` so there's no state to migrate. Express server can stay running; the new app just doesn't talk to it.
- After confidence: archive the Express server (`mv server server-archive` and update CLAUDE.md), unload the launchd plist, optionally switch the notification scheme to `scriptdash://`.
- If issues surface, reverting is reverting `lib/report.sh`'s notification URL back to `http://localhost:7890` and re-loading the launchd job. The PWA install on the old web app is still installable, so the rollback surface is intact.

## 4. Risks and gotchas

- **`gray_matter` Rust crate vs. JS gray-matter parity.** The current code pins js-yaml to `JSON_SCHEMA` to keep date strings as strings (see `obsidian-bulk-vault-modifications` skill for context). Verify the Rust crate's YAML output preserves bare `dateCreated: 2026-04-21` as-is and doesn't auto-emit ISO timestamps. Round-trip a real task note through `read_artifact` → `patch_artifact` → file diff before trusting it on Will's vault.
- **WKWebView vs. Chromium DevTools differences.** Will's React app might lean on Chromium-only quirks (CSS `:has()` is fine on macOS 13+ WebKit, scroll-snap behaves slightly differently). Validate visually during Phase 1.
- **Tauri command argument naming.** Tauri 2 expects camelCase on the JS side and snake_case on the Rust side; `invoke('list_runs', { limit: 100 })` is fine but document the convention to avoid losing an afternoon to "command not found."
- **Filesystem watcher on the vault path.** `read_artifact` and `patch_artifact` touch paths inside `~/Vaults/HigherJump/`. Tauri's permission scopes (`fs:allow-read-file`, `fs:allow-write-file`) need explicit allowlists for those roots, or you get silent denials. Mirror the `artifactRoots` config into the Tauri allowlist.
- **Live output streaming.** The current SSE-driven update stream, plus the 3-second poll-while-expanded for live tail, are two separate channels. Decide early whether to keep both or unify into a single Tauri event stream that includes tail deltas. Unifying is cleaner but means more frontend rework.
- **`MenuBarExtra` vs. tray-anchored popover.** Decide in Phase 0. If Will wants the dashboard window to stay open while he's working in another app (rather than dismissing on click-outside), use a detached `tauri::Window` with `alwaysOnTop` rather than the default popover.
- **Notification arrival before app is awake.** If a notification fires for a script that completed while the app wasn't running, the deep-link payload arrives at launch. Tauri 2's `RunEvent::Opened` handler should fire after the webview is ready, but verify.
- **Eval results paths.** The third `artifactRoot` (`/Users/will/Repos/work/chat-context-service/lib/eval/build/eval-results`) crosses into work-repo territory. Confirm Tauri's FS scope handles paths outside `$HOME` cleanly.

## 5. Testing strategy

- **Frontend tests survive verbatim.** `src/__tests__/formatting.test.ts`, `groupByCategory.test.ts`, `ArtifactReview.test.tsx` use Vitest + Testing Library — no Tauri runtime dependency. Mock `invoke` with `@tauri-apps/api/mocks` for component tests that need it.
- **Rust unit tests.** Each command gets a unit test that exercises the file I/O against a `tempdir`. Path-traversal protection (`resolveSafePath` equivalent) gets specific hostile-input tests: `..`, symlinks, partial-prefix attacks against `artifactRoots`. Per `CLAUDE.md`'s testing standards, attack the inputs.
- **Integration smoke test.** A shell script that: starts the Tauri binary in a test mode, writes 3 fake run JSONs to a temp `RUNS_DIR`, queries via the CLI mode, and asserts the right shape comes back. Catches "did the Rust port preserve the JSON schema."
- **Regression test for the YAML date-string round-trip.** Concrete example: load `Daily Plan - May 8.md`, PATCH the status to `done`, write back, diff against the original. The dates should still be bare strings, not ISO timestamps. This is the one bug most likely to silently corrupt the vault — write the test before you trust the migration.

## 6. Coexistence and rollback

- The on-disk format (`~/.script-runs/runs/*.json`) doesn't change. Both the old Express server and the new Tauri app can read it simultaneously. Run them side by side as long as you want.
- Notification URLs are the only one-way bridge: once `lib/report.sh` is changed to emit `scriptdash://`, clicks won't open the old Express dashboard. Keep that change as the LAST step in cutover.
- Rollback path: revert the `lib/report.sh` URL change, reload the Express launchd job, ignore the new app.

## 7. Source references

- Current internals (Phase 2 mapping comes from): `server/index.ts`, `server/stale-runs.ts`, `server/artifacts.ts`, `src/hooks/use-runs.ts`, `src/components/RunCard.tsx`, `src/components/ArtifactReview.tsx`, `lib/report.sh`.
- Tauri 2.x menu bar example: https://github.com/ahkohd/tauri-macos-menubar-app-example
- Tauri v2 system tray docs: https://v2.tauri.app/learn/system-tray/
- Tauri v2 deep-link plugin: https://v2.tauri.app/plugin/deep-linking/
- Tauri v2 updater: https://v2.tauri.app/plugin/updater/
- `notify-debouncer-full`: https://docs.rs/notify-debouncer-full/latest/notify_debouncer_full/
- macOS code signing guide for Tauri: https://v2.tauri.app/distribute/sign/macos/
- Reference Swift menu bar app already in this workspace: `cmux-color-tabs/Sources/AppDelegate.swift` (NSStatusItem) and `Sources/CmuxConfig.swift` (`DispatchSource.makeFileSystemObjectSource` watcher). Use as a fallback if Tauri turns out to be the wrong call.
