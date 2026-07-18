# Jarvis Local Agent

An open-source Windows desktop Agent with a Jarvis-style control room, DeepSeek conversation, wake-word voice interaction, local Jarvis TTS, AI HOT news, and an optional Grok Build engineering workspace.

## Quick Start (Windows)

### Option A: install the release

1. Download `Jarvis-Setup-*.exe` from the GitHub Releases page.
2. Run the installer and launch `Jarvis` from the desktop or Start menu.
3. On first launch, open Settings and configure DeepSeek plus ASR credentials.
4. For wake voice, say `嗨，贾维斯` or `Hello Jarvis` after the microphone status shows ready.

### Option B: run from source

Requirements: Windows 10/11, Node.js 20+, Git, and a working microphone.

```powershell
git clone https://github.com/YOUR_ACCOUNT/jarvis-local-agent.git
cd jarvis-local-agent
Copy-Item config.example.json config.json
notepad config.json
npm.cmd install
npm.cmd run start:desktop
```

Never commit `config.json`. It is intentionally ignored by Git.

## Configuration

`config.json` is local-only. At minimum configure:

- `provider`: `deepseek`
- `apiKey`: your DeepSeek API key
- `model`: the model enabled for your account
- `voice.voiceProvider`: `aliyun` for cloud ASR, or `local` for bundled Whisper
- `voice.aliyunApiKey`: DashScope key when using Aliyun ASR
- `tts.ttsProvider`: `jarvis` for the bundled Jarvis voice

The Jarvis Piper voice model is not committed because it is large. Install it once with:

```powershell
npm.cmd run voice:install:jarvis
npm.cmd run probe:jarvis-tts
```

The model is stored locally under `models/jarvis` and is excluded from Git.

## Build and Release

```powershell
npm.cmd run check       # UI build plus safety and integration probes
npm.cmd run pack        # unpacked Windows app for local testing
npm.cmd run dist        # installer under dist/
```

The packaged app stores user data under `%LOCALAPPDATA%\JarvisLocalAgent`; source-mode development data is kept in the ignored `data/` directory. Project workspaces and Agent runtime files are kept on `H:` by the desktop configuration.

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
npm.cmd run start:desktop
```

This launches the local Electron binary from this project and starts the local Jarvis core on `127.0.0.1:3721` by default.

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

Runtime data is written to `%LOCALAPPDATA%\JarvisLocalAgent` in packaged builds and `data/` during development.

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

The model is stored under `models/jarvis` and the Python packages under `.venv`; both are excluded from Git. Jarvis voice failures are surfaced to the UI instead of silently switching to a different system voice.
