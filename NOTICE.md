# Third-party components

Jarvis itself is GPL-3.0 (see LICENSE). It includes or downloads the following, each under its own licence.

## Included in this repository

| Component | Where | Licence |
|---|---|---|
| three.js r160 (build + selected examples/jsm) | `hud/vendor/three/` | MIT (`hud/vendor/three/LICENSE`) |
| Saira, Michroma, JetBrains Mono (woff2 subsets) | `hud/vendor/fonts/` | SIL Open Font License 1.1 |
| Syncopate (woff2 subset) | `hud/vendor/fonts/` | Apache License 2.0 |
| Silero VAD model (`silero_vad.onnx`, from the sherpa-onnx release) | `models-bundle/` | MIT |
| Raptor 2 figure (`raptor-engine.html`, from the anatomy examples, © 2026 Ryan) | `jarvis/holo_samples/` | MIT |
| Xiaomi-cloud-tokens-extractor, Piotr Machowski | `jarvis/plugins/mihome/token_extractor.py` | MIT (`LICENSE.token_extractor` beside it) |

The 8 HUD skins borrow the *visual language* of [agent-display](https://github.com/CYBERDADDYLEO/agent-display)
(PolyForm Noncommercial). No code or assets from that project are in this repository; every skin core here is our own.

## Downloaded at install time (not in this repository)

Listed in `app/models.json`, fetched from their original publishers into the local models folder.

| Model | Source | Licence |
|---|---|---|
| Silero VAD | snakers4/silero-vad via sherpa-onnx | MIT |
| SenseVoice small (int8) | FunAudioLLM via sherpa-onnx | FunASR model licence (see its model card) |
| Parakeet TDT 0.6B v2 (int8) | NVIDIA via sherpa-onnx | CC-BY-4.0 |
| openWakeWord melspectrogram / embedding / "hey jarvis" | dscripka/openWakeWord | pretrained models CC BY-NC-SA 4.0 (non-commercial) |
| 3D-Speaker CAM++ speaker model | modelscope 3D-Speaker via sherpa-onnx | Apache-2.0 |
| Piper voice en_GB "alan" (fallback voice) | rhasspy/piper-voices | see its MODEL_CARD |
| Kokoro multi-lang v1.1 (Chinese mode only) | hexgrad via sherpa-onnx | Apache-2.0 |
| **Jarvis voice "jarvis-high"** (default voice) | community Piper model (jgkawell/jarvis on Hugging Face; ModelScope mirror rubintry/jarvis) | community model trained on film audio: the character's voice belongs to its rights holders. Downloaded for **personal, non-commercial use only**. Do not redistribute it or use it commercially. |

Python packages are installed from PyPI by `app/install.py` (`requirements.txt`): sherpa-onnx, onnxruntime, numpy, scipy,
sounddevice/PortAudio, soundfile, livekit (WebRTC audio processing), piper-tts (GPL-3.0), imageio-ffmpeg (bundles FFmpeg),
pywebview, websockets, psutil, segno, opencv-python-headless, pyobjc (macOS), mediapipe and rapidocr-onnxruntime (Windows),
pycryptodome, requests, pillow, colorama. Each keeps its own licence.

The installers bundle a Python runtime from [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
(PSF licence and the licences of the libraries it links).

## Trademarks

J.A.R.V.I.S. is a character from Marvel films; this is an unofficial fan project with no affiliation. Starship, Tesla
Roadster and Optimus demos show public information about those products; names belong to their owners.
