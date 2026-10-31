"""流浪地球计划 is an optional download: the voice/tool side and the local changes work without the network."""
import os, sys, tempfile
from pathlib import Path
os.environ["JARVIS_HOME"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jarvis import tools
from jarvis.plugins import earth_migration as em


def main():
    m = em.MAN
    assert len(m["commit"]) == 40 and len(m["files"]) > 50
    assert all(len(f["sha256"]) == 64 and f["size"] > 0 for f in m["files"])
    paths = {f["path"] for f in m["files"]}
    assert {"index.html", "beyond.html", "js/app.js", "LICENSE"} <= paths
    assert all(u.split("/")[2] for u in em.sources("index.html"))

    # the language model gets the tool, and the name forces it
    schemas, run, hints, force = tools.collect("打开流浪地球")
    assert "earth_migration" in run and force == "earth_migration", force
    assert tools.collect("今天天气怎么样")[3] != "earth_migration"

    sent = []
    em.UI = sent.append
    r = em.run("open", part=2)
    assert r["ok"] and "not downloaded" in r["doing"] and sent[-1]["on"] and sent[-1]["part"] == 2 and not sent[-1]["installed"]
    assert em.wants("关闭") == "earth_migration"            # it is open, so a short 关闭 closes it
    em.run("close")
    assert sent[-1] == {"type": "em", "on": False} and em.wants("关闭") is None

    # the two local changes, on stand-in files
    root = Path(tempfile.mkdtemp())
    (root / "css").mkdir(); (root / "js").mkdir()
    head = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            '<link href="https://fonts.googleapis.com/css2?family=Orbitron&display=swap" rel="stylesheet">\n')
    for p in ("index.html", "beyond.html"):
        (root / p).write_text(head, encoding="utf-8")
    (root / "js" / "app.js").write_text("const MOBILE = TOUCH || Math.min(innerWidth, innerHeight) < 700;\n", encoding="utf-8")
    em._localise(root)
    for p in ("index.html", "beyond.html"):
        s = (root / p).read_text(encoding="utf-8")
        assert "googleapis" not in s and "gstatic" not in s and 'href="css/fonts.css"' in s, s
    assert (root / "css" / "fonts.css").exists() and len(list((root / "fonts").glob("*.woff2"))) == 6
    assert "?lite" in (root / "js" / "app.js").read_text(encoding="utf-8")
    assert not em.installed() and em.url() == ""
    print("ok: earth_migration")


if __name__ == "__main__":
    main()
