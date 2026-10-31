"""The 3D 拆解 library lists the machines that ship with Jarvis and can show one by its file."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jarvis import hologram


def main():
    items = hologram.catalog()
    built_in = [i for i in items if i["src"] == "内置"]
    assert len(built_in) >= 6, f"expected the shipped machines, got {[i['file'] for i in items]}"
    for i in built_in:
        assert i["title"] and i["parts"] >= 3, i
        assert i["thumb"].startswith("M"), f"no thumbnail for {i['file']}"
    sent = []
    hologram.UI = sent.append
    stem = built_in[0]["file"]
    hologram.show_file(stem)
    assert any(isinstance(m, dict) and m.get("type", "").startswith("machine") for m in sent), sent[:3]
    print(f"ok: {len(items)} items, showed {stem}")


if __name__ == "__main__":
    main()
