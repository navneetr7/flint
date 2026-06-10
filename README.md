# Flint

Flint is a local-first macOS app that tracks which applications you use and turns that data into a clear picture of your focus, distraction patterns, and recovery. No screenshots, no keylogging, no cloud — all data stays on your device.

## What it does

Flint runs in the background and samples your active application every 5 seconds. It categorises each app (development, learning, productivity, entertainment, social, communication) and uses that stream of events to compute:

- **Focus score** — a 0–100 rating of how well attention held throughout the day
- **Deep work sessions** — contiguous blocks of 15+ minutes of focused activity, including research time
- **Drift episodes** — each time attention left a focus category, how long it stayed away, and how quickly it recovered
- **Fragmentation** — how often context-switching broke flow (low / medium / high)
- **Strongest focus hour** — the 60-minute window where concentration was highest

## Views

| View | What it shows |
|---|---|
| **Home** | Yesterday's narrative: time wasters, main distractions, what was off, and one tip for today |
| **Drift Map** | Real-time attention trail with a replay scrubber to rewind and replay the full day |
| **Reports** | Focus / drift / idle charts across daily, weekly, and monthly ranges with trend indicators |
| **Timeline** | Chronological app activity indexed by time |
| **Focus Pulse** | Live focus state at a glance |
| **Insights** | AI-generated observations about attention patterns |
| **Settings** | Privacy controls, tracking configuration, and Insight Engine setup |

## Tray pill

A dynamic pill icon lives in the macOS menu bar and updates at 30 fps. It shows the current app category and a live focus timer. At each 15-minute focus milestone it fires a brief achievement overlay (Locked In → Deep Work → Peak Focus). After 2 minutes of distraction it shows a "Refocus?" nudge; after 10 minutes it surfaces an in-pill drift notice. The pill animates width changes with exponential easing.

## Privacy controls

- **Context Awareness** — window title collection is off by default; toggling it on lets Flint distinguish tabs and documents within the same app
- **Excluded apps** — any app can be excluded from tracking entirely
- **Idle threshold** — configurable inactivity window before an event is marked idle
- **Private mode** — suspends all tracking with one click from the tray menu
- **Dynamic Notifications** — hide the tray pill entirely if you prefer a clean menu bar

## Insight Engine (optional)

Flint can use any OpenAI-compatible API to classify ambiguous apps and generate the home narrative. Bring your own key and endpoint — DeepSeek, OpenAI, Anthropic, and local models via Ollama all work. Classification results are cached locally so the same app is only sent to the API once.

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, TypeScript, Vite, Framer Motion, D3, Zustand |
| Desktop shell | Tauri 2, Rust 2021 |
| Storage | SQLite (bundled rusqlite), AES-GCM encryption for window titles |
| macOS integration | objc2-app-kit, objc2-core-graphics (active app + idle detection) |
| HTTP | reqwest + rustls-tls (AI classification calls) |

## Requirements

- macOS 12.0 or later
- Accessibility permission (for active app detection)
- Automation permission (optional, for browser tab titles)

## Development

```bash
# Install dependencies (run from repo root)
npm install

# Start Tauri dev build with hot-reload
npm run tauri:dev

# Type-check
npm run typecheck

# Build for your current machine's architecture
npm run tauri:build

# Build universal binary (runs natively on Apple Silicon + Intel)
npm run tauri:build -- --target universal-apple-darwin
```

## Release

Push a version tag and the CI pipeline builds a signed universal DMG automatically:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The GitHub Actions workflow (`.github/workflows/release.yml`) builds a universal binary, attaches the DMG to the release, and marks pre-release for any tag containing a hyphen (e.g. `v1.0.0-beta.1`).
