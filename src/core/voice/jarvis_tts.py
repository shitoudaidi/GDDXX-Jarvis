#!/usr/bin/env python3
"""Local Piper Jarvis voice with the project's metallic FFmpeg treatment."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from piper import PiperVoice, SynthesisConfig


ROOT = Path(os.environ.get("JARVIS_MODEL_ROOT", Path(__file__).resolve().parents[3]))
MODEL_DIR = ROOT / "models" / "jarvis" / "en" / "en_GB" / "jarvis" / "high"
MODEL_PATH = MODEL_DIR / "jarvis-high.onnx"
CONFIG_PATH = MODEL_DIR / "jarvis-high.onnx.json"
def resolve_espeak_data_dir() -> Path:
    candidates = [
        os.environ.get("JARVIS_ESPEAK_DATA"),
        Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Jarvis" / "voice" / "espeak-ng-data",
        ROOT / ".python" / "Lib" / "site-packages" / "piper" / "espeak-ng-data",
        ROOT / ".python" / "lib" / "site-packages" / "piper" / "espeak-ng-data",
        Path(__file__).resolve().parents[3] / ".python" / "Lib" / "site-packages" / "piper" / "espeak-ng-data",
        Path(__file__).resolve().parents[3] / ".python" / "lib" / "site-packages" / "piper" / "espeak-ng-data",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if (path / "phontab").is_file():
            return path
    return Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Jarvis" / "voice" / "espeak-ng-data"


ESPEAK_DATA_DIR = resolve_espeak_data_dir()
LENGTH_SCALE = 1.05
PLAYBACK_GAIN = 1.5
TARGET_PEAK = 0.97
METALLIC_FILTER = (
    "aecho=0.8:0.85:20|45|70:0.45|0.32|0.12,"
    "chorus=0.4:0.6:45:0.2:0.18:1.2,"
    "bass=g=4:f=110,treble=g=2.5,highpass=f=90,lowpass=f=8500"
)


def normalize(audio: np.ndarray) -> np.ndarray:
    if not audio.size:
        return audio.astype(np.float32)
    peak = float(np.max(np.abs(audio)))
    if peak > 1e-6:
        audio = audio * (TARGET_PEAK / PLAYBACK_GAIN / peak)
    return audio.astype(np.float32)


def synthesize(text: str, output: Path, ffmpeg: str) -> None:
    if not MODEL_PATH.is_file() or not CONFIG_PATH.is_file():
        raise FileNotFoundError(
            f"Jarvis voice model is missing. Expected {MODEL_PATH} and {CONFIG_PATH}"
        )

    if not (ESPEAK_DATA_DIR / "phontab").is_file():
        raise FileNotFoundError(
            f"Piper phonemizer data is missing at {ESPEAK_DATA_DIR}. "
            "Run npm run voice:install:jarvis."
        )
    voice = PiperVoice.load(
        str(MODEL_PATH),
        config_path=str(CONFIG_PATH),
        espeak_data_dir=str(ESPEAK_DATA_DIR),
    )
    chunks = [
        chunk.audio_float_array
        for chunk in voice.synthesize(
            text, syn_config=SynthesisConfig(length_scale=LENGTH_SCALE)
        )
    ]
    if not chunks:
        raise RuntimeError("Piper returned no audio")

    audio = np.concatenate(chunks).astype(np.float32)
    sample_rate = voice.config.sample_rate
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="jarvis-tts-") as temp_dir:
        raw_path = Path(temp_dir) / "raw.wav"
        sf.write(raw_path, audio, sample_rate, subtype="FLOAT")
        command = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(raw_path), "-af", METALLIC_FILTER,
            "-c:a", "pcm_s16le", str(output),
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg metallic processing failed: {result.stderr[:400]}")

    processed, processed_rate = sf.read(output, dtype="float32")
    if processed.ndim > 1:
        processed = processed.mean(axis=1)
    sf.write(output, normalize(processed), processed_rate, subtype="PCM_16")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ffmpeg", default=os.environ.get("FFMPEG_BIN", "ffmpeg"))
    args = parser.parse_args()
    try:
        synthesize(args.text.strip(), args.output, args.ffmpeg)
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
