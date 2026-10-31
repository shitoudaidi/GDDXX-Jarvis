"""地球此刻 (Earth, right now): a globe with six live cards about the world around the user.

Every card answers a question somebody actually asks, for where they are:
  1 flights   "Where is that flight now?" / "What is flying over me?"   OpenSky states + adsbdb routes (+ OpenSky track)
  2 stations  "What is up there over my head? Can I see one tonight?"   CelesTrak: every active satellite + naked-eye passes
              (the key is still "stations" for the HUD/voice plumbing; the card is "头顶的卫星")
  3 quakes    "Was that an earthquake?"                                 USGS (world; the CENC feed went dead Oct 2026), nearest first
  4 storms    "Will the typhoon reach me?"                              GDACS current tropical cyclones, distance from home
  5 news      "What is the world talking about right now?"              GDELT 2.0 15-minute event exports (last hour)
  6 launch    "When is the next launch, and where can I watch?"         Launch Library 2, China first
  (wind and aurora cards were dropped: f_wind/f_aurora are kept, unused.)

The show lives in the HUD (hud/demos/earthwatch.js); this module fetches on this computer and pushes {"type": "earth_data", "card": ...}.
Numbers are the feeds' own; a feed that fails says so. Coverage limits are stated on screen (e.g. ADS-B has no ground
stations over oceans and few in mainland China). Last good data is cached in ~/.jarvis/earth.
All feeds are public and need no key; set {"earth": {"home": {"lat": .., "lon": .., "name": ..}}} in config.json to fix "home"."""
import calendar, json, math, os, re, threading, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

UI = None
ON = {"at": 0}
CARDS = ["flights", "stations", "quakes", "storms", "news", "launch"]   # the wall reads row by row, left then right
NAMES = {"flights": "航班", "stations": "头顶的卫星", "quakes": "地震", "storms": "台风", "news": "全球新闻热点",
         "launch": "火箭发射"}
ALIASES = {
    "flights": ["航班", "飞机", "flight", "plane", "aircraft", "airplane"],
    "stations": ["卫星", "星链", "空间站", "天宫", "satellite", "starlink", "iss", "space station", "tiangong"],
    "quakes": ["地震", "earthquake", "quake", "seismic"],
    "storms": ["台风", "飓风", "气旋", "风暴", "typhoon", "hurricane", "cyclone"],
    "news": ["新闻", "热点", "news", "headline"],
    "launch": ["火箭", "发射", "rocket", "launch"],
}
ORDINALS = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8,
            "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8}
FRESH = {"flights": 120, "stations": 3 * 3600, "quakes": 180, "storms": 1800, "news": 900, "launch": 1800, "wind": 3 * 3600, "aurora": 900}
from ..paths import DATA
from .. import config
CACHE = DATA / "earth"
UA = "Jarvis/2 (+https://github.com/shitoudaidi/GDDXX-Jarvis)"
_lock = threading.Lock()
_busy = set()
_last = {}
RE_KM = 6371.0


def log(msg):
    print(f"earthwatch: {msg}", flush=True)


# ================================================================ voice
def _latest():
    try:
        from .demos import roadster, starship, optimus
        others = max(roadster.ON["at"], starship.ON["at"], optimus.ON["at"])
    except Exception:
        others = 0
    return ON["at"] > 0 and ON["at"] >= others


def _alias_hit(t, w):
    return re.search(r"\b" + re.escape(w) + r"s?\b", t) if w.isascii() else (w in t)


def card_of(text):
    t = (text or "").strip().lower()
    if t in CARDS:
        return t
    m = re.search(r"(?:第|number |no\.?\s*|card |#)\s*([1-8一二两三四五六七八])", t) or re.fullmatch(r"\s*([1-8])\s*", t)
    if m:
        v = m.group(1)
        n = int(v) if v.isdigit() else ORDINALS.get(v, 0)
        if 1 <= n <= len(CARDS):
            return CARDS[n - 1]
    for w, n in ORDINALS.items():
        if n <= len(CARDS) and w.isascii() and re.search(r"\b" + w + r"\b", t) and re.search(r"card|one\b", t):
            return CARDS[n - 1]
    for k, words in ALIASES.items():
        if any(_alias_hit(t, w) for w in words):
            return k
    return None


FLIGHT_NO = re.compile(r"(?<![a-z0-9])(?:([a-z0-9]{2})\s?(\d{1,4}[a-z]?)|([a-z]{3})\s?(\d{1,4}[a-z]?))(?![a-z0-9])", re.I)


def flight_in(text):
    """'MU5101', 'mu 5101', 'CES5101', '东航5101' -> 'MU5101' style text, or None."""
    t = (text or "")
    cn = {"东航": "MU", "国航": "CA", "南航": "CZ", "海航": "HU", "川航": "3U", "深航": "ZH", "厦航": "MF", "上航": "FM", "吉祥": "HO",
          "春秋": "9C", "山航": "SC", "联航": "KN", "首航": "JD", "国泰": "CX", "长龙": "GJ", "华夏": "G5", "祥鹏": "8L", "奥凯": "BK"}
    for k, v in cn.items():
        m = re.search(k + r"\s*(\d{2,4})", t)
        if m:
            return v + m.group(1)
    for m in FLIGHT_NO.finditer(t):
        a, b = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        if not any(c.isalpha() for c in a):
            continue
        if a.lower() in ("is", "on", "at", "to", "in", "of", "my", "me", "it", "hey", "the", "and", "for", "can", "see"):
            continue
        return (a + b).upper()
    return None


SHOW = re.compile(r"地球上.{0,6}(发生|在发生|怎么样|有什么)|地球此刻|此刻的地球|看看地球|世界上.{0,4}(发生|正在)|全球.{0,4}(正在|此刻|实时)"
                  r"|what'?s (going on|happening)\s+(on|around|across|in)\s+(the\s+)?(earth|world|planet|globe)"
                  r"|earth (right )?now|earth ?watch|show me the (earth|world|planet|globe)|state of the (world|planet)")
STEER = re.compile(r"打开|点开|放大|展开|看看|进去|关掉|关闭|收起|返回|退出|回到|open|zoom|enlarge|expand|show|close|back|exit|hide|dismiss")
FLIGHT_ASK = re.compile(r"航班|飞到哪|到哪了|飞机.*(哪|位置)|where('s| is) (flight|the flight|my flight)|track (flight|the flight)|flight .*(now|where)")


def _wants(text):
    t = (text or "").lower()
    if SHOW.search(t):
        return True
    if FLIGHT_ASK.search(t) and flight_in(text):
        return True
    if _latest() and STEER.search(t) and (card_of(t) or re.search(r"卡片|地球|card|earth|globe|wall|全部|all", t)):
        return True
    if _latest() and re.search(r"关掉|收起|退出|返回|close|hide|back|exit", t):
        return True
    return False


def run(action="show", card="", flight="", **_):
    action = (action or "show").lower()
    msg = {"type": "earth", "action": action}
    key = None
    if action == "flight":
        q = flight_in(flight) or (flight or "").strip().upper().replace(" ", "")
        if not q:
            return {"ok": False, "error": "no flight number"}
        msg = {"type": "earth", "action": "open", "card": "flights", "flight": q}
        key = "flights"
        fetch_flight(q)
    elif action == "open":
        key = card_of(str(card))
        if not key:
            return {"ok": False, "error": "unknown card", "cards": [f"{i + 1}. {k} ({NAMES[k]})" for i, k in enumerate(CARDS)]}
        msg["card"] = key
    if UI:
        UI(msg)
    if action in ("show", "open", "flight"):
        ON["at"] = time.time()
        fetch_async([key] if key else CARDS)
    elif action == "hide":
        ON["at"] = 0
    facts = summary(key)
    notes = {
        "show": "The Earth-now wall is on screen: six live cards (flights near the user and flight lookup, satellites above the user right now and the ones visible to the naked eye tonight, "
                "earthquakes nearest home, typhoons and their distance, news hot spots, next rocket launch). "
                "Reply with ONE short sentence; use at most one real figure from 'facts' if there is one. Never make up a number.",
        "open": f"Card '{key}' ({NAMES.get(key, '')}) is open full screen. One short sentence, at most one real figure from 'facts'.",
        "flight": "The flight card is open and looking the flight up. Say one short sentence; the screen shows what was found "
                  "(position if a receiver hears it, route from the route database). Do not invent its position.",
        "close": "Back to the card wall. Say nothing, or two words.", "hide": "Folded away. Say nothing, or two words."}
    return {"ok": True, "doing": notes.get(action, action), "facts": facts}


def tool():
    return {"type": "function", "function": {
        "name": "show_earth_now",
        "description": "Show what is happening on Earth right now as a globe with six live cards: 1 flights (planes near the user, look up a flight), "
                       "2 satellites over the user's head (Starlink, BeiDou, space stations...) and which are visible to the naked eye tonight, "
                       "3 earthquakes (nearest to the user first), 4 typhoons and their distance, 5 world news hot spots, 6 next rocket launch. "
                       "Use for 'what's happening on Earth' / 地球上正在发生什么, for opening a card (打开航班, 第三张, open the quake card), "
                       "and for tracking a flight by number (MU5101 飞到哪了, where is flight CA981). "
                       "action 'show' = the wall; 'open' needs card (name or 1-6); 'flight' needs flight (e.g. MU5101); 'close' back to the wall; 'hide'.",
        "parameters": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["show", "open", "flight", "close", "hide"]},
            "card": {"type": "string", "description": "for 'open': " + ", ".join(CARDS) + " or 1-8"},
            "flight": {"type": "string", "description": "for 'flight': the flight number as said, e.g. MU5101, 东航5101, CES5101"}}}}}


HINT = (" For 'what is happening on Earth right now', its cards, and 'where is flight XX123 now', call show_earth_now. "
        "Only quote figures returned in its 'facts'; never invent numbers or a flight's position. "
        "After it runs say one short sentence. Never claim it is on screen unless the tool ran this turn and returned ok.")


# ================================================================ fetch helpers
def _get(url, timeout=25, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.URLError as e:
        if "CERTIFICATE" not in str(e).upper():
            raise
        import ssl, certifi
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context(cafile=certifi.where())) as r:
            return r.read()


def _json(url, timeout=25, **kw):
    return json.loads(_get(url, timeout, **kw).decode("utf-8", "replace"))


def _save(name, data):
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False))
    except Exception as e:
        log(f"cache write {name}: {e}")


def _load(name):
    try:
        return json.loads((CACHE / f"{name}.json").read_text())
    except Exception:
        return None


def km(lat1, lon1, lat2, lon2):
    a, b, c, d = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((c - a) / 2) ** 2 + math.cos(a) * math.cos(c) * math.sin((d - b) / 2) ** 2
    return 2 * RE_KM * math.asin(min(1, math.sqrt(h)))


def bearing(lat1, lon1, lat2, lon2):
    a, b, c, d = map(math.radians, (lat1, lon1, lat2, lon2))
    y = math.sin(d - b) * math.cos(c)
    x = math.cos(a) * math.sin(c) - math.sin(a) * math.cos(c) * math.cos(d - b)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


DIR8 = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]


def dir8(deg):
    return DIR8[int(((deg % 360) + 22.5) // 45) % 8]


# ================================================================ home (where "you" are)
_home = {}


def home():
    """{lat, lon, name, src}. From the home address saved for AMap routes, else ~/.jarvis/config.json {"earth": {"home": ...}},
    else the AMap IP city; failing all of that Beijing, marked as a default so the HUD can say so."""
    if _home and time.time() - _home.get("_at", 0) < 3600:
        return _home
    out = None
    try:
        cfg = config.section("earth").get("home")
        if cfg and "lat" in cfg and "lon" in cfg:
            out = {"lat": float(cfg["lat"]), "lon": float(cfg["lon"]), "name": cfg.get("name", "家"), "src": "config"}
    except Exception:
        pass
    if not out:
        try:
            from . import amap
            h = amap.here()
            lon, lat = map(float, h["location"].split(","))
            out = {"lat": lat, "lon": lon, "name": h.get("city") or "家", "src": "amap-" + h.get("from", "")}
        except Exception as e:
            log(f"home from AMap failed: {type(e).__name__}: {str(e)[:80]}")
    if not out:
        out = {"lat": 39.9042, "lon": 116.4074, "name": "北京（默认）", "src": "default"}
    out["_at"] = time.time()
    _home.clear(); _home.update(out)
    return _home


# ================================================================ 1 flights
AIRLINES = {"MU": "CES", "CA": "CCA", "CZ": "CSN", "HU": "CHH", "3U": "CSC", "ZH": "CSZ", "MF": "CXA", "FM": "CSH", "HO": "DKH", "9C": "CQH",
            "SC": "CDG", "KN": "CUA", "JD": "CBJ", "GS": "GCR", "8L": "LKE", "G5": "HXA", "GJ": "CDC", "BK": "OKA", "PN": "CHB", "EU": "UEA",
            "TV": "TBA", "QW": "QDA", "NS": "HBH", "KY": "KNA", "DR": "RLH", "A6": "HYT", "Y8": "YZR", "CK": "CKK", "O3": "CSS",
            "CX": "CPA", "KA": "HDA", "UO": "HKE", "HX": "CRK", "NX": "AMU", "BR": "EVA", "CI": "CAL", "AE": "MDA", "IT": "TTW",
            "NH": "ANA", "JL": "JAL", "MM": "APJ", "KE": "KAL", "OZ": "AAR", "7C": "JJA", "LJ": "JNA", "SQ": "SIA", "TR": "TGW",
            "TG": "THA", "FD": "AIQ", "MH": "MAS", "AK": "AXM", "VN": "HVN", "VJ": "VJC", "PR": "PAL", "5J": "CEB", "GA": "GIA",
            "EK": "UAE", "QR": "QTR", "EY": "ETD", "TK": "THY", "LH": "DLH", "BA": "BAW", "AF": "AFR", "KL": "KLM", "LX": "SWR",
            "UA": "UAL", "AA": "AAL", "DL": "DAL", "AC": "ACA", "QF": "QFA", "NZ": "ANZ", "SU": "AFL", "AI": "AIC", "ET": "ETH"}


def to_icao(q):
    q = (q or "").upper().replace(" ", "")
    m = re.fullmatch(r"([A-Z0-9]{2})(\d{1,4}[A-Z]?)", q)
    if m and m.group(1) in AIRLINES:
        return AIRLINES[m.group(1)] + m.group(2)
    return q


def f_flights():
    d = _json("https://opensky-network.org/api/states/all", 40)
    t = d.get("time") or int(time.time())
    p, cs, co, ic = [], [], [], []
    for s in d.get("states") or []:
        lon, lat, ground = s[5], s[6], s[8]
        if lon is None or lat is None or ground:
            continue
        alt = s[13] if s[13] is not None else s[7]
        p += [round(lon, 3), round(lat, 3), round(s[10] or 0), round(s[9] or 0), round(alt or 0)]
        cs.append((s[1] or "").strip()); co.append(s[2] or ""); ic.append(s[0] or "")
    h = home()
    near = []
    for i in range(len(cs)):
        dk = km(h["lat"], h["lon"], p[i * 5 + 1], p[i * 5])
        if dk <= 300:
            near.append([round(dk), i])
    near.sort()
    return {"count": len(cs), "t": t * 1000, "p": p, "cs": cs, "co": co, "ic": ic, "near": near[:40], "near_n": len(near), "radius": 300,
            "src": "OpenSky Network", "note": "地面接收站收到的 ADS-B 信号。海洋上空和中国大陆接收站很少，那里的飞机大多看不到"}


_routes = {}


def route_of(callsign):
    """Origin and destination for a callsign from adsbdb (a community route database; can be out of date)."""
    cs = (callsign or "").strip().upper()
    if not cs:
        return None
    hit = _routes.get(cs)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    out = None
    try:
        r = _json(f"https://api.adsbdb.com/v0/callsign/{urllib.parse.quote(cs)}", 15).get("response") or {}
        fr = r.get("flightroute") if isinstance(r, dict) else None
        if fr:
            ap = lambda a: {"name": a.get("name", ""), "city": a.get("municipality", ""), "iata": a.get("iata_code", ""), "icao": a.get("icao_code", ""),
                            "lat": a.get("latitude"), "lon": a.get("longitude"), "country": a.get("country_name", "")} if a else None
            out = {"callsign": cs, "iata": fr.get("callsign_iata") or "", "airline": (fr.get("airline") or {}).get("name", ""),
                   "from": ap(fr.get("origin")), "to": ap(fr.get("destination"))}
    except urllib.error.HTTPError as e:
        if e.code != 404:
            log(f"route {cs}: HTTP {e.code}")
    except Exception as e:
        log(f"route {cs}: {type(e).__name__}: {str(e)[:100]}")
    _routes[cs] = (time.time(), out)
    return out


def _near_routes():
    d = _load("flights")
    if not d:
        return
    items = []
    for dk, i in (d.get("near") or [])[:8]:
        cs = d["cs"][i]
        r = route_of(cs) if cs else None
        items.append({"i": i, "km": dk, "cs": cs, "route": r})
    _push("near", {"items": items, "radius": d.get("radius", 300)}, "live")


def fetch_flight(q):
    """Look one flight up: where it is (if a receiver hears it), where it flies from and to, and the path so far."""
    def job():
        cs = to_icao(q)
        out = {"q": q, "callsign": cs, "found": False}
        d = _load("flights")
        if not d or time.time() - d.get("_at", 0) > 300:
            try:
                d = f_flights(); d["_at"] = time.time(); _save("flights", d); _push("flights", d, "live")
            except Exception as e:
                log(f"flight lookup refresh failed: {e}")
        if d:
            try:
                i = [c.upper() for c in d["cs"]].index(cs)
                out.update({"found": True, "i": i, "icao24": d["ic"][i], "lon": d["p"][i * 5], "lat": d["p"][i * 5 + 1],
                            "trk": d["p"][i * 5 + 2], "vel": d["p"][i * 5 + 3], "alt": d["p"][i * 5 + 4], "co": d["co"][i], "t": d["t"]})
            except ValueError:
                pass
        out["route"] = route_of(cs) or (route_of(q) if q != cs else None)
        r = out["route"]
        if r and r.get("from") and r.get("to") and r["from"].get("lat") is not None and r["to"].get("lat") is not None:
            out["route_km"] = round(km(r["from"]["lat"], r["from"]["lon"], r["to"]["lat"], r["to"]["lon"]))
            if out["found"]:
                out["done_km"] = round(km(r["from"]["lat"], r["from"]["lon"], out["lat"], out["lon"]))
                out["left_km"] = round(km(out["lat"], out["lon"], r["to"]["lat"], r["to"]["lon"]))
                if out["vel"] > 50:
                    out["eta_min"] = round(out["left_km"] * 1000 / out["vel"] / 60)
        _push("flightq", out, "live")
        log(f"flight {q} -> {cs}: found={out['found']} route={'yes' if out['route'] else 'no'}")
        if out.get("icao24"):
            fetch_track(out["icao24"])
    threading.Thread(target=job, daemon=True).start()


_tracks = {}


def fetch_track(icao24):
    icao24 = re.sub(r"[^0-9a-f]", "", (icao24 or "").lower())[:6]
    if not icao24:
        return
    def job():
        hit = _tracks.get(icao24)
        if hit and time.time() - hit[0] < 300:
            _push("track", hit[1], "live"); return
        try:
            d = _json(f"https://opensky-network.org/api/tracks/all?icao24={icao24}&time=0", 30)
            path = [[round(w[1], 3), round(w[2], 3)] for w in (d.get("path") or []) if w and w[1] is not None and w[2] is not None]
            out = {"icao24": icao24, "callsign": (d.get("callsign") or "").strip(), "path": path, "src": "OpenSky tracks"}
            _tracks[icao24] = (time.time(), out)
            _push("track", out, "live")
        except Exception as e:
            log(f"track {icao24} failed: {type(e).__name__}: {str(e)[:120]}")
            _push("track", {"icao24": icao24, "path": [], "error": type(e).__name__}, "offline")
    threading.Thread(target=job, daemon=True).start()


# ================================================================ 2 space stations: visible passes over home
MU, J2 = 398600.4418, 1.08263e-3
STATIONS = [("css", "中国空间站", 48274), ("iss", "国际空间站", 25544)]


def _jd(t):
    return t / 86400.0 + 2440587.5


def _gmst(t):
    d = _jd(t) - 2451545.0
    return math.radians((280.46061837 + 360.98564736629 * d) % 360)


def _sun_eci(t):
    d = _jd(t) - 2451545.0
    g = math.radians(357.529 + 0.98560028 * d); q = 280.459 + 0.98564736 * d
    L = math.radians(q + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)); e = math.radians(23.439 - 0.00000036 * d)
    return (math.cos(L), math.cos(e) * math.sin(L), math.sin(e) * math.sin(L))


def sat_eci(el, t):
    """Mean elements with J2 secular drift (good to roughly a kilometre or two a day for a station; no SGP4)."""
    n0 = el["n"] * 2 * math.pi / 86400.0
    dt = t - el["ep"]
    a = (MU / (n0 * n0)) ** (1 / 3)
    e, i = el["e"], el["i"]
    p = a * (1 - e * e)
    k = 1.5 * J2 * (RE_KM / p) ** 2 * n0
    raan = el["raan"] - k * math.cos(i) * dt
    argp = el["argp"] + 0.5 * k * (5 * math.cos(i) ** 2 - 1) * dt
    ndot = el.get("ndot", 0.0) * 2 * math.pi / 86400.0 ** 2          # rad/s^2, from MEAN_MOTION_DOT (= ndot/2, rev/day^2)
    M = el["M"] + (n0 + 0.5 * k * math.sqrt(1 - e * e) * (3 * math.cos(i) ** 2 - 1)) * dt + ndot * dt * dt
    E = M
    for _ in range(6):
        E = E - (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    nu = 2 * math.atan2(math.sqrt(1 + e) * math.sin(E / 2), math.sqrt(1 - e) * math.cos(E / 2))
    r = a * (1 - e * math.cos(E))
    u = argp + nu
    cO, sO, ci, si, cu, su = math.cos(raan), math.sin(raan), math.cos(i), math.sin(i), math.cos(u), math.sin(u)
    return (r * (cO * cu - sO * su * ci), r * (sO * cu + cO * su * ci), r * (su * si))


def _obs_eci(lat, lon, t):
    la, lo = math.radians(lat), math.radians(lon) + _gmst(t)
    return (RE_KM * math.cos(la) * math.cos(lo), RE_KM * math.cos(la) * math.sin(lo), RE_KM * math.sin(la))


def _look(lat, lon, s, t):
    """Elevation and azimuth (degrees) of an ECI position seen from lat/lon at time t."""
    o = _obs_eci(lat, lon, t)
    d = (s[0] - o[0], s[1] - o[1], s[2] - o[2]); n = math.sqrt(sum(x * x for x in d))
    la, lo = math.radians(lat), math.radians(lon) + _gmst(t)
    up = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    east = (-math.sin(lo), math.cos(lo), 0.0)
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    dot = lambda a, b: sum(x * y for x, y in zip(a, b))
    return math.degrees(math.asin(dot(d, up) / n)), (math.degrees(math.atan2(dot(d, east), dot(d, north))) + 360) % 360


def _sunlit(s, t):
    su = _sun_eci(t)
    p = sum(a * b for a, b in zip(s, su))
    if p > 0:
        return True
    perp = math.sqrt(max(0.0, sum(x * x for x in s) - p * p))
    return perp > RE_KM


def _sun_elev(lat, lon, t):
    su = _sun_eci(t)
    return _look(lat, lon, tuple(x * 1.496e8 for x in su), t)[0]


def passes(el, lat, lon, t0, hours=48, step=20):
    out, cur = [], None
    t = t0
    while t < t0 + hours * 3600:
        s = sat_eci(el, t)
        elev, az = _look(lat, lon, s, t)
        vis = elev > 10 and _sun_elev(lat, lon, t) < -6 and _sunlit(s, t)
        if vis:
            if not cur:
                cur = {"start": t, "az0": az, "max": elev, "tmax": t}
            if elev > cur["max"]:
                cur["max"], cur["tmax"] = elev, t
            cur["end"], cur["az1"] = t, az
        elif cur:
            out.append(cur); cur = None
        t += step
    if cur:
        out.append(cur)
    return [{"start": round(p["start"] * 1000), "end": round(p["end"] * 1000), "max": round(p["max"]), "tmax": round(p["tmax"] * 1000),
             "from": dir8(p["az0"]), "to": dir8(p["az1"]), "min": max(1, round((p["end"] - p["start"]) / 60))} for p in out]


def _el_of(s):
    ep = s["EPOCH"]
    t = calendar.timegm(time.strptime(ep[:19], "%Y-%m-%dT%H:%M:%S")) + (float("0." + ep[20:]) if len(ep) > 20 else 0)
    return {"i": math.radians(float(s["INCLINATION"])), "raan": math.radians(float(s["RA_OF_ASC_NODE"])),
            "argp": math.radians(float(s["ARG_OF_PERICENTER"])), "M": math.radians(float(s["MEAN_ANOMALY"])), "e": float(s["ECCENTRICITY"]),
            "n": float(s["MEAN_MOTION"]), "ndot": float(s.get("MEAN_MOTION_DOT") or 0), "ep": t}


def _gp_group(group, max_age=12 * 3600):
    """CelesTrak GP elements as CSV rows. CelesTrak asks clients not to re-download the same group within 2 hours
    (it blocks IPs that do), so the raw file is cached and only refreshed after max_age."""
    import csv, io
    f = CACHE / f"gp_{group}.csv"
    try:
        fresh = f.exists() and time.time() - f.stat().st_mtime < max_age
    except OSError:
        fresh = False
    fail = CACHE / f"gp_{group}.fail"
    try:
        backoff = fail.exists() and time.time() - fail.stat().st_mtime < 2 * 3600
    except OSError:
        backoff = False
    if not fresh and not backoff:                       # after any refusal, wait 2 h: repeated tries get an IP blocked
        try:
            raw = _get(f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=csv", 60)
            if b"OBJECT_NAME" not in raw[:200]:
                raise RuntimeError(raw[:120].decode("utf-8", "replace").strip())
            CACHE.mkdir(parents=True, exist_ok=True); f.write_bytes(raw)
        except Exception as e:
            try:
                CACHE.mkdir(parents=True, exist_ok=True); fail.write_text(f"{time.time()} {type(e).__name__}: {str(e)[:200]}")
            except OSError:
                pass
            log(f"gp {group}: {type(e).__name__}: {str(e)[:120]}")
            if not f.exists():
                raise RuntimeError("CelesTrak 暂时拒绝下载，2 小时后自动重试")
    return list(csv.DictReader(io.StringIO(f.read_text("utf-8", "replace"))))


SAT_KIND = [("station", re.compile(r"^(ISS|CSS)\b")), ("starlink", re.compile(r"^STARLINK")), ("oneweb", re.compile(r"^ONEWEB")), ("kuiper", re.compile(r"^KUIPER")),
            ("china", re.compile(r"^(QIANFAN|GUOWANG|HULIANWANG|BEIDOU|YAOGAN|TIANHE|WENTIAN|MENGTIAN|SHENZHOU|TIANZHOU|CSS|FENGYUN|GAOFEN|JILIN|SHIYAN|ZHANGHENG|HAIYANG|ZIYUAN|TIANHUI|CHUANGXIN|TIANQI|GEESPACE|GEESAT|SPACESAIL|SHIJIAN|TJS|CENTISPACE|TIANLIAN|CHINASAT|APSTAR)")),
            ("gnss", re.compile(r"^(GPS|NAVSTAR|COSMOS.*GLONASS|GSAT0|GALILEO|QZS|IRNSS|NVS)|\((GLONASS|GALILEO)"))]
KIND_I = {"other": 0, "starlink": 1, "oneweb": 2, "china": 3, "gnss": 4, "station": 5, "geo": 6, "kuiper": 7}
CZ_SUB = dict(zip("ABCDEF", "甲乙丙丁戊己"))
CZ_NUM = {"1": "一", "2": "二", "3": "三", "4": "四", "5": "五", "6": "六", "7": "七", "8": "八", "11": "十一", "12": "十二"}


def sat_kind(name, n):
    for k, rx in SAT_KIND:
        if rx.search(name):
            return k
    return "geo" if 0.95 < n < 1.05 else "other"


def sat_cn(name):
    """A Chinese label for the satellites a viewer might look up at. Unknown names stay as they are."""
    u = name.upper().strip()
    fixed = {"ISS (ZARYA)": "国际空间站", "CSS (TIANHE)": "中国空间站（天宫）", "HST": "哈勃太空望远镜", "TIANGONG": "中国空间站（天宫）"}
    if u in fixed:
        return fixed[u]
    m = re.match(r"CZ-(\d+)([A-F]?)\s*(R/B|DEB)?", u)
    if m:
        return f"长征{CZ_NUM.get(m.group(1), m.group(1))}号{CZ_SUB.get(m.group(2), '')}" + ("火箭残骸" if m.group(3) else "")
    m = re.match(r"STARLINK-(\d+)", u)
    if m:
        return f"星链-{m.group(1)}"
    m = re.match(r"(.+?)\s+R/B(\(\d\))?$", u)
    if m:
        r = m.group(1)
        for k, v in (("SL-16", "天顶号（俄）"), ("SL-14", "旋风号（俄）"), ("SL-12", "质子号（俄）"), ("SL-8", "宇宙号（俄）"), ("SL-6", "闪电号（俄）"),
                     ("SL-4", "联盟号（俄）"), ("SL-3", "东方号（俄）"), ("ATLAS", "宇宙神（美）"), ("DELTA", "德尔塔（美）"), ("TITAN", "大力神（美）"),
                     ("THOR", "雷神（美）"), ("ARIANE", "阿丽亚娜（欧）"), ("H-2A", "H-2A（日）"), ("GSLV", "GSLV（印）")):
            if k in r:
                return f"{v}火箭残骸"
        return f"{r} 火箭残骸"
    m = re.match(r"COSMOS (\d+)", u)
    if m:
        return f"宇宙-{m.group(1)}（俄）"
    return name


def _dark_windows(lat, lon, t0, hours, step):
    """Times (on the step grid) when the sky at home is dark enough to see a satellite: sun below -6 degrees."""
    return [t for t in range(int(t0), int(t0 + hours * 3600), step) if _sun_elev(lat, lon, t) < -6]


def passes_on(el, lat, lon, times, step):
    out, cur, last = [], None, None
    for t in times:
        if cur and last is not None and t - last > step:          # a gap in the dark grid ends a pass
            out.append(cur); cur = None
        last = t
        s = sat_eci(el, t)
        elev, az = _look(lat, lon, s, t)
        if elev > 10 and _sunlit(s, t):
            if not cur:
                cur = {"start": t, "az0": az, "max": elev, "tmax": t}
            if elev > cur["max"]:
                cur["max"], cur["tmax"] = elev, t
            cur["end"], cur["az1"] = t, az
        elif cur:
            out.append(cur); cur = None
    if cur:
        out.append(cur)
    return [{"start": round(p["start"] * 1000), "end": round(p["end"] * 1000), "max": round(p["max"]), "tmax": round(p["tmax"] * 1000),
             "from": dir8(p["az0"]), "to": dir8(p["az1"]), "min": max(1, round((p["end"] - p["start"]) / 60))} for p in out]


def f_stations():
    """头顶的卫星: every active satellite (for the globe and the live 'above you' count) + naked-eye passes tonight."""
    h = home(); now = time.time()
    act = _gp_group("active")
    try:
        vis_ids = {r["NORAD_CAT_ID"] for r in _gp_group("visual")}
    except Exception as e:
        log(f"gp visual: {type(e).__name__}: {str(e)[:80]}"); vis_ids = set()
    els, kinds, up, up_k, named = [], {}, 0, {}, []
    for r in act:
        try:
            el = _el_of(r)
        except Exception:
            continue
        name = r.get("OBJECT_NAME") or ""
        k = sat_kind(name, el["n"])
        kinds[k] = kinds.get(k, 0) + 1
        els.extend([round(el["n"], 8), round(el["e"], 7), round(el["i"], 5), round(el["raan"], 5), round(el["argp"], 5), round(el["M"], 5),
                    round(el["ep"], 1), KIND_I[k]])
        try:
            if _look(h["lat"], h["lon"], sat_eci(el, now), now)[0] > 0:
                up += 1; up_k[k] = up_k.get(k, 0) + 1
        except (ValueError, ZeroDivisionError):
            pass
        cat = r.get("NORAD_CAT_ID")
        if cat in vis_ids or cat in ("25544", "48274"):
            named.append({"cat": cat, "name": name, "cn": sat_cn(name), "kind": k, "el": el})
    if not els:
        raise RuntimeError("no satellite elements")
    step = 30
    dark = _dark_windows(h["lat"], h["lon"], now, 24, step)
    nxt = []
    for s_ in named:
        for p in passes_on(s_["el"], h["lat"], h["lon"], dark, step):
            if p["max"] >= 20 or s_["kind"] == "station":            # low passes of dim objects are not worth going outside for
                nxt.append(dict(p, who=s_["cn"], en=s_["name"], k=s_["kind"], cat=s_["cat"]))
    nxt.sort(key=lambda p: p["start"])
    st = []
    for key, cn, norad in STATIONS:                                  # the two crewed stations keep their own dots, labels and tracks
        s_ = next((x for x in named if x["cat"] == str(norad)), None)
        if s_:
            st.append({"k": key, "name": cn, "el": s_["el"], "passes": [p for p in nxt if p["cat"] == str(norad)]})
    tonight = [p for p in nxt if p["start"] < (now + 16 * 3600) * 1000]
    return {"count": len(els) // 8, "els": els, "kinds": kinds, "up": up, "up_k": up_k, "up_starlink": up_k.get("starlink", 0),
            "s": st, "next": nxt[:40], "tonight": len(tonight), "named": len(named),
            "home": {k: h[k] for k in ("lat", "lon", "name")}, "src": "CelesTrak",
            "note": "CelesTrak 公开轨道根数推算的位置，误差几公里到几十公里。肉眼可见＝天黑、卫星被太阳照亮、仰角高于 20°（空间站 10°），能不能看到还要看云和光污染"}


# ================================================================ 3 quakes
def f_quakes():
    h = home(); q, srcs = [], []
    try:
        d = _json("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson")
        for f in d.get("features") or []:
            g, pr = f.get("geometry") or {}, f.get("properties") or {}
            c = g.get("coordinates") or []
            if len(c) < 2 or pr.get("mag") is None:
                continue
            q.append({"lon": round(c[0], 3), "lat": round(c[1], 3), "m": round(pr["mag"], 1), "dep": round(c[2] or 0, 1) if len(c) > 2 and c[2] is not None else 0,
                      "place": pr.get("place") or "", "t": pr.get("time") or 0, "src": "USGS"})
        srcs.append("USGS")
    except Exception as e:
        log(f"quakes USGS: {type(e).__name__}: {str(e)[:100]}")
    if not srcs:
        raise RuntimeError("no quake feed")
    # the same quake from both networks: keep the CENC one (Chinese name) when they are within 60 km and 3 minutes
    q.sort(key=lambda x: 0 if x["src"] != "USGS" else 1)
    kept = []
    for x in q:
        if any(abs(x["t"] - y["t"]) < 180000 and km(x["lat"], x["lon"], y["lat"], y["lon"]) < 60 for y in kept):
            continue
        kept.append(x)
    for x in kept:
        x["km"] = round(km(h["lat"], h["lon"], x["lat"], x["lon"]))
    kept.sort(key=lambda x: -x["t"])
    near = [x for x in kept if x["km"] <= 1000]
    return {"count": len(kept), "q": kept, "near": len(near), "big": sum(1 for x in kept if x["m"] >= 5),
            "home": {k: h[k] for k in ("lat", "lon", "name")}, "src": " + ".join(srcs),
            "note": "过去 24 小时，美国地质调查局全球目录。中国境内 3 级以下的小地震收录不全（中国地震台网的公开接口已停用）"}


# ================================================================ 4 storms
def storm_cn(text, wind):
    """'Tropical Storm (maximum wind speed of 120 km/h)' -> '热带风暴 · 最大风速 120 km/h'."""
    t = (text or "").lower()
    kind = ("超强台风" if wind and wind >= 185 else "强台风" if wind and wind >= 150 else "台风") if re.search(r"typhoon|hurricane|cyclone", t) else \
           "热带风暴" if "storm" in t else "热带低压" if "depression" in t else ""
    m = re.search(r"(\d+)\s*km/h", t)
    sp = f"最大风速 {m.group(1)} km/h" if m else (f"最大风速 {round(wind)} km/h" if wind else "")
    return " · ".join(x for x in (kind, sp) if x) or (text or "")


def _ts(v):
    """GDACS dates ('2026-10-30T12:00:00' / '30 Oct 2026 12:00:00') -> epoch seconds (UTC) or 0."""
    v = str(v or "").strip().replace("Z", "")
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%d %b %Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%b/%Y %H:%M:%S"):
        try:
            return calendar.timegm(time.strptime(v[:20].strip(), fmt))
        except Exception:
            pass
    return 0


def _chain(segs, start=None):
    """GDACS sends the track as unordered 2-point segments [from, to]. Link them into one ordered path."""
    nxt, tos = {}, set()
    for c in segs:
        if len(c) >= 2:
            p, q = (round(c[0][1], 2), round(c[0][0], 2)), (round(c[-1][1], 2), round(c[-1][0], 2))
            nxt[p] = q; tos.add(q)
    if not nxt:
        return []
    heads = [p for p in nxt if p not in tos]
    cur = start if start in nxt else (heads[0] if heads else next(iter(nxt)))
    out, seen = [cur], {cur}
    while cur in nxt and nxt[cur] not in seen:
        cur = nxt[cur]; out.append(cur); seen.add(cur)
    return [list(p) for p in out]


def storm_track(eid, epi, h, lat, lon):
    """Past + forecast track from GDACS (JTWC/NOAA). No per-point times are published, so only distances."""
    d = _json(f"https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid={eid}&episodeid={epi}", 30)
    past, fut = [], []
    for f in d.get("features") or []:
        g, pr = f.get("geometry") or {}, f.get("properties") or {}
        if g.get("type") == "LineString":
            (fut if str(pr.get("forecast", "")).lower() == "true" else past).append(g.get("coordinates") or [])
    now = (round(lat, 2), round(lon, 2))
    F, P = _chain(fut, now), _chain(past)
    best = None
    for p in F:
        k = km(h["lat"], h["lon"], p[0], p[1])
        if best is None or k < best[0]:
            best = (k, p)
    close = {"km": round(best[0]), "lat": best[1][0], "lon": best[1][1], "end": best[1] == F[-1],
             "dir": dir8(bearing(h["lat"], h["lon"], best[1][0], best[1][1]))} if best else None
    head = None
    if len(F) >= 2:                                         # which way it is heading over the first forecast leg
        head = dir8(bearing(F[0][0], F[0][1], F[1][0], F[1][1]))
    return {"past": P[-60:], "fut": F[:40], "close": close, "head": head}


def f_storms():
    h = home()
    d = _json("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red", 30)
    out, seen = [], set()
    for f in d.get("features") or []:
        pr, g = f.get("properties") or {}, f.get("geometry") or {}
        if str(pr.get("iscurrent", "true")).lower() != "true":
            continue
        if _ts(pr.get("todate")) and _ts(pr.get("todate")) < time.time() - 36 * 3600:   # "current" but no update for 1.5 days: dissipated
            continue
        eid = pr.get("eventid")
        if eid in seen:
            continue
        c = g.get("coordinates") or []
        if g.get("type") != "Point" or len(c) < 2:
            continue
        seen.add(eid)
        lon, lat = c[:2]
        sev = pr.get("severitydata") or {}
        out.append({"lon": lon, "lat": lat, "name": pr.get("eventname") or pr.get("name") or "", "alert": pr.get("alertlevel") or "",
                    "sev": storm_cn(sev.get("severitytext"), sev.get("severity")), "wind": sev.get("severity"), "unit": sev.get("severityunit") or "",
                    "country": pr.get("country") or "", "to": pr.get("todate") or "", "id": eid, "epi": pr.get("episodeid"),
                    "src2": pr.get("source") or "",
                    "km": round(km(h["lat"], h["lon"], lat, lon)), "dir": dir8(bearing(h["lat"], h["lon"], lat, lon))})
    out.sort(key=lambda s: s["km"])
    out = out[:12]
    for s_ in out[:5]:                                       # tracks for the nearest few (one request each)
        try:
            s_.update(storm_track(s_["id"], s_["epi"], h, s_["lat"], s_["lon"]))
        except Exception as e:
            log(f"storm track {s_['id']}: {type(e).__name__}: {str(e)[:80]}")
    return {"count": len(out), "s": out, "home": {k: h[k] for k in ("lat", "lon", "name")}, "src": "GDACS",
            "note": "联合国/欧盟全球灾害预警系统（GDACS）当前的热带气旋，路径预报来自 JTWC/NOAA。预报会变，以气象台为准"}


# ================================================================ 5 news
CAMEO = {"01": "表态", "02": "呼吁", "03": "表示合作", "04": "会谈磋商", "05": "外交合作", "06": "经贸合作", "07": "援助",
         "08": "让步", "09": "调查", "10": "提出要求", "11": "批评指责", "12": "拒绝", "13": "威胁", "14": "抗议示威",
         "15": "军事部署", "16": "关系降级", "17": "施压制裁", "18": "袭击", "19": "交火冲突", "20": "大规模暴力"}
GDELT_LANG = (("lastupdate.txt", "英文"), ("lastupdate-translation.txt", "外语（含中文）"))


def _slug_title(url):
    """Best-effort headline from the article URL (GDELT events carry no headline)."""
    try:
        p = urllib.parse.urlparse(url)
        segs = [x for x in p.path.split("/") if x]
        for seg in reversed(segs):
            seg = re.sub(r"\.(s?html?|php|aspx?|cms)$", "", urllib.parse.unquote(seg), flags=re.I)
            words = [w for w in re.split(r"[-_+]+", seg) if w and not re.fullmatch(r"[0-9a-f]{6,}|\d+|amp|index|article|story|news", w, re.I)]
            if len(words) >= 3:
                t = " ".join(words)
                return (t[:1].upper() + t[1:])[:110]
        return p.netloc.replace("www.", "")
    except Exception:
        return ""


def _gdelt_files(index, n=4):
    """GDELT 2.0 publishes an events file every 15 min. Read the newest one's name, step back to get the last n."""
    txt = _get(f"http://data.gdeltproject.org/gdeltv2/{index}", 20).decode("utf-8", "replace")
    m = re.search(r"(https?://\S+?/(\d{14})\.(translation\.)?export\.CSV\.zip)", txt)
    if not m:
        raise RuntimeError("no export in " + index)
    t0 = calendar.timegm(time.strptime(m.group(2), "%Y%m%d%H%M%S"))
    base = m.group(1).replace(m.group(2), "{}")
    return [base.format(time.strftime("%Y%m%d%H%M%S", time.gmtime(t0 - 900 * i))) for i in range(n)], t0


def f_news():
    import csv, io, zipfile
    h = home(); places, urls, srcs, newest = {}, set(), [], 0
    for index, tag in GDELT_LANG:
        try:
            files, t0 = _gdelt_files(index)
            newest = max(newest, t0); got = 0
            for u in files:
                try:
                    z = zipfile.ZipFile(io.BytesIO(_get(u, 30)))
                except Exception as e:
                    log(f"news file {u[-40:]}: {type(e).__name__}"); continue
                got += 1
                with z.open(z.namelist()[0]) as fh:
                    for r in csv.reader(io.TextIOWrapper(fh, "utf-8", "replace"), delimiter="\t"):
                        if len(r) < 61 or not r[56] or not r[57] or r[51] in ("", "0"):
                            continue
                        url = r[60]
                        try:
                            lat, lon = float(r[56]), float(r[57])
                        except ValueError:
                            continue
                        key = r[52] or f"{lat:.1f},{lon:.1f}"
                        if (url, key) in urls:                # one article -> many events; count it once per place
                            continue
                        urls.add((url, key))
                        p = places.get(key)
                        if not p:
                            p = places[key] = {"name": r[52], "cc": r[53], "lat": round(lat, 3), "lon": round(lon, 3), "n": 0,
                                               "country_level": r[51] == "1", "kinds": {}, "titles": [], "tone": 0.0, "lang": tag}
                        p["n"] += 1
                        k = CAMEO.get(r[28][:2])
                        if k:
                            p["kinds"][k] = p["kinds"].get(k, 0) + 1
                        try:
                            p["tone"] += float(r[34])
                        except ValueError:
                            pass
                        if len(p["titles"]) < 4:
                            t = _slug_title(url) if tag == "英文" else urllib.parse.urlparse(url).netloc.replace("www.", "")
                            if t and all(t != x["t"] for x in p["titles"]):
                                p["titles"].append({"t": t, "u": url})
            if got:
                srcs.append(tag)
        except Exception as e:
            log(f"news {tag}: {type(e).__name__}: {str(e)[:100]}")
    if not srcs:
        raise RuntimeError("no news feed")
    out = []
    for p in places.values():
        p["tone"] = round(p["tone"] / max(1, p["n"]), 1)
        p["kinds"] = [k for k, _ in sorted(p["kinds"].items(), key=lambda x: -x[1])[:3]]
        p["km"] = round(km(h["lat"], h["lon"], p["lat"], p["lon"]))
        out.append(p)
    # country-level geocodes sit at the country centre; rank specific places first when counts tie
    out.sort(key=lambda p: (-p["n"], p["country_level"]))
    near = sorted((p for p in out if p["km"] <= 1500 and not p["country_level"]), key=lambda p: -p["n"])[:5]
    china = [p for p in out if p["cc"] == "CH"][:5]                         # GDELT uses FIPS codes: CH = China
    return {"count": len(out), "articles": len({u for u, _ in urls}), "p": out[:90], "near": near, "cn": china, "src": "GDELT 2.0", "langs": srcs,
            "t": newest * 1000, "home": {k: h[k] for k in ("lat", "lon", "name")},
            "note": "过去 1 小时全球媒体报道里提到的地点，按报道篇数排。标题取自文章网址，类别由 GDELT 自动分类，不是核实过的事件"}


# ================================================================ 6 launch
def f_launch():
    d = _json("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=30&mode=detailed&hide_recent_previous=true", 40)
    out = []
    for r in d.get("results") or []:
        pad = r.get("pad") or {}; loc = pad.get("location") or {}
        vids = [v.get("url") for v in (r.get("vidURLs") or []) if v.get("url")]
        out.append({"name": r.get("name") or "", "net": r.get("net") or "", "status": (r.get("status") or {}).get("abbrev") or "",
                    "provider": (r.get("launch_service_provider") or {}).get("name") or "",
                    "rocket": ((r.get("rocket") or {}).get("configuration") or {}).get("full_name") or "",
                    "mission": (r.get("mission") or {}).get("name") or "", "orbit": ((r.get("mission") or {}).get("orbit") or {}).get("abbrev") or "",
                    "pad": pad.get("name") or "", "where": loc.get("name") or "", "cc": loc.get("country_code") or "",
                    "lat": float(pad.get("latitude") or 0), "lon": float(pad.get("longitude") or 0),
                    "st_cn": {"Go": "确认", "TBD": "时间待定", "TBC": "待确认", "Hold": "暂停", "In Flight": "飞行中", "Success": "成功", "Failure": "失败"}.get((r.get("status") or {}).get("abbrev") or "", ""),
                    "live": bool(r.get("webcast_live")), "vid": vids[:1], "window": [r.get("window_start"), r.get("window_end")]})
    out = [x for x in out if x["net"]]
    cn = [x for x in out if x["cc"] == "CHN" or "China" in x["where"]]
    return {"count": len(out), "l": out, "cn": cn[:4], "src": "Launch Library 2", "note": "全球未来约 30 次发射（全世界一周大约 5~6 次）。时间以官方公布为准，经常推迟"}


# ================================================================ 7 wind
def f_wind():
    h = home()
    lats = list(range(-70, 71, 10)); lons = list(range(-180, 180, 15))
    pts = [(la, lo) for la in lats for lo in lons]
    vals = {}
    for k in range(0, len(pts), 90):
        chunk = pts[k:k + 90]
        url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
            "latitude": ",".join(str(a) for a, _ in chunk), "longitude": ",".join(str(b) for _, b in chunk),
            "current": "wind_speed_10m,wind_direction_10m", "wind_speed_unit": "ms"})
        d = _json(url, 40)
        rows = d if isinstance(d, list) else [d]
        for (la, lo), r in zip(chunk, rows):
            c = r.get("current") or {}
            if c.get("wind_speed_10m") is not None:
                vals[(la, lo)] = (c["wind_speed_10m"], c["wind_direction_10m"])
    grid = []
    for la in lats:
        for lo in lons:
            s, dd = vals.get((la, lo), (0, 0))
            rad = math.radians(dd)                                # the direction the wind comes FROM
            grid += [round(-s * math.sin(rad), 2), round(-s * math.cos(rad), 2)]   # u (east), v (north) it blows TOWARD
    local = None
    try:
        from . import amap
        w = amap.weather()
        local = {"text": w.get("wind", ""), "temp": w.get("temp"), "now": w.get("now"), "city": w.get("city"), "src": "高德天气"}
    except Exception:
        pass
    if not local:
        try:
            c = _json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({"latitude": h["lat"], "longitude": h["lon"],
                      "current": "wind_speed_10m,wind_direction_10m,wind_gusts_10m", "wind_speed_unit": "ms"}), 20).get("current") or {}
            local = {"ms": c.get("wind_speed_10m"), "from": dir8(c.get("wind_direction_10m") or 0), "gust": c.get("wind_gusts_10m"), "src": "Open-Meteo"}
        except Exception:
            pass
    strongest = max(((math.hypot(grid[i * 2], grid[i * 2 + 1]), i) for i in range(len(pts))), default=(0, 0))
    return {"count": len(vals), "lats": lats, "lons": lons, "g": grid, "local": local, "home": {k: h[k] for k in ("lat", "lon", "name")},
            "max": {"ms": round(strongest[0], 1), "lat": pts[strongest[1]][0], "lon": pts[strongest[1]][1]},
            "src": "Open-Meteo", "note": "全球 10 米高度风场，经纬 10°×15° 网格（粗网格，看大势用）"}


# ================================================================ 8 aurora / solar storms
def _rows(d):
    """SWPC products come as a list of lists with a header row, or (newer) a list of dicts."""
    if isinstance(d, list) and d and isinstance(d[0], list):
        head = [str(x) for x in d[0]]
        return [dict(zip(head, r)) for r in d[1:]]
    return d if isinstance(d, list) else []


def f_aurora():
    now = _rows(_json("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"))
    kp = None
    for r in reversed(now):
        v = r.get("estimated_kp", r.get("kp_index", r.get("Kp")))
        if v is not None:
            kp = float(v); break
    fc = []
    try:
        for r in _rows(_json("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json")):
            v = r.get("kp", r.get("Kp")); t = r.get("time_tag")
            if v is None or not t:
                continue
            tt = calendar.timegm(time.strptime(str(t)[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S"))
            if tt > time.time() - 3 * 3600:
                fc.append([tt * 1000, float(v), str(r.get("observed", r.get("noaa_scale", "")) or "")])
    except Exception as e:
        log(f"aurora forecast: {type(e).__name__}: {str(e)[:80]}")
    ov = _json("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json", 40)
    pts = [[c[0] if c[0] <= 180 else c[0] - 360, c[1], c[2]] for c in ov.get("coordinates") or [] if len(c) >= 3 and c[2] >= 4]
    h = home()
    gmlat = _geomag_lat(h["lat"], h["lon"])
    need = max(0, min(9, round((66.5 - abs(gmlat)) / 2.5)))        # rough rule of thumb: the oval reaches ~66.5° - 2.5° per Kp
    storm = "G" + str(int(kp) - 4) if kp is not None and kp >= 5 else ""
    peak = max(fc, key=lambda x: x[1]) if fc else None
    return {"count": len(pts), "kp": kp, "storm": storm, "fc": fc[:24], "peak": peak, "ov": pts, "ovt": ov.get("Forecast Time") or "",
            "home": {k: h[k] for k in ("lat", "lon", "name")}, "gmlat": round(gmlat, 1), "need": need,
            "src": "NOAA SWPC", "note": "Kp 0-9，5 以上是地磁暴（G1-G5）。“需要 Kp 几”按地磁纬度经验估算，只是参考"}


def _geomag_lat(lat, lon):
    """Geomagnetic (dipole) latitude; pole near 80.7N 72.7W (IGRF, 2025)."""
    pl, po = math.radians(80.7), math.radians(-72.7)
    la, lo = math.radians(lat), math.radians(lon)
    return math.degrees(math.asin(math.sin(la) * math.sin(pl) + math.cos(la) * math.cos(pl) * math.cos(lo - po)))


# ================================================================ plumbing
FETCH = {"flights": f_flights, "stations": f_stations, "quakes": f_quakes, "storms": f_storms, "news": f_news,
         "launch": f_launch}


def _push(card, data, state, age=0):
    if UI:
        UI({"type": "earth_data", "card": card, "state": state, "age": round(age), **(data or {})})


def _fetch(card):
    fn = FETCH.get(card)
    if not fn:
        return
    with _lock:
        if card in _busy:
            return
        _busy.add(card)
    try:
        cached = _load(card)
        if cached and cached.get("home"):            # distances and passes were worked out for a home that has since moved
            h = home()
            if km(h["lat"], h["lon"], cached["home"]["lat"], cached["home"]["lon"]) > 50:
                cached["_at"] = 0
        if cached:
            age = time.time() - cached.get("_at", 0)
            _push(card, cached, "live" if age < FRESH[card] else "stale", age)
            if age < FRESH[card]:
                if card == "flights":
                    _near_routes()
                return
        if time.time() - _last.get(card, 0) < min(60, FRESH[card]):
            return
        _last[card] = time.time()
        t0 = time.time()
        try:
            data = fn()
            data["_at"] = time.time()
            _save(card, data)
            _push(card, data, "live", 0)
            log(f"{card}: {data.get('count')} in {time.time() - t0:.1f}s")
            if card == "flights":
                _near_routes()
        except Exception as e:
            log(f"{card} failed: {type(e).__name__}: {str(e)[:160]}")
            if not cached:
                _push(card, {"src": "", "error": f"{type(e).__name__}"}, "offline")
    finally:
        with _lock:
            _busy.discard(card)


def fetch_async(cards=None):
    def go():
        h = home()
        _push("home", {k: h[k] for k in ("lat", "lon", "name", "src")}, "live")
    threading.Thread(target=go, daemon=True).start()
    for c in cards or CARDS:
        if c in FETCH:
            threading.Thread(target=_fetch, args=(c,), daemon=True).start()


def summary(key=None):
    out = {}
    for c in ([key] if key else CARDS):
        d = _load(c)
        if not d:
            continue
        if c == "flights":
            out[c] = f"{d.get('near_n', len(d.get('near') or []))} aircraft within 300 km of home that receivers can hear; {d['count']} heard worldwide (oceans and mainland China are poorly covered)"
        elif c == "stations" and d.get("up") is not None:
            out[c] = f"{d['up']} satellites above the user's horizon right now ({d.get('up_starlink', 0)} Starlink) out of {d['count']} active"
            p = (d.get("next") or [None])[0]
            if p:
                out[c] += f"; next naked-eye pass: {p['who']} at {time.strftime('%m-%d %H:%M', time.localtime(p['start'] / 1000))}, max elevation {p['max']} deg, {p['from']} to {p['to']}"
        elif c == "quakes" and d.get("q"):
            n = [x for x in d["q"] if x["km"] <= 1000]
            out[c] = f"{len(n)} quakes within 1000 km of home in 24 h" + (f", latest M{n[0]['m']} {n[0]['place']} {n[0]['km']} km away" if n else "") + f"; {d.get('big', 0)} of M5+ worldwide"
        elif c == "storms":
            s = d.get("s") or []
            out[c] = f"{d['count']} active tropical cyclones" + (f", nearest {s[0]['name']} {s[0]['km']} km away" if s else "")
        elif c == "news" and d.get("p"):
            out[c] = f"most mentioned place in the last hour: {d['p'][0]['name']}"
        elif c == "launch" and d.get("l"):
            l = d["l"][0]
            out[c] = f"next launch {l['name']} at {l['net']} UTC from {l['where']}"
    return out


def selftest():
    assert card_of("3") == "quakes" and card_of("第二张") == "stations" and card_of("open the third card") == "quakes"
    assert card_of("打开航班") == "flights" and card_of("台风") == "storms" and card_of("今晚能看到空间站吗") == "stations"
    assert card_of("show me the planet") is None and card_of("today") is None and card_of("头顶的卫星") == "stations" and card_of("星链") == "stations"
    assert flight_in("MU5101飞到哪了") == "MU5101" and flight_in("where is flight ca 981 now") == "CA981" and flight_in("东航5101") == "MU5101"
    assert flight_in("CES5101 在哪") == "CES5101" and to_icao("MU5101") == "CES5101" and to_icao("CES5101") == "CES5101"
    assert _wants("贾维斯，我想看看地球上正在发生什么") and _wants("Jarvis, what's happening on Earth right now?")
    assert _wants("MU5101现在飞到哪了") and not _wants("what's the weather")
    ON["at"] = time.time()
    assert _wants("打开第二张") and _wants("open the quake card") and _wants("close it")
    ON["at"] = 0
    assert not _wants("open the quake card")
    # station maths: a circular 400 km orbit takes ~92 minutes
    el = {"i": math.radians(51.6), "raan": 0, "argp": 0, "M": 0, "e": 0.0005, "n": 15.5, "ndot": 0, "ep": 0}
    r = math.sqrt(sum(x * x for x in sat_eci(el, 0)))
    assert 6700 < r < 6800, r
    assert abs(_geomag_lat(80.7, -72.7) - 90) < 0.01
    print("earthwatch selftest ok")


def bind(ctx):
    global UI
    UI = ctx.ui


def provide():
    return [(tool(), run)], HINT


def wants(text):
    return "show_earth_now" if _wants(text) else None


if __name__ == "__main__":
    selftest()
