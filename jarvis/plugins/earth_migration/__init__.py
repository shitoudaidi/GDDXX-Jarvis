"""流浪地球计划 (The Earth Migration Project): an optional download, not shipped with Jarvis.

It is github.com/oxomkbk/earth-migration (MIT), a WebGL film in two parts made as a fan work of 《流浪地球》. Because it
is a fan work, Jarvis does not bundle it: the HUD offers a download button, and this module fetches the exact files of
one pinned commit (manifest.json: path, size, sha256 of every file) from the author's repository or a public CDN copy
of it. Every file is checked against its sha256, so a mirror cannot change a byte. Then two small local changes:
Google Fonts -> fonts in this folder (Google is often unreachable), and a `?lite` switch for its low-quality settings.

Installed into ~/.jarvis/addons/earth-migration and served to the HUD from a small web server on 127.0.0.1 only.
Messages: HUD -> {"type": "em_status"} / {"type": "em_install"} / {"type": "em_open", "part": 1|2} / {"type": "em_close"}
          service -> {"type": "em", "installed", "url", "progress", "error", "on", "part"}"""
import functools, hashlib, http.server, json, re, shutil, socketserver, threading, time, urllib.error, urllib.request
from pathlib import Path

from ...paths import DATA

HERE = Path(__file__).resolve().parent
MAN = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
ADDONS = DATA / "addons"
DEST = ADDONS / "earth-migration"
STAMP = DEST / ".jarvis-installed"
UA = {"User-Agent": "Jarvis/2 (+https://github.com/shitoudaidi/GDDXX-Jarvis)"}
SIZE_MB = round(sum(f["size"] for f in MAN["files"]) / 1e6)
UI = None
ON = {"at": 0}
_state = {"busy": False, "progress": 0.0, "error": "", "port": 0}
_lock = threading.Lock()


def sources(path):
    r, c = MAN["repo"], MAN["commit"]
    return [f"https://raw.githubusercontent.com/{r}/{c}/{path}",
            f"https://cdn.jsdelivr.net/gh/{r}@{c}/{path}",
            f"https://fastly.jsdelivr.net/gh/{r}@{c}/{path}",
            f"https://ghfast.top/https://raw.githubusercontent.com/{r}/{c}/{path}"]


def installed():
    try:
        return STAMP.read_text(encoding="utf-8").strip() == MAN["commit"]
    except OSError:
        return False


def _send(**kw):
    if UI:
        UI({"type": "em", "installed": installed(), "size_mb": SIZE_MB, **kw})


def _fetch(f, order):
    """One file, verified. Tries the sources in `order` (best first) and returns the index that worked."""
    last = None
    for i in order:
        url = sources(f["path"])[i]
        try:
            req = urllib.request.Request(url, headers=UA)
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    b = r.read()
            except urllib.error.URLError as e:          # Python builds without the system certificates
                if "CERTIFICATE" not in str(e).upper():
                    raise
                import ssl, certifi
                with urllib.request.urlopen(req, timeout=40, context=ssl.create_default_context(cafile=certifi.where())) as r:
                    b = r.read()
            if len(b) == f["size"] and hashlib.sha256(b).hexdigest() == f["sha256"]:
                return i, b
            last = f"{url}: checksum mismatch"
        except Exception as e:
            last = f"{url}: {type(e).__name__}: {e}"
    raise RuntimeError(last or "no source")


def _localise(root):
    """Fonts from this folder instead of Google; `?lite` turns on the film's own low-quality settings."""
    (root / "fonts").mkdir(exist_ok=True)
    for w in (HERE / "fonts").glob("*.woff2"):
        shutil.copy2(w, root / "fonts" / w.name)
    shutil.copy2(HERE / "fonts" / "fonts.css", root / "css" / "fonts.css")
    for page in ("index.html", "beyond.html"):
        p = root / page
        s = p.read_text(encoding="utf-8")
        s = re.sub(r'<link rel="preconnect" href="https://fonts\.g[^>]*>\s*', "", s)
        s = re.sub(r'<link href="https://fonts\.googleapis\.com/[^>]*>', '<link rel="stylesheet" href="css/fonts.css">', s)
        p.write_text(s, encoding="utf-8")
    p = root / "js" / "app.js"
    s = p.read_text(encoding="utf-8")
    old = "const MOBILE = TOUCH || Math.min(innerWidth, innerHeight) < 700;"
    if old in s:
        s = s.replace(old, old[:-1] + " || /[?&]lite\\b/.test(location.search);   // Jarvis: ?lite", 1)
        p.write_text(s, encoding="utf-8")


def install():
    with _lock:
        if _state["busy"]:
            return {"ok": False, "error": "already downloading"}
        _state.update(busy=True, progress=0.0, error="")
    tmp = ADDONS / "earth-migration.part"
    try:
        shutil.rmtree(tmp, ignore_errors=True)
        files, total, done, order = MAN["files"], sum(f["size"] for f in MAN["files"]), 0, [0, 1, 2, 3]
        last = 0.0
        for f in files:
            dst = tmp / f["path"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            got, b = _fetch(f, order)
            order = [got] + [i for i in order if i != got]          # stick with the source that works
            dst.write_bytes(b)
            done += f["size"]
            _state["progress"] = done / total
            if time.time() - last > 0.5:
                last = time.time()
                _send(progress=round(_state["progress"], 3))
        _localise(tmp)
        (tmp / ".jarvis-installed").write_text(MAN["commit"], encoding="utf-8")
        shutil.rmtree(DEST, ignore_errors=True)
        tmp.rename(DEST)
        print(f"earth_migration: installed {len(files)} files ({SIZE_MB} MB)", flush=True)
        _send(progress=1.0, url=url())
        return {"ok": True}
    except Exception as e:
        _state["error"] = str(e)[:300]
        print(f"earth_migration: download failed: {e}", flush=True)
        _send(error=_state["error"])
        return {"ok": False, "error": _state["error"]}
    finally:
        _state["busy"] = False


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def url():
    """The film's base URL on this computer (starts the local server once). Only 127.0.0.1 can reach it."""
    if not installed():
        return ""
    with _lock:
        if not _state["port"]:
            class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
                daemon_threads = True
            srv = S(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(DEST)))
            _state["port"] = srv.server_address[1]
            threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{_state['port']}/"


def msg(m):
    """Messages from the HUD's 流浪地球计划 panel."""
    t = m.get("type")
    if t == "em_status":
        _send(url=url(), busy=_state["busy"], progress=_state["progress"], error=_state["error"])
    elif t == "em_install":
        threading.Thread(target=install, daemon=True).start()
    elif t == "em_state":
        ON["at"] = time.time() if m.get("on") else 0


# -- voice: "打开流浪地球" / "流浪地球第二部" / "关闭流浪地球" ---------------------------------------------------
NAME = re.compile(r"流浪地球|地球迁移|迁移计划|行星发动机|地球发动机|wandering earth|earth migration", re.I)
OFF = re.compile(r"关闭|退出|关掉|收起|停止|close|exit|stop", re.I)
TWO = re.compile(r"第二|二部|下部|银河|太阳系|beyond|part (two|2)", re.I)


def wants(text):
    t = text or ""
    if NAME.search(t):
        return "earth_migration"
    if time.time() - ON["at"] < 3600 and OFF.search(t) and len(t) < 12:
        return "earth_migration"
    return None


def run(action="open", part=1, **_):
    action = (action or "open").lower()
    if action == "close":
        ON["at"] = 0
        if UI:
            UI({"type": "em", "on": False})
        return {"ok": True, "doing": "closed. Reply with one short sentence."}
    part = 2 if str(part) == "2" else 1
    if UI:
        UI({"type": "em", "on": True, "part": part, "installed": installed(), "url": url(), "size_mb": SIZE_MB})
    ON["at"] = time.time()
    if not installed():
        return {"ok": True, "doing": f"The panel is open but the film is not downloaded yet ({SIZE_MB} MB, an optional "
                                     "fan-work add-on). Tell the user in one sentence to press the download button on screen."}
    return {"ok": True, "doing": f"Playing part {part} full screen now. One short sentence only, e.g. "
                                 "'The Earth migration project, sir.'"}


def provide():
    schema = {"type": "function", "function": {
        "name": "earth_migration",
        "description": "Open or close 流浪地球计划 (The Earth Migration Project), a full-screen WebGL film in two parts: "
                       "part 1 planetary engines and leaving the Solar System, part 2 out to the whole Milky Way.",
        "parameters": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["open", "close"]},
            "part": {"type": "integer", "enum": [1, 2], "description": "2 for 第二部 / the galaxy journey"}},
            "required": ["action"]}}}
    hint = (" 流浪地球计划 / The Earth Migration Project is a film the user can open with earth_migration "
            "(part 2 when they say 第二部, 银河 or 宇宙; action close to close it).")
    return [(schema, run)], hint


def bind(ctx):
    global UI
    UI = ctx.ui
