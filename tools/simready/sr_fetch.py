"""Downloads the pilot SimReady models (USD layers only, no textures) and turns each into a Jarvis teardown hologram.

python sr_fetch.py pilot.json WORK_DIR HOLO_DIR [slug ...]
Tries hf-mirror.com first, then huggingface.co. Files already downloaded are kept."""
import json, re, ssl, sys, time, traceback, urllib.parse, urllib.request
from pathlib import Path

HOSTS = ["https://hf-mirror.com", "https://huggingface.co"]
UA = {"User-Agent": "Jarvis-SimReady-pilot/1.0 (+https://github.com/shitoudaidi/GDDXX-Jarvis)"}
KEEP = re.compile(r"\.(usd|usda|usdc)$", re.I)
DROP = re.compile(r"/\.thumbs/|/source_assets/|/runnables/|mujoco|newton|/docs/", re.I)
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def get(url, tries=4, timeout=60):
    err = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout, context=CTX) as r:
                return r.read(), r.headers
        except Exception as e:
            err = e
            if getattr(e, "code", 0) in (401, 403, 404):
                break
            time.sleep(2 * (k + 1))
    raise err


def listing(host, repo, folder):
    out, url = [], f"{host}/api/datasets/{repo}/tree/main/{urllib.parse.quote(folder)}?recursive=true&expand=false"
    while url:
        body, hdr = get(url)
        out += [e for e in json.loads(body) if e.get("type") == "file"]
        nxt = re.search(r'<([^>]+)>;\s*rel="next"', hdr.get("Link", "") or "")
        url = nxt.group(1) if nxt else None
    return out


def fetch(asset, work):
    last = None
    for host in HOSTS:
        try:
            files = listing(host, asset["repo"], asset["dir"])
            log(f"{asset['slug']}: {len(files)} files listed via {host}")
            break
        except Exception as e:
            last = e
            log(f"{asset['slug']}: listing via {host} failed: {e}")
    else:
        raise RuntimeError(f"cannot list {asset['repo']}/{asset['dir']}: {last}")
    want = [f for f in files if (KEEP.search(f["path"]) and "/simready_usd/" in f["path"] and not DROP.search(f["path"]))
            or f["path"].endswith("root_usds.json")]
    total = sum(f.get("size", 0) for f in want)
    log(f"  downloading {len(want)} USD files, {total / 1e6:.1f} MB")
    root = work / asset["slug"]
    for f in want:
        dst = root / f["path"]
        if dst.exists() and dst.stat().st_size == f.get("size", -1):
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        path = urllib.parse.quote(f["path"])
        body = None
        for h in [host] + [x for x in HOSTS if x != host]:
            try:
                body, _ = get(f"{h}/datasets/{asset['repo']}/resolve/main/{path}", timeout=300)
                break
            except Exception as e:
                log(f"  {f['path']} via {h}: {e}")
        if body is None:
            raise RuntimeError(f"cannot download {f['path']}")
        dst.write_bytes(body)
        log(f"  got {f['path']} ({len(body) / 1e6:.1f} MB)")
    # which USD is the model itself
    base = root / asset["dir"]
    for j in base.glob(".metadata/*root_usds.json"):
        for name in re.findall(r'"([^"]+\.usda?c?)"', j.read_text(errors="ignore")):
            for c in (base / name, base / "simready_usd" / Path(name).name):
                if c.exists():
                    return c
    tops = sorted((base / "simready_usd").glob("*.usd*"), key=lambda p: (p.name.startswith("sm_") is False, len(p.name)))
    if not tops:
        raise RuntimeError("no top-level USD in the package")
    return tops[0]


def main():
    pilot, work, holo = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")), Path(sys.argv[2]), Path(sys.argv[3])
    only = set(sys.argv[4:])
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import simready_holo
    done = []
    for a in pilot:
        if only and a["slug"] not in only:
            continue
        try:
            usd = fetch(a, work)
            log(f"  converting {usd.name}")
            meta = dict(a)
            meta["source"] = f"huggingface.co/datasets/{a['repo']} · {a['dir']} · {a['licence']}"
            n, pts = simready_holo.convert(usd, holo, a["slug"], meta)
            done.append(f"{a['title']}（{n} 个部件）")
        except Exception:
            log(f"!! {a['slug']} failed:\n{traceback.format_exc()}")
    log("DONE: " + ("；".join(done) if done else "没有成功的模型"))


if __name__ == "__main__":
    main()
