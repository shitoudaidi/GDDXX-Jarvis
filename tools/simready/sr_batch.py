"""Overnight SimReady -> Jarvis teardown library.

python sr_batch.py --lab LAB --holo ~/.jarvis/holo [--max 100] [--hours 8] [--only name ...]
For each candidate model in nvidia/simready-assets: download its USD layers, convert to a teardown hologram,
skip it if it has fewer than 3 parts, render a numbered preview, ask a vision model (Jarvis's own LLM settings;
llm.vision_model in ~/.jarvis/config.json if the main model can't see pictures, e.g. deepseek-flash; it gets the picture
plus each part's name/material/size/position) to name the parts by naming_rules.md, then gate: confident ->
~/.jarvis/holo (shows in the 3D 拆解 library), unsure -> LAB/review/ for a person. The download is deleted after.
State in LAB/batch_state.json, so a rerun picks up where it stopped."""
import argparse, base64, json, re, shutil, ssl, sys, time, traceback, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sr_fetch, simready_holo, holo_render  # noqa: E402

REPO = "nvidia/simready-assets"
LIC = "CC-BY-4.0"
WANT = re.compile(r"^(brakeSystem|coolingSystem|airSystem|engine|transmission|suspension|steering|exhaust|fuelSystem|"
                  r"electricalSystem|carFrame|bodyPart_door_assembled|appliance|climate|conveyor|computer_(printer|desktop|"
                  r"scanner|terminal)|Xray|CT_|anesthesia|defibrillator|device_|arm_|cart_(computer|equipment|medical)|"
                  r"chair_(office|surgical|patient)|bed_hospital|tool|power|robot|machine|vehicle|forklift|bike|"
                  r"bicycle|scooter|generator|pump|valve|motor|gear|drill|saw|press|digitalSystem)", re.I)
SKIP = re.compile(r"^(box|crate|consumable|container|bottle|cleaning|dishware|decor|bandage|bucket|bin_|book|"
                  r"bedding|blinds|barrier|case_|clogs|food|fruit|plant|paper)", re.I)
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def top_dirs():
    for host in sr_fetch.HOSTS:
        try:
            out, url = [], f"{host}/api/datasets/{REPO}/tree/main"
            while url:
                body, hdr = sr_fetch.get(url)
                out += [e["path"] for e in json.loads(body) if e.get("type") == "directory"]
                nxt = re.search(r'<([^>]+)>;\s*rel="next"', hdr.get("Link", "") or "")
                url = nxt.group(1) if nxt else None
            log(f"{len(out)} models listed via {host}")
            return out
        except Exception as e:
            log(f"listing via {host} failed: {e}")
    raise SystemExit("cannot list the SimReady catalogue")


def llm(cfg, prompt, png):
    img = base64.b64encode(Path(png).read_bytes()).decode()
    body = {"model": cfg.get("vision_model") or cfg.get("model"), "max_tokens": 12000,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt},
                                                      {"type": "image_url", "image_url": {"url": "data:image/png;base64," + img}}]}]}
    req = urllib.request.Request(cfg["base_url"].rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + cfg["api_key"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300, context=CTX) as r:
        out = json.loads(r.read())
    txt = out["choices"][0]["message"].get("content") or ""
    m = re.search(r"\{.*\}", txt, re.S)
    return json.loads(m.group(0)) if m else {}, out.get("usage", {})


def relabel(html, holo, res, info, folder):
    """Writes the names, narration, title and aliases DeepSeek chose into the figure page."""
    s = html.read_text(encoding="utf-8")
    at = s.index("const D = "); end = s.index(";\n", at)
    D = json.loads(s[at + 10:end])
    names = res.get("parts", {})
    for p in info["parts"]:
        r = names.get(str(p["n"])) or {}
        if r.get("name"):
            D["pieces"][p["id"]] = {"name": str(r["name"])[:24], "say": str(r.get("say", ""))[:160]}
    title = str(res.get("title_zh") or folder)[:40]
    aliases = [str(a) for a in res.get("aliases", [])][:12] + [folder.split("_a0")[0].replace("_", " ")]
    label = f'{title}: {", ".join(aliases)}. {str(res.get("desc", ""))[:300]}'.replace('"', "'").replace("<", " ")
    s = s[:at + 10] + json.dumps(D, ensure_ascii=False) + s[end:]
    s = re.sub(r'aria-label="[^"]*"', lambda m: f'aria-label="{label}"', s, count=1)
    s = re.sub(r"<title>.*?</title>", lambda m: f"<title>{title}</title>", s, count=1, flags=re.S)
    html.write_text(s, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lab", required=True); ap.add_argument("--holo", required=True)
    ap.add_argument("--max", type=int, default=100); ap.add_argument("--hours", type=float, default=8)
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    lab, holo = Path(a.lab), Path(a.holo)
    work, review, tmp = lab / "models", lab / "review", lab / "tmp"
    for d in (work, review, tmp, holo):
        d.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((Path.home() / ".jarvis/config.json").read_text(encoding="utf-8")).get("llm", {})
    for k, e in (("base_url", "JARVIS_LLM_BASE_URL"), ("api_key", "JARVIS_LLM_API_KEY"), ("model", "JARVIS_LLM_MODEL")):
        import os
        cfg[k] = os.environ.get(e) or cfg.get(k)
    if not (cfg.get("base_url") and cfg.get("api_key")):
        raise SystemExit("set up Jarvis's brain first (接入大脑), or set JARVIS_LLM_BASE_URL / JARVIS_LLM_API_KEY")
    rules = (HERE / "naming_rules.md").read_text(encoding="utf-8")
    sf = lab / "batch_state.json"
    state = json.loads(sf.read_text()) if sf.exists() else {}
    done_by_pilot = {"brakeSystem_brakes_assembly_a01", "airSystem_compressor_a01"}      # already in the library
    cands = a.only or [d for d in top_dirs() if WANT.search(d) and not SKIP.search(d) and d not in done_by_pilot]
    log(f"{len(cands)} candidates, {sum(1 for v in state.values() if v['status'] == 'added')} already in the library")
    t0, added, tokens = time.time(), 0, 0
    for folder in cands:
        if added >= a.max or time.time() - t0 > a.hours * 3600:
            break
        if folder in state and not a.only:
            continue
        slug = "sr-" + re.sub(r"[^a-z0-9]+", "-", folder.lower()).strip("-")
        rec = {"at": time.strftime("%Y-%m-%d %H:%M")}
        try:
            log(f"== {folder}")
            usd = sr_fetch.fetch({"slug": slug, "repo": REPO, "dir": folder}, work)
            meta = {"title": folder, "aliases": [], "desc": "", "clusters": 6,
                    "source": f"huggingface.co/datasets/{REPO} · {folder} · {LIC}", "generic_say": ""}
            n, pts = simready_holo.convert(usd, tmp, slug, meta)
            if n < 3:
                rec.update(status="skipped", why=f"only {n} parts")
            else:
                png = holo_render.render(tmp / f"{slug}.holo.json", tmp / f"{slug}.png")
                info = meta["_info"]
                prompt = (rules + "\n\n模型文件夹名：" + folder + "\n整机尺寸（毫米）：" + str(info["overall_mm"]) +
                          "\n零件数据（编号 n 对应图里的圆圈编号）：\n" + json.dumps(info["parts"], ensure_ascii=False) +
                          '\n\n输出 JSON：{"object":"英文名","title_zh":"中文标题，如 汽车盘式刹车总成","aliases":["英文别名","中文别名"],'
                          '"desc":"两句中文简介","worth":true,"worth_reason":"","parts":{"0":{"name":"","say":"","basis":"","sure":true}}}')
                res, use = llm(cfg, prompt, png)
                tokens += int(use.get("total_tokens", 0))
                parts = res.get("parts", {})
                sure = sum(1 for p in info["parts"] if (parts.get(str(p["n"])) or {}).get("sure"))
                relabel(tmp / f"{slug}.html", tmp / f"{slug}.holo.json", res, info, folder)
                (tmp / f"{slug}.naming.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
                ok = bool(res.get("worth")) and sure >= 0.6 * n
                dest = holo if ok else review
                for ext in (".html", ".holo.json") + (() if ok else (".png", ".naming.json")):
                    shutil.move(str(tmp / f"{slug}{ext}"), str(dest / f"{slug}{ext}"))
                if ok:
                    shutil.move(str(tmp / f"{slug}.png"), str(review / f"{slug}.png"))   # keep the preview for checking
                    shutil.move(str(tmp / f"{slug}.naming.json"), str(review / f"{slug}.naming.json"))
                rec.update(status="added" if ok else "review", title=res.get("title_zh"), parts=n, sure=sure,
                           why=res.get("worth_reason", "") if not ok else "")
                added += ok
                log(f"   {'ADDED' if ok else 'REVIEW'} {res.get('title_zh')} · {n} parts, {sure} named with confidence")
        except Exception as e:
            rec.update(status="failed", why=repr(e)[:300])
            log(f"!! {folder}: {traceback.format_exc()[-600:]}")
        finally:
            shutil.rmtree(work / slug, ignore_errors=True)
            for f in tmp.glob(f"{slug}*"):
                f.unlink()
            state[folder] = rec
            sf.write_text(json.dumps(state, ensure_ascii=False, indent=1))
    c = {}
    for v in state.values():
        c[v["status"]] = c.get(v["status"], 0) + 1
    log(f"DONE this run: {added} added, {tokens} tokens. Overall: {c}")


if __name__ == "__main__":
    main()
