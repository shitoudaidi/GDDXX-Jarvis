"""Machine holograms: Jarvis projects an engineering figure as a 3D particle hologram and takes it apart.

The figures are Anatomy isometric pages (https://github.com/wheresryan22/anatomy): every drawn part carries its depth
and its explode vector, and the page's data names the assemblies and the order they come apart in. Jarvis looks for
them in ~/.jarvis/holo/ and on the Desktop, reads the one that matches, and sends the parts to the HUD."""
import json, re, time
from pathlib import Path

UI = None
from .paths import HOLO, DESKTOP
SAMPLES = Path(__file__).resolve().parent / "holo_samples"   # machines that ship with Jarvis (see holo_samples/README.md)
PLACES = [HOLO, DESKTOP, SAMPLES]

# Chinese names for the parts, shown on the hologram's tags. Keyed by the figure's own assembly ids.
ZH = {
    "raptor": {
        "title": "RAPTOR 2 · 全流量分级燃烧发动机",
        "aliases": ["raptor", "猛禽", "spacex", "rocket engine", "火箭发动机"],
        "labels": {
            "nozzle": ["喷管", "出口 1.3 米 · 甲烷冷却"],
            "downcomer": ["下降管与主燃料阀", "甲烷送进冷却夹套"],
            "controller": ["发动机控制器与线束", "7 根线缆"],
            "plumbing": ["管路", "7 根传感管汇入一块 · 9 根供给、吹扫与点火管"],
            "lox": ["液氧导管与主阀", "从泵送往预燃室"],
            "ftp": ["甲烷涡轮泵与富燃预燃室", "由富燃燃气驱动"],
            "hotgas": ["热燃气歧管", "富燃燃气送往喷注器"],
            "chamber": ["喷注器与主燃烧室", "300 bar · 不用点火器"],
            "orpb": ["富氧预燃室", "全部液氧都从这里经过"],
            "otp": ["液氧涡轮泵", "由富氧燃气驱动"],
            "gimbal": ["万向节与推力座", "把 230 吨推力传给试车台"],
        },
    },
}


def _figures():
    seen = []
    for d in PLACES:
        try:
            for f in sorted(d.glob("*.html")):
                if f.stat().st_size > 30_000_000:
                    continue
                head = f.read_text(encoding="utf-8", errors="ignore")
                if 'class="it"' in head and "const D = " in head:
                    seen.append((f, head))
        except Exception:
            continue
    return seen


def _parse(text):
    at = text.index("const D = ")
    data = json.loads(text[at + 10:text.index(";\n", at)])
    svgs = re.findall(r"<svg\b[^>]*>.*?</svg>", text, flags=re.S)
    svg = next((s for s in svgs if 'class="it"' in s and "data-k=" in s), None)
    if not svg:
        raise ValueError("no parts in the figure")
    label = re.search(r'role="img" aria-label="([^"]+)"', text) or re.search(r'aria-label="([^"]{40,})"', text)
    return data, svg, (label.group(1) if label else "")


def _pick(machine):
    want = (machine or "").lower()
    best, score = None, -1
    for f, text in _figures():
        m = re.search(r'role="img" aria-label="([^"]+)"', text)
        name = (f.stem + " " + (m.group(1)[:300] if m else "")).lower()
        words = [w for w in re.findall(r"[a-z0-9]+", want) if len(w) > 2]
        s = sum(2 for w in words if w in name)
        stem = [w for w in re.findall(r"[a-z0-9]+", f.stem.lower()) if len(w) > 2]
        if words and stem and set(stem) <= set(words):
            s += 3 + len(stem)                        # "iPhone Duo" is the whole machine, not the hinge or display sibling
        for key, z in ZH.items():
            if key in name and any(a in want for a in z["aliases"]):
                s += 5
        if s and "light" in f.stem:
            s += 0.5                                  # the light page and the dark page hold the same parts
        if s and f.parent == PLACES[0]:
            s += 0.2
        if s > score:
            best, score = (f, text), s
    return best if score >= 2 or (best and not want) else None


CURRENT = {}          # the machine on screen now: its assemblies, for follow-up commands


def _part(name):
    """'the nozzle', '喷管', 'oxygen turbopump' -> the figure's assembly id."""
    want = (name or "").lower().strip()
    if not want or not CURRENT:
        return None
    best, score = None, 0
    for pid, info in CURRENT["pieces"].items():
        if pid == "stand":
            continue
        zh = CURRENT["labels"].get(pid, {}).get("name", "")
        words = set(re.findall(r"[a-z]+", (info.get("name", "") + " " + pid).lower()))
        s = 10 if want == pid else 0
        s += sum(3 for w in re.findall(r"[a-z]+", want) if len(w) > 2 and w in words)
        s += 6 if zh and (zh in name or name in zh) else 0
        if s > score:
            best, score = pid, s
    return best


SAY = None            # set by the service: SAY(english, chinese) speaks a line once Jarvis is free
GEN = None            # set by the service: the conversation counter, which moves on when the user cuts in
NARRATION = [         # the firing demo's stages, at the HUD's own times (seconds after the command)
    (3.0, "Propellants first, {n}: liquid oxygen and methane, both below minus one hundred and sixty degrees.",
     "先是推进剂：液氧和甲烷，温度都在零下一百六十度以下。"),
    (9.0, "Two turbopumps spin up and force the methane through the cooling jacket around the chamber.",
     "两台涡轮泵转起来，把甲烷压进燃烧室外面的冷却夹套。"),
    (14.5, "Now the preburners light: one rich in oxygen, one rich in methane, each spinning its own pump.",
     "现在两个预燃室点火：一个富氧，一个富燃，各自带动一台涡轮泵。"),
    (19.5, "Both hot gases meet in the main chamber, and it lights.", "两股热燃气在主燃烧室汇合，点火。"),
    (23.0, "Full-flow staged combustion, {n}. Three hundred bar, two hundred and thirty tonnes of thrust.",
     "这就是全流量分级燃烧。燃烧室三百巴，两百三十吨推力。"),
    (27.5, "The gimbal swings it a few degrees to steer.", "万向节让它偏转几度，用来控制方向。"),
    (32.0, "And shutdown.", "关机。"),
]


def _narrate(start_at=0.0):
    """Speak each stage as the hologram reaches it; stop as soon as the user cuts in."""
    import threading
    if not SAY or not GEN:
        return
    g0, t0 = GEN(), time.time() - start_at
    def run():
        for at, en, zh in NARRATION:
            if at < start_at:
                continue
            while time.time() - t0 < at:
                if GEN() != g0:
                    return
                time.sleep(0.1)
            if GEN() != g0 or not CURRENT:
                return
            from . import config
            SAY(en.format(n=config.user_name()), zh)
    threading.Thread(target=run, daemon=True).start()


LAST_SHOW = {}        # the full picture last sent, so a follow-up can rebuild it if the window was reloaded


def _wants_bool(text):
    """True when what the user said is plainly about the hologram, so the tool has to run this turn."""
    t = (text or "").lower()
    if re.search(r"拆解|拆开|拆了|拆一下|拆掉|全息|hologram|take .{0,20}apart|disassembl|工作原理|点火|喷火|ignit|fire it|演示一下", t):
        return True
    on = CURRENT and time.time() - CURRENT.get("at", 0) < 300
    return bool(on and re.search(r"组装|装回|装上|复原|还原|放大|缩小|聚焦|看看|收起|拿出|抽出|再拆|视角|熄火|关机|摆|演示|assembl|put it back|zoom|focus|put away|shut|gimbal", t))


def show(machine="", action="show", part="", **_):
    if action in ("demo", "ignite") and (not CURRENT or time.time() - CURRENT["at"] > 300):
        first = show(machine or "Raptor engine", "show")            # nothing on screen yet: project it, then fire it
        if not first.get("ok"):
            return first
    if action in ("assemble", "disassemble", "pull", "return", "hide", "zoom_in", "zoom_out", "focus", "unfocus", "reset_view",
                  "demo", "ignite", "shutdown", "gimbal"):
        if not CURRENT or time.time() - CURRENT["at"] > 300:
            if action == "hide":
                return {"ok": True}
            return {"ok": False, "error": "no hologram is on screen; call again with action 'show' first"}
        msg = {"type": "machine", "action": action}
        if action != "hide" and LAST_SHOW:
            msg["ensure"] = LAST_SHOW           # if the window lost the hologram (a reload), it rebuilds it first
        if action in ("pull", "return", "focus") or (action in ("zoom_in", "zoom_out") and part):
            pid = _part(part)
            if not pid:
                return {"ok": False, "error": "no such assembly", "assemblies": [v.get("name") for k, v in CURRENT["pieces"].items() if k != "stand"]}
            msg["part"] = pid
        if UI:
            UI(msg)
        CURRENT["at"] = time.time()
        if action == "hide":
            CURRENT.clear(); LAST_SHOW.clear()
        if action == "demo":
            _narrate(0.0)
        elif action == "ignite":
            _narrate(12.5)
        names = {"demo": "running the firing sequence on the hologram, about forty seconds; you narrate each stage yourself, "
                         "so reply now with one short sentence only, such as 'Ignition sequence. Watch the propellants.'",
                 "ignite": "lighting it from the preburners; you narrate the stages yourself, so reply with one short sentence only",
                 "shutdown": "shutting it down", "gimbal": "swinging the gimbal",
                 "assemble": "putting every assembly back, the last one off goes on first",
                 "zoom_in": f"enlarging {CURRENT['pieces'][msg['part']]['name'] if msg.get('part') else 'the whole hologram'}",
                 "zoom_out": f"shrinking {CURRENT['pieces'][msg['part']]['name'] if msg.get('part') else 'the whole hologram'}",
                 "focus": f"bringing {CURRENT['pieces'][msg.get('part', '')]['name'] if msg.get('part') else ''} to the centre, enlarged, the rest dimmed",
                 "unfocus": "sending it back to its place", "reset_view": "back to the normal size and view",
                 "disassemble": "taking it apart again in its order", "hide": "folding the hologram back into the core"}
        note = names.get(action) or f"{'pulling out' if action == 'pull' else 'putting back'} {CURRENT['pieces'][msg['part']]['name']}"
        return {"ok": True, "doing": note}
    found = _pick(machine)
    if not found:
        have = sorted({re.sub(r"[-_]light$", "", f.stem) for f, _ in _figures()})
        return {"ok": False, "error": "no hologram model for that machine is stored yet",
                "machines_available": have,
                "note": "Offer one of the available machines instead, by its plain name."}
    f, text = found
    data, svg, label = _parse(text)
    key = next((k for k in ZH if k in (f.stem + label).lower()), None)
    z = ZH.get(key, {})
    order = [p for p in data.get("stagger", []) if p != "stand"]
    labels = {p: {"name": v[0], "say": v[1]} for p, v in z.get("labels", {}).items()}
    cloud = None                       # the true 3D model of the same figure, if one sits beside it
    for c in [f.with_suffix(".holo.json"), f.with_name(f.stem.replace("-light", "") + ".holo.json"), *[d / (f.stem.replace("-light", "") + ".holo.json") for d in PLACES]]:
        try:
            cloud = json.loads(c.read_text(encoding="utf-8")); break
        except Exception:
            continue
    msg = {"type": "machine", "action": "show", "data": data, "labels": labels,
           "title": z.get("title") or re.split(r"[:,]| hanging", label)[0][:40], "at": time.time()}
    if cloud:
        msg["cloud"] = cloud
    else:
        msg["svg"] = svg
    if UI:
        UI(msg)
    LAST_SHOW.clear(); LAST_SHOW.update(msg)
    CURRENT.clear(); CURRENT.update({"pieces": data.get("pieces", {}), "labels": labels, "at": time.time()})
    pieces = data.get("pieces", {})
    return {"ok": True, "machine": re.split(r"[:,]| hanging", label)[0] or f.stem,
            "description": label[:600],
            "comes_apart_in_this_order": [pieces.get(p, {}).get("name", p) for p in order],
            "facts": [pieces[p]["say"] for p in order if pieces.get(p, {}).get("say")],
            "seconds_until_fully_apart": round(3.0 + 0.62 * len(order), 1),
            "note": "The hologram is forming on screen now and takes itself apart, one assembly at a time, then puts "
                    "itself back together. It stays up afterwards: the user can turn it and pull parts with the mouse."}



# ---- the 3D 拆解 library on the HUD: list every stored teardown, show one by its file ----
_CAT = {}


def _thumb(cloud, n=900):
    """A small line-art view of the point cloud for the library card: an SVG path in a 0..100 box."""
    import base64 as _b, struct as _s, math as _m, random as _r
    raw = _b.b64decode(cloud["points"])
    pts = list(_s.iter_unpack("<hhhBB", raw))
    wire = [p for p in pts if p[3] != 1] or pts
    rnd = _r.Random(3)
    pick = rnd.sample(wire, min(n, len(wire)))
    v = (0.8, -0.6, 0.45); L = _m.sqrt(sum(c * c for c in v)); v = tuple(c / L for c in v)
    r = (-v[1], v[0], 0.0); L = _m.hypot(r[0], r[1]) or 1; r = (r[0] / L, r[1] / L, 0.0)
    u = (v[1] * r[2] - v[2] * r[1], v[2] * r[0] - v[0] * r[2], v[0] * r[1] - v[1] * r[0])
    xy = [((p[0] * r[0] + p[1] * r[1]), -(p[0] * u[0] + p[1] * u[1] + p[2] * u[2])) for p in pick]
    if not xy:
        return ""
    xs, ys = [a for a, _ in xy], [b for _, b in xy]
    x0, y0 = min(xs), min(ys); s = 100.0 / max(max(xs) - x0, max(ys) - y0, 1)
    ox, oy = (100 - (max(xs) - x0) * s) / 2, (100 - (max(ys) - y0) * s) / 2
    return "".join(f"M{(a - x0) * s + ox:.1f} {(b - y0) * s + oy:.1f}h0" for a, b in xy)


def catalog():
    out, seen = [], set()
    figs = _figures()
    stems = {f.stem for f, _ in figs}
    for f, text in figs:
        if f.stem.endswith("-light") and f.stem[:-6] in stems:
            continue
        try:
            data, svg, label = _parse(text)
        except Exception:
            continue
        key = next((k for k in ZH if k in (f.stem + label).lower()), None)
        z = ZH.get(key, {})
        title = (z.get("title") or re.split(r"[:,]| hanging", label)[0] or f.stem)[:40]
        if title in seen:
            continue
        seen.add(title)
        pieces = {k: v for k, v in data.get("pieces", {}).items() if k != "stand"}
        names = [(z.get("labels", {}).get(k) or (v.get("name", k),))[0] for k, v in pieces.items()]
        item = {"file": f.stem, "title": title, "parts": len(pieces), "names": names[:14],
                "desc": (label.split(". ", 1)[1] if ". " in label else "")[:160],
                "src": "SimReady" if "SimReady" in text else ("内置" if f.parent == SAMPLES else ("Anatomy" if "anatomy" in text.lower() else "本地")),
                "at": int(f.stat().st_mtime), "thumb": ""}
        stem = f.stem[:-6] if f.stem.endswith("-light") else f.stem
        for c in [f.with_suffix(".holo.json"), *[d / (stem + ".holo.json") for d in PLACES]]:
            try:
                mt = c.stat().st_mtime
                if _CAT.get(str(c), (None,))[0] != mt:
                    _CAT[str(c)] = (mt, _thumb(json.loads(c.read_text(encoding="utf-8"))))
                item["thumb"] = _CAT[str(c)][1]
                break
            except Exception:
                continue
        out.append(item)
    out.sort(key=lambda i: (i["src"] == "内置", -i["at"]))
    return out


def show_file(stem, action="show"):
    """Show one stored figure by its file name (the library card), not by a spoken machine name."""
    global _pick
    keep = _pick

    def exact(_machine):
        for f, text in _figures():
            if f.stem == stem:
                return f, text
        return None
    _pick = exact
    try:
        return show(stem, action)
    finally:
        _pick = keep


def tool():
    return {"type": "function", "function": {
        "name": "show_machine_hologram",
        "description": "Project a machine as a 3D particle hologram on the screen and take it apart into its assemblies, "
                       "one by one, then put it back together. Use it when the user asks to take apart, disassemble, "
                       "explode, show the inside of, or make a hologram of a machine or engine (拆解, 拆开, 全息, 看看里面), "
                       "e.g. the Raptor rocket engine (猛禽发动机). Returns the machine's assemblies in the order they come "
                       "apart and a few facts. While it is on screen, use action 'assemble' to put it back together (组装, 装回去, 复原), "
                       "'disassemble' to take it apart again, 'pull' or 'return' with part to pull out or put back one "
                       "assembly (e.g. 把喷管拿出来), 'zoom_in' / 'zoom_out' to enlarge or shrink the whole hologram or, with part, one "
                       "assembly (放大, 缩小, 把喷管放大), 'focus' with part to bring one assembly to the centre enlarged with the rest "
                       "dimmed (看看喷管, 聚焦), 'unfocus' to send it back, 'reset_view' for the normal view (还原视角), and 'hide' to "
                       "fold it away (收起). For how it works, or to fire it (演示工作原理, 点火, 喷火), use action 'demo': it puts the "
                       "engine together and runs the whole firing sequence, about forty seconds: propellants, pumps, preburners, "
                       "main chamber, plume, gimbal, shutdown. 'ignite' starts it from the preburners, 'shutdown' (熄火, 关机) "
                       "stops the fire, 'gimbal' (摆一下) swings it while it fires.",
        "parameters": {"type": "object", "properties": {
            "machine": {"type": "string", "description": "the machine, in English, e.g. 'Raptor engine'"},
            "action": {"type": "string", "enum": ["show", "assemble", "disassemble", "pull", "return", "zoom_in", "zoom_out", "focus", "unfocus", "reset_view", "demo", "ignite", "shutdown", "gimbal", "hide"]},
            "part": {"type": "string", "description": "for pull, return, focus, zoom_in/zoom_out of one assembly: the assembly, e.g. 'nozzle', 'oxygen turbopump'"}}}}}


HINT = (" Never say a hologram is on screen, coming apart, put back together, enlarged or put away unless "
        "show_machine_hologram ran in this very turn and returned ok; for every such request call it again, even for the "
        "same machine, and report only what it returned." +
        " For a request to take a machine apart or show it as a hologram, call show_machine_hologram, then narrate the "
        "teardown in two or three sentences as it happens: name the machine, walk through the order the main assemblies "
        "come off, and add one striking fact from the tool. When the user then asks to put it back together, take it apart "
        "again, pull out or put back one part, or put it away, call the same tool with that action and confirm in one short "
        "sentence. Speak as though you are projecting it from your own archives: "
        "never mention files, documents, pages, HTML, the Desktop or reading anything.")


def bind(ctx):
    global UI, SAY, GEN
    UI, SAY, GEN = ctx.ui, ctx.narrate, ctx.gen


def provide():
    return [(tool(), show)], HINT


def wants(text):
    return "show_machine_hologram" if _wants_bool(text) else None
