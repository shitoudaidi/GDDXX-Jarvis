"""暂停聆听: with listening paused, "Hey Jarvis, ..." must not wake Jarvis; after resuming, it must.
Runs the real Service on a fake sound card (same as smoke_service.py) and drives it over the WebSocket."""
import asyncio, json, os, sys, threading, time, types, numpy as np, soundfile as sf
from pathlib import Path
from scipy.signal import resample_poly
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("JARVIS_LANG", "en")
CL = Path(__file__).parent / "clips_en"
mic16 = np.zeros(16000 * 20, np.float32)
for t0, k in [(2.0, "wake_cmd"), (12.0, "wake_only")]:      # first while paused, second after resuming
    x = sf.read(CL / f"{k}.wav", dtype="float32")[0]; i = int(t0 * 16000); mic16[i:i + len(x)] += x
mic48 = resample_poly(mic16, 3, 1).astype(np.float32) + np.random.default_rng(0).normal(0, 0.003, len(mic16) * 3).astype(np.float32)
START = threading.Event()

class FakeDuplex:
    def __init__(self, samplerate, blocksize, channels, dtype, callback): self.cb, self.bs = callback, blocksize
    def __enter__(self):
        def run():
            START.wait()
            for i in range(0, len(mic48) - self.bs, self.bs):
                outd = np.zeros((self.bs, 1), np.float32)
                self.cb(mic48[i:i + self.bs][:, None], outd, self.bs, None, None)
                time.sleep(self.bs / 48000)
        threading.Thread(target=run, daemon=True).start(); return self
    def __exit__(self, *a): pass
sys.modules["sounddevice"] = types.SimpleNamespace(Stream=FakeDuplex, default=types.SimpleNamespace(device=(0, 0)),
                                                   query_devices=lambda i: {"name": "fake"})
from jarvis import service

async def main():
    s = service.Service(); threading.Thread(target=s.audio_loop, daemon=True).start()
    asyncio.create_task(s.ws_main()); await asyncio.sleep(1)
    import websockets
    wakes, listen = [], []
    async with websockets.connect("ws://127.0.0.1:8765") as ws:
        await ws.send(json.dumps({"type": "listen", "on": False}))
        await asyncio.sleep(0.5)
        START.set(); t0 = time.time(); resumed = False
        while time.time() - t0 < 19:
            if not resumed and time.time() - t0 > 10:
                await ws.send(json.dumps({"type": "listen", "on": True})); resumed = True
            try: m = json.loads(await asyncio.wait_for(ws.recv(), 0.5))
            except asyncio.TimeoutError: continue
            if m["type"] == "wake": wakes.append(round(time.time() - t0, 1))
            if m["type"] == "listen": listen.append(m["on"])
    print("listen msgs", listen, "wakes at", wakes)
    assert listen[:1] == [True] and False in listen and listen[-1] is True, listen
    assert not [t for t in wakes if t < 10], f"woke while paused: {wakes}"
    assert [t for t in wakes if t >= 11], f"did not wake after resuming: {wakes}"
    print("PASS")
asyncio.run(main())
