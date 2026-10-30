"""Jarvis voice service (macOS and Windows): started by the Jarvis window, stops when the window closes.

  mic -> WebRTC echo cancel -> wake word + VAD + local ASR -> command -> brain -> TTS -> speaker
                     ^------------- speaker reference --------------------------------|

Events go out on ws://127.0.0.1:8765 so the HUD can show listening/thinking/speaking
and subtitles. Typed text can be sent in on the same socket ({"type":"text","text":...}).
"""
import asyncio, json, os, queue, threading, time, wave
from pathlib import Path
import numpy as np
import sounddevice as sd
from scipy.signal import resample_poly
from . import models
from .aec import EchoCanceller
from .engine import VoiceEngine
from .tts import make_speaker, SR_OUT
from .brain import answer_pair
from . import config, paths, sysmon, schedule, brain, memory, tools

SR_IN = models.SR
DEV_SR, HOP = 48000, 480          # one duplex stream: 10 ms blocks, mic and speaker on the same clock


# With "debug_clips": true in config.json, recent wake attempts are kept as short WAV clips in ~/.jarvis/clips
# so they can be replayed through the same pipeline. Off by default: it records the room.
CLIPS = paths.CLIPS
CLIPS_KEEP = 40
SAVE_CLIPS = bool(config.get("debug_clips")) or os.environ.get("JARVIS_DEBUG_CLIPS") == "1"


def N():
    return config.user_name()


def ack_line():
    return f"Yes, {N()}?" if models.LANG == "en" else "我在。"


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


class Decimator:
    """48 kHz -> 16 kHz with a stateful anti-alias filter, safe on 10 ms blocks."""
    def __init__(self):
        from scipy.signal import firwin
        self.h = firwin(63, 7200, fs=DEV_SR)
        self.zi = np.zeros(len(self.h) - 1)
        self.pos = 0

    def __call__(self, x):
        from scipy.signal import lfilter
        y, self.zi = lfilter(self.h, [1.0], x, zi=self.zi)
        out = y[(-self.pos) % 3::3]
        self.pos += len(x)
        return out.astype(np.float32)


class Player:
    """Speaker queue that can be emptied instantly (barge-in)."""
    def __init__(self):
        self.q, self.cur, self.lock = queue.Queue(), np.zeros(0, np.float32), threading.Lock()

    def take(self, n):
        with self.lock:
            while len(self.cur) < n and not self.q.empty():
                self.cur = np.concatenate([self.cur, self.q.get_nowait()])
            out = np.zeros(n, np.float32); k = min(n, len(self.cur))
            out[:k] = self.cur[:k]; self.cur = self.cur[k:]
        return out

    def push(self, x):
        """x at 24 kHz (TTS rate); stored at the device rate."""
        self.q.put(resample_poly(x, 2, 1).astype(np.float32))

    def busy(self):
        with self.lock:
            return len(self.cur) > 0 or not self.q.empty()

    def stop(self):
        with self.lock:
            self.cur = np.zeros(0, np.float32)
            while not self.q.empty():
                self.q.get_nowait()


class Service:
    def __init__(self):
        self.aec = EchoCanceller()
        self.player = Player()
        self.dec_mic, self.dec_ref = Decimator(), Decimator()
        self.speaker = make_speaker()
        self.clients = set()
        self.mic_msg = None                    # set while no audio device can be opened
        self.muted = False                     # the HUD's 暂停聆听 switch: the microphone is ignored until it is turned back on
        self.mute_reset = False                # the audio thread drops any half-heard sentence on the next block
        from . import gesture                  # hand tracking for holograms
        gesture.UI = self.broadcast
        self.loop = None
        self.engine = VoiceEngine(self.on_event)
        from . import voiceprint
        if voiceprint.VP.available():
            self.engine.voice = voiceprint.VP          # answer only the user's voice
        voiceprint.ENROLL = lambda: threading.Thread(target=self.start_enroll, daemon=True).start()
        self.gen = 0                    # bumps on every interrupt so stale replies are dropped
        self.greeted, self.reminded, self.trip_shown = False, set(), None
        tools.bind(ui=self.broadcast, say_alone=self.speak_alone, narrate=self.narrate, gen=lambda: self.gen)
        tools.collect()                          # load every tool source once, so each gets the hooks above
        harness = tools.plugin("harness")
        if harness:
            harness.NOTIFY = lambda task, ok, answer: threading.Thread(target=self.harness_done, args=(task, ok, answer), daemon=True).start()
            if harness.available():
                threading.Timer(25.0, harness.brainlink.check_once).start()   # once per version: is the brain reachable?
        self.mic_q = queue.Queue()
        self.stats = {"raw": 0.0, "clean": 0.0, "wake": 0.0, "status": ""}
        self.recent = np.zeros(10 * SR_IN, np.float32)   # last 10 s the engine heard
        self.clip_at, self.clip_peak = None, 0.0
        self.level_at, self.level_peak = 0.0, 0.0
        self.seen = time.time() + 20      # last time a window was connected (grace period at start)

    # -- debug clips -----------------------------------------------------
    def mark_attempt(self, score=0.0):
        """Something wake-like happened: save the surrounding audio a moment from now."""
        if not SAVE_CLIPS:
            return
        self.clip_peak = max(self.clip_peak, score)
        if self.clip_at is None:
            self.clip_at = time.time() + 2.5

    def save_clip(self):
        try:
            d = CLIPS; d.mkdir(parents=True, exist_ok=True)
            name = d / f"{time.strftime('%H%M%S')}_w{self.clip_peak:.2f}_{self.engine.state}.wav"
            pcm = (np.clip(self.recent[-8 * SR_IN:], -1, 1) * 32767).astype(np.int16)
            with wave.open(str(name), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR_IN); w.writeframes(pcm.tobytes())
            for old in sorted(d.glob("*.wav"))[:-CLIPS_KEEP]:
                old.unlink()
            log(f"saved clip {name.name}")
        except Exception as e:
            log(f"clip save failed: {e}")
        self.clip_at, self.clip_peak = None, 0.0

    # -- events --------------------------------------------------------
    def broadcast(self, msg):
        if self.loop:
            asyncio.run_coroutine_threadsafe(self._send(json.dumps(msg, ensure_ascii=False)), self.loop)

    async def _send(self, s):
        for c in list(self.clients):
            try: await c.send(s)
            except Exception: self.clients.discard(c)

    def on_event(self, name, data):
        log(f"event {name} {data if name not in ('ack',) else ''}")
        self.broadcast({"type": name, **data})
        if name in ("wake", "heard", "rejected"):
            self.mark_attempt()
        if name == "wake":
            self.broadcast({"type": "state", "state": "listening"})
        elif name == "ack":
            self.say(ack_line(), interruptible=True, zh="在呢？" if models.LANG == "en" else "")
        elif name in ("barge_in", "stop"):
            self.gen += 1; self.player.stop(); self.engine.set_speaking(False)
            self.broadcast({"type": "state", "state": "listening" if name == "barge_in" else "idle"})
        elif name == "command":
            self.gen += 1; self.player.stop()      # cut a "Yes?" that is still playing
            self.handle(data["text"])
        elif name in ("timeout", "rejected"):
            self.broadcast({"type": "state", "state": "idle"})

    # -- day plan ------------------------------------------------------
    def schedule_msg(self):
        return {"type": "schedule", "day": schedule._day(), "items": schedule.load()["items"]}

    def push_schedule(self):
        try:
            self.broadcast(self.schedule_msg())
        except Exception as e:
            log(f"schedule: {e}")

    # -- weather and routes (AMap plugin) -------------------------------------
    def push_world(self):
        amap = tools.plugin("amap")
        if not amap or not amap.key():
            return
        try:
            self.broadcast({"type": "weather", **amap.weather()})
        except Exception as e:
            log(f"weather: {e}")
        try:                                    # weekday mornings: the commute to work
            ps, now = amap.places(), time.localtime()
            if "home" in ps and "work" in ps and now.tm_wday < 5 and 6 <= now.tm_hour < 10 and not self.trip_shown:
                amap.LAST_ROUTE = amap.route("work")
                self.push_trip()
        except Exception as e:
            log(f"commute: {e}")

    def push_trip(self):
        amap = tools.plugin("amap")
        r = amap and amap.LAST_ROUTE
        if not r or r is self.trip_shown:
            return
        self.trip_shown = r
        qr = ""
        try:
            import segno
            qr = segno.make(r["nav_url"], error="m").svg_inline(scale=2, dark="#0a1720", light="#DCEFF7", border=2, omitsize=True)
        except Exception as e:
            log(f"qr: {e}")
        if r.get("holo") and "map" not in r["holo"]:
            try:
                r["holo"]["map"] = amap.static_map(r["holo"])
            except Exception as e:
                log(f"static map: {e}")
        self.broadcast({"type": "trip", **{k: v for k, v in r.items() if k != "nav_url"}, "qr": qr})

    def harness_done(self, task, ok, answer):
        """A DeepSeek Harness job ended: let the model sum it up, then say it once nobody is mid-conversation."""
        note = (f"[Background job report, not the user speaking] DeepSeek Harness {'finished' if ok else 'could not finish'} "
                f"this task: {task[:300]}\nIts report: {answer[:2500]}\nTell the user in one or two sentences what was made "
                f"and that it is in the '{paths.workspace().name}' folder, or why it failed. Do not call ask_harness again.")
        try:
            en, zh = answer_pair(note)
        except Exception as e:
            log(f"harness report: {e}")
            en, zh = (f"DeepSeek Harness has finished, {N()}.", "DeepSeek Harness 已经做完了。") if ok \
                else (f"I'm sorry, {N()}, DeepSeek Harness couldn't finish that.", "抱歉，DeepSeek Harness 没能完成。")
        for _ in range(450):                       # wait up to 15 min for a quiet moment
            if self.speak_alone(en, zh):
                return
            time.sleep(2)
        log(f"harness report not spoken: {en}")

    def speak_alone(self, en, zh):
        """Jarvis starts talking on its own: only when nobody is mid-conversation."""
        if self.engine.state != "standby":
            return False
        brain.remember_said(en)
        log(f"says: {en}")
        self.say(en, zh=zh)
        return True

    def morning_question(self, tries=12):
        """Once a day, if nothing is planned yet, ask for the plan (the answer needs no wake word)."""
        try:
            flag = paths.DATA / "asked-plan.txt"
            today = schedule._day()
            h = time.localtime().tm_hour
            if schedule.load()["items"] or not 5 <= h < 18 or (flag.exists() and flag.read_text().strip() == today):
                return
            greet = "Good morning" if h < 12 else "Good afternoon" if h < 18 else "Good evening"
            zh_greet = "早上好" if h < 12 else "下午好" if h < 18 else "晚上好"
            if self.speak_alone(f"{greet}, {N()}. What's on your plate today?", f"{zh_greet}，今天有什么安排？"):
                flag.parent.mkdir(parents=True, exist_ok=True)
                flag.write_text(today)
            elif tries > 1:                      # mid-conversation: ask a little later
                threading.Timer(5.0, self.morning_question, kwargs={"tries": tries - 1}).start()
        except Exception as e:
            log(f"morning question: {e}")

    def remind(self):
        try:
            for it in schedule.due(5):
                key = (schedule._day(), it["id"], it["start"])
                if key in self.reminded:
                    continue
                if self.speak_alone(f"{N().capitalize()}, {it.get('title_en') or 'your next item'} starts at {it['start']}.",
                                    f"{it.get('title') or '下一项安排'} {it['start']} 开始。"):
                    self.reminded.add(key)
        except Exception as e:
            log(f"remind: {e}")

    def handle(self, text, spoken=True):
        gen = self.gen
        self.broadcast({"type": "state", "state": "thinking"}); self.broadcast({"type": "you", "text": text})
        memory.log_turn("you", text, via="voice" if spoken else "typed")
        def work():
            reply, zh = answer_pair(text, spoken=spoken)
            log(f"reply: {reply[:120]}" + (f" | {zh[:60]}" if zh else ""))
            self.push_schedule()
            self.push_trip()
            if gen == self.gen:
                self.say(reply, gen=gen, zh=zh)
        threading.Thread(target=work, daemon=True).start()

    def brain_msg(self, msg):
        from .plugins.harness import brainlink
        B, kind = brainlink.BRAIN, msg["type"]
        tab = msg.get("tab") or "default"
        try:
            if kind == "brain_prompt" and msg.get("text", "").strip():
                text = msg["text"].strip()
                memory.log_turn("you", text, via="brain")
                images = [(i["data"], i.get("mime", "image/png")) for i in msg.get("images", []) if i.get("data")]
                def done(stop, answer):
                    if answer:
                        memory.log_turn("jarvis", answer, via="brain")
                B.prompt(text, images=images, done=done, tab=tab)
            elif kind == "brain_answer":
                B.answer(msg.get("ask"), msg.get("allow"))
            elif kind == "brain_cancel":
                B.cancel(tab)
            elif kind == "brain_effort":
                B.set_effort(tab, msg.get("level"))
            elif kind == "brain_new":
                B.new_conversation(tab)
                self.broadcast({"type": "brain", "kind": "status", "state": "idle", "fresh": True,
                                "effort": B.effort_for(tab), "tab": tab})
                B.request_usage(tab, force=True)
            elif kind == "brain_usage":
                B.request_usage(tab, force=True)
            elif kind == "brain_close":
                B.close_session(tab)
                self.broadcast({"type": "brain", "kind": "status", "state": "idle", "closed": tab, "tab": tab})
            elif kind == "brain_abilities":
                from . import skills
                from . import review
                self.broadcast({"type": "brain", "kind": "abilities", **skills.listing(), "learning": skills.learning(), "ideas": review.all_open()})
            elif kind == "brain_manage":
                from . import skills
                r = skills.manage(msg.get("action", "list"), msg.get("name", ""))
                if not r.get("ok"):
                    self.broadcast({"type": "brain", "kind": "error", "text": r.get("error", "")})
                from . import review
                self.broadcast({"type": "brain", "kind": "abilities", **skills.listing(), "learning": skills.learning(), "ideas": review.all_open()})
            elif kind == "brain_install":
                from . import skills
                r = skills.promote(msg.get("name", ""))
                self.broadcast({"type": "brain", "kind": "installed", "name": msg.get("name"), **{k: v for k, v in r.items() if k != "test"}})
                if r.get("ok"):
                    self.say(f"Installed, {N()}. I can now use {msg.get('name')}.", zh=f"装好了。我已经学会了 {msg.get('name')}。")
        except Exception as e:
            log(f"brain: {type(e).__name__}: {e}")
            self.broadcast({"type": "brain", "kind": "error", "text": f"{type(e).__name__}: {e}"[:400]})

    def llm_msg(self, msg):
        from . import onboard
        try:
            r = onboard.handle(msg)
        except Exception as e:
            r = {"type": "llm", "kind": "error", "error": f"{type(e).__name__}: {e}"[:300]}
        if msg.get("id"):
            r["id"] = msg["id"]
        self.broadcast(r)
        if r.get("kind") == "saved":
            log(f"language model set: {r.get('provider')} {r.get('model')}")

    def night(self):
        """1-6 am: review the day that just ended, then let the brain learn one approved thing.
        From 6 am: if there is news from the night (or yesterday was never reviewed), tell the user once."""
        from . import review
        harness = tools.plugin("harness")
        brainlink = harness.brainlink if harness and harness.available() else None
        if getattr(self, "_night_busy", False):
            return
        self._night_busy = True
        try:
            now = time.localtime()
            today = time.strftime("%Y-%m-%d")
            flag = paths.MEMORY / "night-flags.json"
            try:
                flags = json.loads(flag.read_text())
            except Exception:
                flags = {}
            yesterday = review._day(1)
            if 1 <= now.tm_hour < 6:
                if not review.load(yesterday):
                    r = review.run(yesterday)
                    log(f"night review {yesterday}: {len(r.get('proposals', []))} proposals {r.get('error', '')}")
                if flags.get("learned") != today and brainlink and review.night_task() and not brainlink.BRAIN.busy:
                    flags["learned"] = today
                    flag.write_text(json.dumps(flags))
                    log(f"night learning: {review.start_learning().get('learning')}")
                return
            if now.tm_hour >= 6 and flags.get("reported") != today and self.engine.state == "standby" and not self.player.busy():
                if not review.load(yesterday) and not getattr(self, "_reviewed_late", False):
                    self._reviewed_late = True                     # Jarvis was closed overnight: review now, quietly
                    review.run(yesterday)
                reviews, learned = review.pending(), review.night_results()
                if not reviews and not learned:
                    return
                ideas = sum(len([p for p in r.get("proposals", []) if p["state"] == "new"]) for r in reviews)
                ok = [e["item"] for e in learned if any((e.get("passed") or {}).values())]
                en = " ".join(x for x in [reviews[0].get("summary_en", "") if reviews else "",
                                          f"I have {ideas} suggestion{'s' if ideas != 1 else ''} from my review." if ideas else "",
                                          f"And overnight I learned something new: it's waiting in the trial area for your approval." if ok else ""] if x)
                zh = " ".join(x for x in [reviews[0].get("summary_zh", "") if reviews else "",
                                          f"复盘后我有 {ideas} 条建议。" if ideas else "",
                                          f"另外我昨晚学会了：{'、'.join(ok)}，在试用区等你批准。" if ok else ""] if x)
                if en and self.speak_alone(en, zh):
                    for r in reviews:
                        review.mark_reported(r["day"])
                    review.mark_night_reported()
                    flags["reported"] = today
                    flag.write_text(json.dumps(flags))
                    self.broadcast({"type": "brain", "kind": "report", "ideas": ideas, "learned": ok})
        except Exception as e:
            log(f"night: {type(e).__name__}: {e}")
        finally:
            self._night_busy = False

    def start_enroll(self):
        """Voiceprint enrolment: once Jarvis has finished asking, show the lines and record each one read."""
        from . import voiceprint
        time.sleep(0.5)
        for _ in range(200):
            if not self.player.busy() and self.engine.state != "thinking":
                break
            time.sleep(0.1)
        time.sleep(0.4)
        r = voiceprint.VP.start_enroll()
        self.engine.voice = voiceprint.VP
        self.broadcast({"type": "enroll", "start": True, **r, "got": 0, "need": len(voiceprint.LINES)})
        log("voiceprint enrolment started")
        t0, got = time.time(), 0
        while voiceprint.VP.enrolling:              # give up after a minute and a half of nothing new
            time.sleep(0.5)
            if len(voiceprint.VP.enrolled) != got:
                got, t0 = len(voiceprint.VP.enrolled), time.time()
            if time.time() - t0 > 90:
                voiceprint.VP.cancel()
                self.broadcast({"type": "enroll", "ok": False, "error": "timeout"})
                self.say(f"I didn't catch enough, {N()}. We can try again whenever you like.", zh="我没听清几句，随时可以再录一次。")
                return
        if voiceprint.VP.profile and voiceprint.VP.profile.get("created", "") >= time.strftime("%Y-%m-%d"):
            self.say(f"Thank you, {N()}. I know your voice now, and I'll ignore anyone else.", zh="谢谢。我记住你的声音了，别的声音我都会忽略。")

    def narrate(self, en, zh=""):
        """A line the hologram demo speaks at its own moment: after whatever Jarvis is saying now."""
        for _ in range(80):
            if not self.player.busy():
                break
            time.sleep(0.1)
        log(f"narrates: {en}")
        self.say(en, zh=zh)

    def say(self, text, gen=None, interruptible=True, zh=""):
        gen = self.gen if gen is None else gen
        def work():
            if gen != self.gen: return
            if interruptible: self.engine.set_speaking(True)
            self.broadcast({"type": "state", "state": "speaking"}); self.broadcast({"type": "jarvis", "text": text, "zh": zh})
            if text != ack_line():
                memory.log_turn("jarvis", text, zh)
            for chunk in self.speaker.synth(text):
                if gen != self.gen: return
                self.player.push(chunk)
            while self.player.busy() and gen == self.gen:
                time.sleep(0.05)
            if gen == self.gen:
                # finished on its own: keep listening for the reply, no wake word needed
                self.engine.set_speaking(False, said=text)
                self.broadcast({"type": "state", "state": "listening" if self.engine.state == "awake" and not self.muted else "idle"})
        threading.Thread(target=work, daemon=True).start()

    # -- audio loop ----------------------------------------------------
    def duplex_cb(self, indata, outdata, frames, t, status):
        """Speaker out and mic in share one callback, so the echo canceller always sees
        the reference and the microphone at a fixed offset."""
        out = self.player.take(frames)
        outdata[:, 0] = out
        self.aec.playback(self.dec_ref(out))
        mic = indata[:, 0].astype(np.float32)
        clean = self.aec.capture(self.dec_mic(mic))
        st = self.stats
        st["raw"] = max(st["raw"], float(np.abs(mic).max()))
        st["clean"] = max(st["clean"], float(np.abs(clean).max()) if len(clean) else 0.0)
        if status: st["status"] = str(status)
        self.mic_q.put(clean)

    def audio_loop(self):
        try:
            i, o = sd.default.device
            log(f"input: {sd.query_devices(i)['name']} | output: {sd.query_devices(o)['name']}")
        except Exception as e:
            log(f"device query failed: {e}")
        warned = False
        while True:                                   # no microphone yet, or it was unplugged: keep trying
            try:
                self.audio_run()
            except Exception as e:
                if not warned:
                    log(f"audio device unavailable: {type(e).__name__}: {e}")
                    self.mic_msg = {"type": "mic", "ok": False,
                                    "text": "没有找到可用的麦克风或扬声器。接上设备后会自动重试；也可以先用文字输入。"}
                    self.broadcast(self.mic_msg)
                    warned = True
                time.sleep(5)
                try:
                    sd._terminate(); sd._initialize()        # re-scan devices (a newly plugged-in microphone)
                except Exception:
                    pass

    def audio_run(self):
        last = time.time()
        with sd.Stream(samplerate=DEV_SR, blocksize=HOP, channels=(1, 1), dtype="float32", callback=self.duplex_cb):
            if self.mic_msg:
                log("audio device ready")
                self.mic_msg = None
                self.broadcast({"type": "mic", "ok": True})
            while True:
                x = self.mic_q.get()
                if self.mute_reset:                   # paused or resumed: forget what was half heard
                    self.mute_reset = False
                    self.engine._reset()
                    self.clip_at = None
                if self.muted:                        # paused: the microphone stays open (echo canceller keeps its timing) but nothing is heard
                    if time.time() - self.level_at >= 0.5:
                        self.broadcast({"type": "level", "mic": 0, "wake": 0})
                        self.level_at = time.time()
                    continue
                self.recent = np.concatenate([self.recent[len(x):], x])
                self.engine.feed(x)
                w = getattr(self.engine.wake, "score", 0.0)
                self.stats["wake"] = max(self.stats["wake"], w)
                if w >= 0.1:
                    self.mark_attempt(w)
                if self.clip_at and time.time() >= self.clip_at:
                    self.save_clip()
                # live meter for the HUD, ~8 times a second
                self.level_peak = max(self.level_peak, float(np.abs(x).max()) if len(x) else 0.0)
                if time.time() - self.level_at >= 0.12:
                    self.broadcast({"type": "level", "mic": round(self.level_peak, 3), "wake": round(w, 2)})
                    self.level_at, self.level_peak = time.time(), 0.0
                if time.time() - last >= 10:
                    # one line every 10 s: peak mic level before/after echo cancel and best wake score
                    st = self.stats
                    log(f"mic peak {st['raw']:.3f} -> {st['clean']:.3f} | wake best {st['wake']:.2f} | {st['status'] or 'ok'}")
                    if st["raw"] < 1e-4:
                        log("microphone is silent: check the microphone permission for Jarvis "
                            + ("(System Settings > Privacy & Security > Microphone)" if paths.IS_MAC else "(Settings > Privacy > Microphone)")
                            + " and the input device")
                    self.stats = {"raw": 0.0, "clean": 0.0, "wake": 0.0, "status": ""}
                    last = time.time()

    def set_listening(self, on: bool):
        """The HUD's 暂停聆听 button (or the M key): stop or resume hearing anything, wake word included.
        Typed input keeps working while paused."""
        if self.muted == (not on):
            return self.broadcast({"type": "listen", "on": on})
        self.muted = not on
        self.mute_reset = True
        log("listening resumed" if on else "listening paused")
        self.broadcast({"type": "listen", "on": on})
        if not on and self.engine.state == "awake":
            self.broadcast({"type": "state", "state": "idle"})

    async def ws_main(self, host="127.0.0.1", port=int(os.environ.get("JARVIS_VOICE_PORT", 8765))):
        import websockets
        self.loop = asyncio.get_running_loop()
        async def handler(ws):
            self.clients.add(ws)
            self.seen = time.time()
            try:
                await ws.send(json.dumps(self.schedule_msg(), ensure_ascii=False))
                await ws.send(json.dumps({"type": "history", "items": memory.recent_turns(80)}, ensure_ascii=False))
                from . import onboard
                await ws.send(json.dumps(onboard.status(), ensure_ascii=False))   # no model yet: the window opens 「接入大脑」
                from . import agents
                await ws.send(json.dumps(agents.snapshot(), ensure_ascii=False))
                if self.mic_msg:
                    await ws.send(json.dumps(self.mic_msg, ensure_ascii=False))
                await ws.send(json.dumps({"type": "listen", "on": not self.muted}))
            except Exception:
                pass
            threading.Thread(target=self.push_world, daemon=True).start()
            if not self.greeted:
                self.greeted = True
                threading.Timer(4.0, self.morning_question).start()
            try:
                async for m in ws:
                    msg = json.loads(m)
                    if msg.get("type") == "text":          # typed input from the HUD
                        self.gen += 1; self.player.stop(); self.handle(msg["text"], spoken=False)
                    elif msg.get("type", "").startswith("llm_"):    # 「接入大脑」: connect a language model
                        threading.Thread(target=self.llm_msg, args=(msg,), daemon=True).start()
                    elif msg.get("type", "").startswith("brain_"):  # the brain window
                        threading.Thread(target=self.brain_msg, args=(msg,), daemon=True).start()
                    elif msg.get("type") == "camera":        # the HUD wants the camera (a demo is on screen)
                        from . import gesture
                        gesture.TRACKER.set(bool(msg.get("on")))
                    elif msg.get("type") == "listen":        # 暂停聆听 / 恢复聆听
                        self.set_listening(bool(msg.get("on")))
                    elif msg.get("type") == "interrupt":
                        self.on_event("stop", {})
            finally:
                self.clients.discard(ws)
                if not self.clients:                   # no window, no camera
                    from . import gesture
                    gesture.TRACKER.set(False)
        tick = 0
        async with websockets.serve(handler, host, port):
            while True:
                await asyncio.sleep(2)
                if self.clients:
                    self.seen = time.time()
                    tick += 1
                    try:                                # the Agent panel: send only when something changed
                        from . import agents
                        snap = agents.snapshot()
                        if snap != getattr(self, "_agents", None):
                            self._agents = snap
                            self.broadcast(snap)
                    except Exception as e:
                        log(f"agents: {e}")
                    if tick % 15 == 0:                  # every ~30 s
                        self.remind()
                    if tick % 30 == 5:                  # every ~60 s: nightly review, night learning, morning report
                        threading.Thread(target=self.night, daemon=True).start()
                    if tick % 600 == 0:                 # every ~20 min
                        threading.Thread(target=self.push_world, daemon=True).start()
                    try:
                        st = sysmon.sample()
                        if st:
                            self.broadcast({"type": "sys", **st})
                    except Exception as e:
                        log(f"sysmon: {e}")
                elif os.environ.get("JARVIS_STAY_ON") != "1" and time.time() - self.seen > 20:
                    # the Jarvis window is gone (closed or crashed): stop listening until it opens again
                    log("no Jarvis window connected, stopping")
                    os._exit(0)


def main():
    s = Service()
    threading.Thread(target=s.audio_loop, daemon=True).start()
    print("Jarvis voice: standing by. Say \"Hey Jarvis\"." if models.LANG == "en" else "Jarvis voice: standing by. Say 「嗨，贾维斯」.", flush=True)
    asyncio.run(s.ws_main())


if __name__ == "__main__":
    main()
