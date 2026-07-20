# GDDXX-Jarvis

Every man's Jarvis: an open-source Windows desktop Agent that can listen, converse, read the latest AI news, and help you get real work done. GDDXX-Jarvis combines a sci-fi control room, DeepSeek conversation, wake-word voice interaction, local Jarvis TTS, AI HOT news, and an optional Grok Build engineering workspace.

## Download

| System | Download | Status |
|---|---|---|
| Windows 64-bit | `GDDXX-Jarvis-Windows-x64-Setup-*.exe` | Supported |
| Windows 32-bit | Not available | Not supported yet |
| macOS Apple Silicon / Intel | Not available | Not supported yet |
| Linux x64 | Not available | Not supported yet |

Current public release target: Windows 10/11 64-bit.

## Quick Start

### For normal users: install the app

1. Open this repository's GitHub Releases page.
2. Download the latest `GDDXX-Jarvis-Windows-x64-Setup-*.exe`.
3. Run the installer.
4. Launch `GDDXX-Jarvis` from the desktop or Start menu.
5. On first launch, use the arrow on the standby screen, then complete the required API, model, and voice setup before entering the workbench.

That is the intended install path. No Node.js, npm, Python, Visual Studio Build Tools, Git, or source compilation is required for normal use.

### Clean Windows installation

Supported target: a clean Windows 10 or Windows 11 64-bit installation.

1. Download the single `GDDXX-Jarvis-Windows-x64-Setup-*.exe` file from Releases.
2. Run it, choose an install directory, and finish installation.
3. Start `GDDXX-Jarvis`; no restart is required.

The installer contains the desktop runtime, local application core, local Whisper speech recognition, and local Jarvis voice. A microphone is optional: the standby arrow always opens the setup or text workbench. Conversation requires the user's own supported model-provider credential because public builds never contain private API keys. Cloud speech recognition is optional. Windows SmartScreen may warn about unsigned community builds; verify that the installer came from this repository's Releases page before continuing.

For wake voice, say `嗨，贾维斯`, `你好，贾维斯`, or `Hello Jarvis` after the microphone status shows ready.

### For developers: run from source

Requirements: Windows 10/11, Node.js 20 or 22 LTS, Git, and a working microphone. Node.js 24 may require a local native build toolchain for `better-sqlite3`.

```powershell
git clone https://github.com/shitoudaidi/GDDXX-Jarvis.git
cd GDDXX-Jarvis
Copy-Item config.example.json config.json
notepad config.json
npm.cmd install
npm.cmd run doctor:install
npm.cmd run start:desktop
```

Never commit `config.json`. It is intentionally ignored by Git.

If Electron is blocked by your machine, security software, or a remote sandbox, use web mode instead. It runs the same Jarvis core and UI in your browser without launching `electron.exe`:

```powershell
npm.cmd run rebuild:web
npm.cmd run doctor:web
npm.cmd run start:web
```

To create a desktop shortcut for this fallback:

```powershell
npm.cmd run shortcut:web
```

If source installation fails on Windows, run:

```powershell
npm.cmd run doctor:install
npm.cmd run repair:electron
npm.cmd run rebuild:native
```

For web mode, use the Node.js version that installed the dependencies. If `doctor:web` reports a `NODE_MODULE_VERSION` mismatch, run `npm.cmd install` after switching to Node.js 20/22 LTS, then run `npm.cmd run rebuild:web`. On Node.js 24, a source rebuild also requires Visual Studio Build Tools 2022 with the **Desktop development with C++** workload.

`doctor:install` checks the real Electron binary version and verifies `better-sqlite3` inside Electron's own runtime. `repair:electron` re-downloads Electron and refuses binaries that fail validation. If `better-sqlite3` still fails to build, install Visual Studio Build Tools 2022 with the C++ desktop workload, then run `npm.cmd run rebuild:native` again.

## Configuration

`config.json` is local-only. At minimum configure:

- `provider`: `deepseek`
- `apiKey`: your DeepSeek API key
- `model`: the model enabled for your account
- `voice.voiceProvider`: `aliyun` for cloud ASR, or `local` for bundled Whisper
- `voice.aliyunApiKey`: DashScope key when using Aliyun ASR
- `tts.ttsProvider`: `jarvis` for the bundled Jarvis voice

### AI HOT news

The default AI HOT endpoint is the official public feed:

```text
https://aihot.virxact.com/api/public/items
```

It does not require an API key. The endpoint and an optional key can be changed in Jarvis Settings under **AI HOT News**. Only users who switch to a compatible authenticated endpoint need to obtain and enter that service's API key. News shown in the workbench is loaded from the configured endpoint and retains the original article URL.

The Jarvis Piper voice model is not committed because it is large. Install it once with:

```powershell
npm.cmd run voice:install:jarvis
npm.cmd run probe:jarvis-tts
```

The model is stored locally under `models/jarvis` and is excluded from Git.

Grok Build engineering mode is optional. Source users can install its CLI locally with:

```powershell
npm.cmd run grok:install
```

The downloaded package is stored under the ignored `tools/grok-cli` directory and is not committed.

## Build and Release

```powershell
npm.cmd run check       # UI build plus safety and integration probes
npm.cmd run pack        # unpacked Windows app for local testing
npm.cmd run dist        # installer under dist/
```

Source runs keep runtime data under the current project directory. Installed releases use `%LOCALAPPDATA%\JarvisLocalAgent`. Set `JARVIS_HOME` or `JARVIS_USER_DIR` to choose a different location explicitly.

## Project Layout

```text
electron/       Electron main process and preload bridge
src/core/        Local Agent runtime, API, memory, voice, tools
src/ui/          React/Vite Jarvis workbench source and built UI
scripts/         Build, install, probe, and release helpers
skills/          Project-local skills
vendor/          Vendored Grok Build integration sources/licenses
build/           Windows icon and build resources
```

## Verification

Run `npm.cmd run check` before opening a pull request. For desktop wiring use `npm.cmd run probe:desktop`; for voice use `npm.cmd run probe:wake-sequence` and `npm.cmd run probe:asr-real-audio`.

## Privacy and Secrets

Jarvis sends requests only to providers configured by the user. API keys remain in the ignored local `config.json`. Do not paste keys into issues, pull requests, screenshots, logs, or source files. Remove any personal runtime data before publishing a release archive.

Jarvis is now a local desktop Agent with its own copied-and-modified core runtime.

The working direction is:

```text
Jarvis sci-fi desktop shell + local Jarvis core
```

The core was migrated from a Jarvis-style architecture, but runtime code now lives inside this repository under `src/core`. The desktop app must not import or proxy an external Jarvis backend.

## Frontend

The Jarvis desktop shell is a React/Vite interface built under `src/ui/jarvis-react` and compiled into `src/ui/jarvis` for Electron. It uses copied-and-modified React Bits components for the animated background and decrypted text effects, with local license notes in `src/ui/jarvis-react/src/react-bits/NOTICE.md`. The app does not load React Bits or Jarvis code from a remote runtime.

The center Jarvis core now uses local generated state video loops from `src/ui/jarvis-react/public/visuals` (`idle`, `listening`, `thinking`, `speaking`, `alert`) with cross-fade transitions, while keeping the canvas hologram as a live overlay/fallback. These videos are bundled into `src/ui/jarvis/visuals` by `npm run build:ui`.

Voice output defaults to the local Jarvis Piper model (`jarvis-high`) through `/tts/stream`, then applies the Jarvis metallic FFmpeg treatment. It does not silently fall back to the browser or Windows system voice; if the Jarvis model is missing, the UI reports the problem. ASR uses the local `/voice/cloud` WebSocket. If a cloud ASR provider is configured it is used; otherwise the same endpoint routes to the bundled local Whisper runtime instead of blocking on a missing cloud key.

Web search prefers configured providers (`Serper`, `Brave`, `Tavily`, `SearXNG`, or `Jina`) and falls back to no-key engines (`Bing`, `Jina`, `DuckDuckGo`) through the same `web_search` tool. The fallback can be verified with `npm run probe:web-search`.

## Desktop Dev Start

```powershell
npm.cmd install
npm.cmd run doctor:install
npm.cmd run start:desktop
```

This launches the local Electron binary from this project and starts the local Jarvis core on `127.0.0.1:3721` by default.

## Web Mode Fallback

Use this when Electron cannot run in the target environment:

```powershell
npm.cmd install
npm.cmd run start:web
```

Web mode automatically creates local runtime directories under `.jarvis-data`, starts Jarvis on `http://127.0.0.1:3721/`, and opens the browser. It also clears `ELECTRON_RUN_AS_NODE`, so it is safe in shells that were previously used for Electron probes.

Source desktop mode rebuilds `better-sqlite3` for Electron. Pure web mode uses normal Node.js instead. If you switch from desktop source mode to web source mode, run `npm.cmd run rebuild:web`; if you switch back to desktop source mode, run `npm.cmd run rebuild:native`.

## Current Capabilities

- DeepSeek activation and model switching
- Single-turn voice panel with automatic wake listening through `/voice/cloud`
- Text fallback through `/message`
- SSE event stream through `/events`
- TTS playback through `/tts/stream`
- Memory, status, trace, settings, and local reference endpoints
- Jarvis React control-room source in `src/ui/jarvis-react`, built into `src/ui/jarvis`
- One Jarvis workbench served by both Electron and the local HTTP root; legacy UI URLs redirect to it
- Safe data-only live results for weather and system checks through `/acui`

## Live Results

The current workbench exposes four structured result components: `WeatherCard`, `SelfCheckCard`, `SelfCheckStepCard`, and `AwakeningCard`. The model can show, update, patch, or hide these cards. Model-provided HTML, JavaScript, dynamic components, and retired panel tools are not exposed or executed.

## Verification Probes

```powershell
npm.cmd run probe:core       # starts the real core under Electron ABI and checks API/SSE/message endpoints
npm.cmd run probe:desktop    # starts the real Electron desktop shell and checks UI -> preload -> core wiring
npm.cmd run probe:wake-sequence # verifies wake-to-speech latency and post-narration auto-listening
npm.cmd run probe:api-hardening # checks local API origins, limits, headers, and WebSocket guards
npm.cmd run probe:layout     # checks minimum and standard desktop geometry and saves screenshots
npm.cmd run probe:acui       # sends real live-result WebSocket commands and checks rendering/safety
npm.cmd run probe:tool-surface # verifies retired panel tools cannot reach the model catalog
npm.cmd run probe:turn-lifecycle # checks streaming isolation, single completion, error release, and voice resume
npm.cmd run probe:desktop-close # verifies closing the main window exits the process
npm.cmd run probe:desktop-shortcut # launches and verifies the current packaged desktop shortcut
npm.cmd run probe:asr-real-audio # sends real synthesized PCM through the configured ASR route
npm.cmd run probe:readiness  # reports configured capabilities without printing plaintext keys
npm.cmd run probe:asr-route  # verifies /voice/cloud falls back to local Whisper when cloud ASR is not configured
npm.cmd run probe:web-search # verifies web_search returns results through no-key fallback engines
npm.cmd run probe:tts-repeat # guards against TTS self-repeat loops
```

`probe:readiness` reports `coreOk` and `fullReady` separately. `coreOk=true` means the local runtime, memory DB, API, and event stream work. `fullReady=true` additionally requires the user-facing Agent stack to be configured enough for real conversation, especially DeepSeek. ASR is considered ready when cloud ASR is configured or the local Whisper route is available; missing paid-provider keys are reported as blockers instead of being guessed or mocked.

## Build An Installable App

```powershell
npm.cmd run pack
npm.cmd run dist
```

Source runs use `<project>\runtime\jarvis`; installed releases use `%LOCALAPPDATA%\JarvisLocalAgent\runtime\jarvis`. Environment variables `JARVIS_HOME` and `JARVIS_USER_DIR` override these defaults.

## Notes

- `better-sqlite3` is rebuilt for Electron during `npm install`.
- `src/core/package.json` marks the copied core as ESM without making the whole repo ESM.
- Compatibility route names may remain only as redirects to the single current workbench; they do not serve a second frontend.
# Jarvis local voice

The default TTS provider is the local Piper `jarvis-high` British voice with the same metallic FFmpeg chain used by `assistant-x-openclaw`. Install its isolated Python runtime and model once:

```powershell
npm run voice:install:jarvis
npm run probe:jarvis-tts
```

The model is stored under `models/jarvis` and the portable Python runtime under `.python`; both are excluded from Git. Jarvis voice failures are surfaced to the UI instead of silently switching to a different system voice.
