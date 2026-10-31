"""Numbered preview of a teardown hologram (assembled | taken apart), for the namer to look at. Needs numpy + Pillow."""
import base64, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

COLS = [(255, 90, 90), (90, 200, 255), (255, 200, 60), (120, 255, 120), (220, 120, 255), (255, 140, 40), (60, 255, 220),
        (255, 255, 255), (160, 160, 255), (255, 120, 200), (180, 255, 60), (120, 200, 160)]


def _font(size):
    for f in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            pass
    try:
        return ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


def _view(P, pid, n, W, numbers):
    v = np.array([0.8, -0.6, 0.45]); v /= np.linalg.norm(v)
    r = np.cross([0, 0, 1.0], v); r /= np.linalg.norm(r); u = np.cross(v, r)
    X, Y = P @ r, P @ u
    s = W * 0.86 / max(np.ptp(X), np.ptp(Y), 1e-6)
    px = (W / 2 + (X - (X.max() + X.min()) / 2) * s).astype(int).clip(0, W - 1)
    py = (W / 2 - (Y - (Y.max() + Y.min()) / 2) * s).astype(int).clip(0, W - 1)
    arr = np.full((W, W, 3), (8, 10, 14), np.uint8)
    for j in range(n):
        m = pid == j
        arr[py[m], px[m]] = COLS[j % len(COLS)]
    im = Image.fromarray(arr)
    if numbers:
        d, f = ImageDraw.Draw(im), _font(26)
        for j in range(n):
            m = pid == j
            if not m.any():
                continue
            x, y = float(np.median(px[m])), float(np.median(py[m]))
            d.ellipse((x - 19, y - 19, x + 19, y + 19), fill=(0, 0, 0), outline=COLS[j % len(COLS)], width=3)
            d.text((x, y), str(j), fill=COLS[j % len(COLS)], font=f, anchor="mm")
    return im


def render(holo_path, out_png, W=800):
    H = json.loads(open(holo_path, encoding="utf-8").read())
    a = np.frombuffer(base64.b64decode(H["points"]),
                      dtype=np.dtype([("x", "<i2"), ("y", "<i2"), ("z", "<i2"), ("k", "u1"), ("p", "u1")]))
    P = np.c_[a["x"], a["y"], a["z"]] / 10.0
    mv = np.array([H["moves"][i] for i in H["pieces"]])
    n = len(H["pieces"])
    left = _view(P, a["p"], n, W, False)
    right = _view(P + mv[a["p"]], a["p"], n, W, True)
    out = Image.new("RGB", (W * 2 + 10, W), (30, 34, 40))
    out.paste(left, (0, 0)); out.paste(right, (W + 10, 0))
    out.save(out_png)
    return out_png
