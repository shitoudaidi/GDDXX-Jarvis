#!/usr/bin/env python3
"""
Jarvis 语音服务
- 流式 ASR：Whisper + VAD，每次停顿触发识别，输出中间/最终结果
- 场景声音识别：YAMNet（可选，需 tensorflow-hub），识别鼓掌/响指/键盘/脚步等
"""

import asyncio
import json
import sys
import os
import argparse
import struct
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np

# 让 whisper 包从本地目录加载
_VOICE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _VOICE_DIR)

try:
    import websockets
except ImportError:
    print("[语音] 缺少 websockets 包，请运行: pip install websockets", flush=True)
    sys.exit(1)

try:
    import whisper as _whisper
except ImportError:
    print("[语音] 缺少 whisper 依赖，请运行: pip install openai-whisper", flush=True)
    sys.exit(1)

SAMPLE_RATE = 16000

# ── VAD 阈值 ──
# 笔记本风扇 / 空调等环境噪音 RMS 通常在 0.002~0.006；
# 正常说话峰值 RMS 在 0.02~0.1，因此阈值设在两者之间。
SILENCE_RMS_THRESHOLD     = 0.005   # 低于此 = 静默（原 0.003）
NEAR_SPEECH_RMS_THRESHOLD = 0.010   # 超过此才计入有声 chunk（原 0.004）
MIN_UTTERANCE_PEAK_RMS    = 0.015   # 整段utterance 的峰值必须达到此值才送转录（原 0.004）
MIN_UTTERANCE_VOICED_CHUNKS = 2     # 至少需要 2 个有声 chunk（原 1）

# ── Whisper 幻觉输出过滤 ──
_HALLUCINATION_FRAGMENTS = [
    # 中文视频平台创作者习语（Whisper 对这类说话非常容易幻觉）
    "字幕", "翻译", "感谢收看", "感谢观看", "谢谢收看", "谢谢观看",
    "请订阅", "请关注", "点赞", "订阅", "转发", "打赏",
    "作词", "作曲", "制作人", "出品", "版权",
    "明镜", "栏目", "不吝",
    # 英文常见幻觉
    "subtitles by", "thank you for watching", "please subscribe",
    "amara.org", "translated by", "music:", "♪", "♫", "♬", "🎵", "🎶",
]

import re as _re

def is_hallucination(text: str) -> bool:
    """检测 Whisper 常见幻觉输出，返回 True 表示应当过滤"""
    if not text:
        return True
    t = text.strip()
    if not t:
        return True
    # 纯标点或特殊字符
    if _re.match(r'^[\s\W]+$', t):
        return True
    # 过短（单个汉字/字母/符号）
    if len(t) <= 1:
        return True
    # 包含已知幻觉片段（不区分大小写）
    tl = t.lower()
    for frag in _HALLUCINATION_FRAGMENTS:
        if frag.lower() in tl:
            return True
    # 单字符重复（如"啊啊啊啊"、"嗯嗯嗯嗯"）
    unique_chars = set(c for c in t if c.strip())
    if len(unique_chars) <= 2 and len(t) >= 5:
        return True
    # 全部是数字或省略号组合（时间戳幻觉）
    if _re.match(r'^[\d\s:.,。，…]+$', t):
        return True
    # 短语级重复（如"我会说,我会说,我会说,…"）
    # 按标点分段，若段数 >= 4 且唯一段只有 1~2 种，判定为幻觉
    segs = [s.strip() for s in _re.split(r'[,，、。.！!？?\s]+', t) if s.strip()]
    if len(segs) >= 4 and len(set(segs)) <= 2:
        return True
    return False
AMBIENT_VOICE_CHUNKS_TO_REPORT = 4
# 连续多少个 chunk 静默后触发识别（每个 chunk = CHUNK_SAMPLES 样本）
SILENCE_CHUNKS_TO_FLUSH = 8
# 每次发送的音频块大小（样本数），对应 ~250ms
CHUNK_SAMPLES = SAMPLE_RATE // 4
# 缓冲区上限（秒），超过后强制识别
MAX_BUFFER_SECONDS = 25


# ── YAMNet 场景声音分类（可选） ──

YAMNET_EVENTS = {
    # (yamnet class index, 中文名, 英文key)
    132: ("鼓掌", "clapping"),
    387: ("打响指", "finger_snapping"),
    394: ("键盘打字", "keyboard_typing"),
    395: ("打字", "typing"),
    400: ("书写", "writing"),
    323: ("脚步声", "footsteps"),
    324: ("走路", "walking"),
    325: ("跑步", "running"),
    137: ("敲击", "knock"),
    138: ("敲门", "knock_door"),
    # speech 本身让 Whisper 处理，这里忽略
}

_yamnet_model = None
_yamnet_classes = None


def _try_load_yamnet():
    global _yamnet_model, _yamnet_classes
    try:
        import tensorflow_hub as hub
        import csv, urllib.request, io

        print("[语音] 加载 YAMNet 场景识别模型…", flush=True)
        _yamnet_model = hub.load("https://tfhub.dev/google/yamnet/1")
        # 加载类别标签
        labels_url = "https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv"
        with urllib.request.urlopen(labels_url, timeout=10) as resp:
            reader = csv.DictReader(io.TextIOWrapper(resp))
            _yamnet_classes = {int(row["index"]): row["display_name"] for row in reader}
        print("[语音] YAMNet 加载完成", flush=True)
    except Exception as e:
        print(f"[语音] YAMNet 不可用（场景识别将跳过）: {e}", flush=True)
        _yamnet_model = None


def classify_sound_event(audio_int16: np.ndarray):
    """用 YAMNet 识别场景声音，返回 {event, label_cn, confidence} 或 None"""
    if _yamnet_model is None:
        return None
    try:
        import tensorflow as tf
        audio_f = audio_int16.astype(np.float32) / 32768.0
        scores, _, _ = _yamnet_model(audio_f)
        mean_scores = scores.numpy().mean(axis=0)
        top_idx = int(np.argmax(mean_scores))
        top_conf = float(mean_scores[top_idx])
        if top_conf < 0.25:
            return None
        if top_idx in YAMNET_EVENTS:
            label_cn, event_key = YAMNET_EVENTS[top_idx]
            return {"event": event_key, "label_cn": label_cn, "confidence": round(top_conf, 3)}
    except Exception:
        pass
    return None


# ── 主服务 ──

class VoiceServer:
    def __init__(self, host="127.0.0.1", port=3723, model_name="small"):
        self.host = host
        self.port = port
        self.model_name = model_name
        self.model = None
        self._executor = ThreadPoolExecutor(max_workers=2)

    def load_whisper(self):
        print(f"[语音] 加载 Whisper 模型: {self.model_name}…", flush=True)
        self.model = _whisper.load_model(self.model_name)
        print(f"[语音] Whisper ({self.model_name}) 加载完成", flush=True)

    # 按语言准备 initial_prompt（轻量上下文，帮助 Whisper 选择正确的同音字/字符集）
    # 不使用词汇列表——会导致幻觉循环，只用简短场景描述即可
    _LANG_PROMPTS = {
        "zh": "以下是普通话对话。",
        "zh-cn": "以下是普通话对话。",
        "zh-tw": "以下是普通話對話，請輸出繁體中文。",
        "en": "The following is spoken English.",
        "ja": "以下は日本語の会話です。",
    }

    def _get_initial_prompt(self, lang: str) -> str:
        return self._LANG_PROMPTS.get(lang.lower(), "")

    def _run_transcribe(self, audio_f32: np.ndarray, lang: str) -> str:
        try:
            prompt = self._get_initial_prompt(lang)
            result = self.model.transcribe(
                audio_f32,
                language=lang if lang != "auto" else None,
                fp16=False,
                verbose=False,
                # temperature=0 → 确定性 beam search，中文准确率最高；
                # 搭配 beam_size=5（默认）可以不设 best_of
                temperature=0.0,
                # condition_on_previous_text=False：每句话独立解码，
                # 避免前文幻觉污染后续识别，适合流式逐句转录场景
                condition_on_previous_text=False,
                # no_speech_threshold：低于此概率视为非语音，
                # 0.3 在实时麦克风场景下比默认 0.6 更平衡
                # 提高 no_speech_threshold：更容易判定为"没有语音"，减少噪音误识
                no_speech_threshold=0.6,
                # logprob_threshold 提高：平均对数概率太低的片段丢弃（减少低置信度幻觉）
                logprob_threshold=-0.8,
                # compression_ratio_threshold 降低：重复性高的输出更早被丢弃
                compression_ratio_threshold=2.0,
                # initial_prompt：提供场景上下文，引导模型选择正确同音字/字符集
                initial_prompt=prompt if prompt else None,
            )
            text = (result.get("text") or "").strip()
            # 过滤 Whisper 幻觉输出：无声/噪声时常见的固定幻觉文本
            if is_hallucination(text):
                print(f"[语音] 过滤幻觉输出: {repr(text[:60])}", flush=True)
                return ""
            return text
        except Exception as e:
            print(f"[语音] 识别错误: {e}", flush=True)
            return ""

    async def transcribe_async(self, audio_int16: np.ndarray, lang: str) -> str:
        audio_f32 = audio_int16.astype(np.float32) / 32768.0
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, self._run_transcribe, audio_f32, lang)

    async def classify_async(self, audio_int16: np.ndarray):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, classify_sound_event, audio_int16)

    async def handle(self, websocket):
        print("[语音] 客户端已连接", flush=True)
        # 每个连接独立的音频缓冲和状态
        buf = np.array([], dtype=np.int16)
        buf = np.array([], dtype=np.int16)
        silence_count = 0
        voiced_chunks = 0
        utterance_peak_rms = 0.0
        ambient_voice_chunks = 0
        lang = "zh"
        # 用于声音事件的独立 1s 缓冲
        event_buf = np.array([], dtype=np.int16)

        try:
            async for raw in websocket:
                # ── 控制消息（JSON 字符串） ──
                if isinstance(raw, str):
                    try:
                        msg = json.loads(raw)
                        if msg.get("type") == "config":
                            lang = msg.get("lang", "zh") or "zh"
                            await websocket.send(json.dumps({"type": "config_ok", "lang": lang}))
                        elif msg.get("type") == "flush":
                            # 强制识别当前缓冲
                            if (
                                len(buf) > SAMPLE_RATE // 4
                                and voiced_chunks >= MIN_UTTERANCE_VOICED_CHUNKS
                                and utterance_peak_rms >= MIN_UTTERANCE_PEAK_RMS
                            ):
                                text = await self.transcribe_async(buf, lang)
                                if text:
                                    await websocket.send(json.dumps({"type": "transcript", "text": text, "is_final": True}))
                            buf = np.array([], dtype=np.int16)
                            silence_count = 0
                            voiced_chunks = 0
                            utterance_peak_rms = 0.0
                    except Exception:
                        pass

                # ── 二进制音频（16-bit PCM mono 16kHz） ──
                if not isinstance(raw, (bytes, bytearray)):
                    continue

                chunk = np.frombuffer(raw, dtype=np.int16)
                event_buf = np.append(event_buf, chunk)

                # VAD：计算 RMS（归一化）
                rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2))) / 32768.0
                is_near_speech = rms >= NEAR_SPEECH_RMS_THRESHOLD
                is_silent = rms < SILENCE_RMS_THRESHOLD

                if not is_silent:
                    buf = np.append(buf, chunk)
                    silence_count = 0
                    if is_near_speech:
                        voiced_chunks += 1
                    else:
                        voiced_chunks = max(voiced_chunks, 1)
                    utterance_peak_rms = max(utterance_peak_rms, rms)
                    ambient_voice_chunks = 0
                elif len(buf) > 0:
                    # Keep a short trailing tail so Whisper receives a natural utterance boundary.
                    buf = np.append(buf, chunk)
                    silence_count += 1
                else:
                    if not is_silent:
                        ambient_voice_chunks += 1
                        if ambient_voice_chunks >= AMBIENT_VOICE_CHUNKS_TO_REPORT:
                            await websocket.send(json.dumps({
                                "type": "ambient_voice",
                                "rms": round(rms, 4),
                            }))
                            ambient_voice_chunks = 0

                buf_seconds = len(buf) / SAMPLE_RATE

                # 触发条件 A：说完了一句话（静默持续够长）
                should_flush_speech = silence_count >= SILENCE_CHUNKS_TO_FLUSH and buf_seconds > 0.3
                # 触发条件 B：缓冲区过大
                should_flush_max = buf_seconds >= MAX_BUFFER_SECONDS

                if should_flush_speech or should_flush_max:
                    if (
                        len(buf) > SAMPLE_RATE // 8
                        and voiced_chunks >= MIN_UTTERANCE_VOICED_CHUNKS
                        and utterance_peak_rms >= MIN_UTTERANCE_PEAK_RMS
                    ):
                        text = await self.transcribe_async(buf, lang)
                        if text:
                            await websocket.send(json.dumps({
                                "type": "transcript",
                                "text": text,
                                "is_final": True,
                            }))
                    buf = np.array([], dtype=np.int16)
                    silence_count = 0
                    voiced_chunks = 0
                    utterance_peak_rms = 0.0

                # ── 场景声音识别（每积累 1s 音频做一次） ──
                if len(event_buf) >= SAMPLE_RATE:
                    seg = event_buf[:SAMPLE_RATE]
                    event_buf = event_buf[SAMPLE_RATE:]
                    seg_rms = float(np.sqrt(np.mean(seg.astype(np.float32) ** 2))) / 32768.0
                    # 只在有足够能量时做分类（避免对静默做无意义推理）
                    if seg_rms > SILENCE_RMS_THRESHOLD * 2 and _yamnet_model is not None:
                        event = await self.classify_async(seg)
                        if event:
                            await websocket.send(json.dumps({"type": "sound_event", **event}))

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            print(f"[语音] 连接异常: {e}", flush=True)

        print("[语音] 客户端已断开", flush=True)

    async def run(self):
        self.load_whisper()
        _try_load_yamnet()
        print(f"[语音] WebSocket 服务启动: ws://{self.host}:{self.port}", flush=True)
        async with websockets.serve(self.handle, self.host, self.port):
            await asyncio.Future()


def main():
    parser = argparse.ArgumentParser(description="Jarvis 语音识别服务")
    parser.add_argument("--model", default="small",
                        choices=["tiny", "tiny.en", "base", "base.en", "small", "small.en",
                                 "medium", "medium.en", "large", "large-v2", "large-v3", "turbo"],
                        help="Whisper 模型大小（默认 base）")
    parser.add_argument("--port", type=int, default=3723, help="WebSocket 端口（默认 3723）")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    args = parser.parse_args()

    server = VoiceServer(host=args.host, port=args.port, model_name=args.model)
    asyncio.run(server.run())


if __name__ == "__main__":
    main()
