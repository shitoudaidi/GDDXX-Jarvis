"""SimReady (OpenUSD) model -> Jarvis teardown hologram (anatomy-holo-1 point cloud + figure page).

python simready_holo.py MODEL.usd OUT_DIR --slug simready-crx10ia --meta meta.json

Parts come from the model itself: its rigid bodies (robots: one per link, ordered along the joint chain), else the
top-level groups of the model, else spatial clusters. Points are sampled on the real triangle surfaces (kind 1),
along sharp feature edges and outlines (kind 0), with a few bright accents (kind 2). Needs usd-core and numpy."""
import argparse, base64, json, math, re, struct, sys
from pathlib import Path

import numpy as np
from pxr import Usd, UsdGeom, UsdPhysics

SPAN = 230.0            # the model's longest side in hologram units (the HUD stage is about +-130)
SURF = 40000            # surface points
EDGE = 22000            # wire points
MAXP = 12               # most parts on screen
SKIP = re.compile(r"collision|collider|proxy|_coll\b|convex|physics_?mesh|sdf", re.I)
rng = np.random.default_rng(7)
COMMON = {             # part-name hints shared by every model (regex on the USD prim name -> 中文名 + 一句讲解)
    r"rotor|disc|disk": {"name": "刹车盘", "say": "和车轮一起转的铸铁圆盘，刹车片夹住它把动能变成热。"},
    r"caliper": {"name": "卡钳", "say": "跨在刹车盘上，里面的活塞被液压推动，把刹车片压向刹车盘。"},
    r"pad": {"name": "摩擦垫", "say": "直接承受摩擦的那一层，磨薄了就要更换。"},
    r"piston": {"name": "活塞", "say": "液压推着它向外走，把力传给后面的零件。"},
    r"bracket|mount": {"name": "支架", "say": "把总成固定在车架或底座上，承受反作用力。"},
    r"hub": {"name": "轮毂", "say": "车轮装在它上面，中间是轴承。"},
    r"shield|dust": {"name": "防尘罩", "say": "挡住泥水和碎石，保护里面的摩擦面。"},
    r"hose|pipe|line": {"name": "管路", "say": "输送液体或气体的管子。"},
    r"tank|reservoir": {"name": "储罐", "say": "储存压缩空气或液体，让输出更平稳。"},
    r"motor": {"name": "电机", "say": "把电能变成转动，带动整台机器。"},
    r"pump|compressor|cylinder|head": {"name": "压缩泵头", "say": "活塞在气缸里往复运动，把空气压缩后送进储罐。"},
    r"gauge|meter|dial": {"name": "压力表", "say": "显示罐内或输出的压力。"},
    r"regulator|valve": {"name": "阀门", "say": "控制压力和流量，超压时还能泄放。"},
    r"switch": {"name": "开关", "say": "压力到了自动停机，降下来再启动。"},
    r"wheel|caster": {"name": "轮子", "say": "方便推着走。"},
    r"handle|grip": {"name": "把手", "say": "搬运时握住的地方。"},
    r"guard|cover|shroud|housing|case": {"name": "护罩", "say": "罩住转动或发热的部分，防止碰伤。"},
    r"belt|pulley": {"name": "皮带轮", "say": "把电机的转动传给泵头。"},
    r"filter": {"name": "滤清器", "say": "过滤进入的空气，挡住灰尘。"},
    r"bolt|screw|nut|pin": {"name": "紧固件", "say": "把各个零件锁在一起。"},
    r"frame|chassis": {"name": "机架", "say": "所有零件都装在它上面。"},
    r"base": {"name": "底座", "say": "整台设备的基础，里面通常装着驱动和电路。"},
}


def log(*a):
    print(*a, flush=True)


# ---------- read the meshes ----------
MATS = []               # material subset names seen in the model (index = value in each mesh's "Mt")

def meshes(stage):
    cache = UsdGeom.XformCache()
    out = []
    pred = Usd.TraverseInstanceProxies(Usd.PrimDefaultPredicate)
    for prim in stage.Traverse(pred):
        if not prim.IsA(UsdGeom.Mesh) or SKIP.search(prim.GetPath().pathString):
            continue
        img = UsdGeom.Imageable(prim)
        if img.ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue
        if img.ComputePurpose() in (UsdGeom.Tokens.guide, UsdGeom.Tokens.proxy):
            continue
        m = UsdGeom.Mesh(prim)
        pts, cnt, idx = m.GetPointsAttr().Get(), m.GetFaceVertexCountsAttr().Get(), m.GetFaceVertexIndicesAttr().Get()
        if not pts or not cnt or not idx:
            continue
        P = np.asarray(pts, dtype=np.float64)
        C = np.asarray(cnt, dtype=np.int64)
        I = np.asarray(idx, dtype=np.int64)
        if len(C) == 0 or C.sum() != len(I):
            continue
        # fan-triangulate every polygon
        starts = np.concatenate([[0], np.cumsum(C)[:-1]])
        tris, fid = [], []
        for k in range(3, int(C.max()) + 1):
            sel = starts[C >= k]
            tris.append(np.stack([I[sel], I[sel + k - 2], I[sel + k - 1]], 1))
            fid.append(np.flatnonzero(C >= k))
        T = np.concatenate(tris) if tris else np.zeros((0, 3), np.int64)
        FT = np.concatenate(fid) if fid else np.zeros(0, np.int64)
        fmat = np.full(len(C), -1, np.int64)                  # material subset of each face (GeomSubset names)
        try:
            for sub in UsdGeom.Subset.GetAllGeomSubsets(UsdGeom.Imageable(prim)):
                ids = np.asarray(sub.GetIndicesAttr().Get() or [], dtype=np.int64)
                ids = ids[(ids >= 0) & (ids < len(C))]
                name = sub.GetPrim().GetName()
                if name not in MATS:
                    MATS.append(name)
                fmat[ids] = MATS.index(name)
        except Exception:
            pass
        if not len(T) or T.max() >= len(P):
            continue
        M = np.asarray(cache.GetLocalToWorldTransform(prim), dtype=np.float64)   # row vectors: p' = [p 1] M
        W = np.c_[P, np.ones(len(P))] @ M
        out.append({"prim": prim, "V": W[:, :3], "T": T, "Mt": fmat[FT]})
    return out


# ---------- group meshes into parts ----------
def body_of(prim):
    p = prim
    while p and p.GetPath().pathString != "/":
        if p.HasAPI(UsdPhysics.RigidBodyAPI):
            return p
        p = p.GetParent()
    return None


def chain_depth(stage, bodies):
    """Depth of each rigid body along the joint tree (base = 0)."""
    paths = {b.GetPath() for b in bodies}
    kids, parent_of = {}, {}
    for prim in stage.Traverse(Usd.TraverseInstanceProxies(Usd.PrimDefaultPredicate)):
        if not prim.IsA(UsdPhysics.Joint):
            continue
        j = UsdPhysics.Joint(prim)
        b0, b1 = j.GetBody0Rel().GetTargets(), j.GetBody1Rel().GetTargets()
        if not b0 or not b1:
            continue
        a, b = b0[0], b1[0]
        if a in paths and b in paths and b not in parent_of:
            parent_of[b] = a
            kids.setdefault(a, []).append(b)
    depth = {}
    for p in paths:
        d, q, seen = 0, p, set()
        while q in parent_of and q not in seen:
            seen.add(q); q = parent_of[q]; d += 1
        depth[p] = d
    return depth if parent_of else None


def mesh_area(m):
    V, T = m["V"], m["T"]
    return float(np.linalg.norm(np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]), axis=1).sum() / 2)


def group(stage, ms):
    for m in ms:
        m["area"] = mesh_area(m)
    # 1. rigid bodies
    bodies = {}
    for m in ms:
        b = body_of(m["prim"])
        if b is not None:
            bodies.setdefault(b.GetPath(), []).append(m)
    if len(bodies) >= 2 and sum(len(v) for v in bodies.values()) >= 0.8 * len(ms):
        depth = chain_depth(stage, [stage.GetPrimAtPath(p) for p in bodies]) or {}
        return [{"key": p.name, "ms": v, "depth": depth.get(p)} for p, v in bodies.items()], bool(depth)
    # 2. hierarchy: descend while a single child holds every mesh
    root = stage.GetDefaultPrim() or stage.GetPseudoRoot()
    def under(prim):
        s = prim.GetPath().pathString + "/"
        return [m for m in ms if (m["prim"].GetPath().pathString + "/").startswith(s)]
    groups = [(root, ms)]
    for _ in range(12):
        if len(groups) >= 4:
            break
        groups.sort(key=lambda g: -sum(m["area"] for m in g[1]))
        prim, gm = groups[0]
        kids = [(c, under(c)) for c in prim.GetFilteredChildren(Usd.TraverseInstanceProxies(Usd.PrimDefaultPredicate))]
        kids = [k for k in kids if k[1]]
        if len(kids) <= 1:
            if kids:
                groups[0] = kids[0]
                continue
            break
        groups = kids + groups[1:]
    out = [{"key": g[0].GetName(), "ms": g[1]} for g in groups]
    return out, False


def kmeans_split(part, k=6):
    """One big part -> k spatial clusters of its triangles (for models that are a single mesh)."""
    cents, refs, area = [], [], []
    for mi, m in enumerate(part["ms"]):
        V, T = m["V"], m["T"]
        c = V[T].mean(1)
        cents.append(c); refs.append(np.c_[np.full(len(T), mi), np.arange(len(T))])
        area.append(np.linalg.norm(np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]), axis=1) / 2)
    X, R, A = np.concatenate(cents), np.concatenate(refs), np.concatenate(area)
    ctr = X[rng.choice(len(X), k, replace=False, p=A / A.sum())]
    for _ in range(20):
        lab = np.argmin(((X[:, None, :] - ctr[None]) ** 2).sum(2), 1)
        for j in range(k):
            w = lab == j
            if w.any():
                ctr[j] = np.average(X[w], axis=0, weights=A[w] + 1e-12)
    out = []
    for j in range(k):
        w = lab == j
        if not w.any():
            continue
        ms = []
        for mi in np.unique(R[w, 0]):
            sel = R[w & (R[:, 0] == mi), 1]
            m = part["ms"][mi]
            ms.append({"prim": m["prim"], "V": m["V"], "T": m["T"][sel], "Mt": m["Mt"][sel], "area": 0})
        out.append({"key": f"{part['key']}_{j + 1}", "ms": ms})
    return out


def components(V, T):
    """Label each triangle with its connected piece (vertices welded first)."""
    q = np.round(V / (np.ptp(V, 0).max() * 1e-5 + 1e-12)).astype(np.int64)
    _, w = np.unique(q, axis=0, return_inverse=True)
    TT = w.reshape(-1)[T]
    L = np.arange(TT.max() + 1)
    a, b = np.r_[TT[:, 0], TT[:, 1]], np.r_[TT[:, 1], TT[:, 2]]
    while True:
        old = L.copy()
        m = np.minimum(L[a], L[b])
        np.minimum.at(L, a, m); np.minimum.at(L, b, m)
        for _ in range(6):
            L = L[L]
        if (L == old).all():
            return L[TT[:, 0]]


def comp_split(part, budget):
    """A part that is one mesh of many loose solids (housing, gaskets, bolts...) -> its big solids as parts,
    identical small solids (a ring of bolts) as one part, the rest stuck to the nearest big solid."""
    items = []                                   # (mesh index, triangle indices, area, centroid, ntri)
    for mi, m in enumerate(part["ms"]):
        V, T = m["V"], m["T"]
        if not len(T):
            continue
        lab = components(V, T)
        A = np.linalg.norm(np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]), axis=1) / 2
        Cc = V[T].mean(1)
        for u in np.unique(lab):
            sel = np.flatnonzero(lab == u)
            a = A[sel].sum()
            if a <= 0:
                continue
            items.append((mi, sel, a, (Cc[sel] * A[sel, None]).sum(0) / a, len(sel)))
    if len(items) < 2:
        return [part]
    total = sum(i[2] for i in items)
    items.sort(key=lambda i: -i[2])
    big = [i for i in items if i[2] >= 0.025 * total][:max(1, budget)]
    rest = [i for i in items if not any(i is b for b in big)]
    sig = {}
    for i in rest:
        sig.setdefault((i[4], round(float(i[2]) / total, 4)), []).append(i)
    reps = sorted([g for g in sig.values() if len(g) >= 3], key=lambda g: -sum(i[2] for i in g))
    reps = reps[:max(0, budget - len(big))]
    inrep = {id(i) for g in reps for i in g}
    groups = [[b] for b in big] + reps
    for i in rest:
        if id(i) in inrep:
            continue
        j = int(np.argmin([np.linalg.norm(i[3] - b[3]) for b in big]))
        groups[j].append(i)
    out = []
    for k, g in enumerate(groups):
        ms = []
        for mi in sorted({i[0] for i in g}):
            sel = np.concatenate([i[1] for i in g if i[0] == mi])
            m = part["ms"][mi]
            ms.append({"prim": m["prim"], "V": m["V"], "T": m["T"][sel], "Mt": m["Mt"][sel], "area": 0})
        rep = k >= len(big)
        out.append({"key": f"{part['key']}_{'rep' if rep else ''}{k + 1 if not rep else k - len(big) + 1}",
                    "ms": ms, "parent": part["key"], "count": len(g) if rep else 1})
    return out


# ---------- sample points ----------
def tri_arrays(part):
    tri = [m["V"][m["T"]] for m in part["ms"] if len(m["T"])]
    return np.concatenate(tri) if tri else np.zeros((0, 3, 3))


def surface(tris, n):
    if n <= 0 or not len(tris):
        return np.zeros((0, 3))
    a = np.linalg.norm(np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]), axis=1)
    if a.sum() <= 0:
        return np.zeros((0, 3))
    pick = rng.choice(len(tris), n, p=a / a.sum())
    u, v = rng.random(n), rng.random(n)
    f = u + v > 1
    u[f], v[f] = 1 - u[f], 1 - v[f]
    t = tris[pick]
    return t[:, 0] + (t[:, 1] - t[:, 0]) * u[:, None] + (t[:, 2] - t[:, 0]) * v[:, None]


def feature_edges(part, angle=32.0):
    segs = []
    cosmax = math.cos(math.radians(angle))
    for m in part["ms"]:
        V, T = m["V"], m["T"]
        if not len(T):
            continue
        # weld coincident vertices so split normals don't turn every edge into a boundary
        q = np.round(V / (np.ptp(V, 0).max() * 1e-5 + 1e-12)).astype(np.int64)
        _, wid = np.unique(q, axis=0, return_inverse=True)
        wid = wid.reshape(-1)
        TT = wid[T]
        N = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
        nl = np.linalg.norm(N, axis=1)
        ok = nl > 0
        TT, Tv, N = TT[ok], T[ok], N[ok] / nl[ok, None]
        e = np.concatenate([TT[:, [0, 1]], TT[:, [1, 2]], TT[:, [2, 0]]])
        ev = np.concatenate([Tv[:, [0, 1]], Tv[:, [1, 2]], Tv[:, [2, 0]]])
        f = np.tile(np.arange(len(TT)), 3)
        key = np.sort(e, 1)
        order = np.lexsort((key[:, 1], key[:, 0]))
        key, ev, f = key[order], ev[order], f[order]
        same = np.r_[False, (key[1:] == key[:-1]).all(1)]
        first = ~same
        grp = np.cumsum(first) - 1
        cnt = np.bincount(grp)
        i0 = np.flatnonzero(first)
        keep = cnt[grp[i0]] == 1                               # boundary edges
        two = cnt[grp[i0]] == 2
        d = np.einsum("ij,ij->i", N[f[i0[two]]], N[f[i0[two] + 1]])
        sharp = np.zeros_like(keep)
        sharp[np.flatnonzero(two)[d < cosmax]] = True
        sel = i0[keep | sharp]
        segs.append(np.stack([V[ev[sel, 0]], V[ev[sel, 1]]], 1))
    return np.concatenate(segs) if segs else np.zeros((0, 2, 3))


def along(segs, n):
    if n <= 0 or not len(segs):
        return np.zeros((0, 3))
    L = np.linalg.norm(segs[:, 1] - segs[:, 0], axis=1)
    if L.sum() <= 0:
        return np.zeros((0, 3))
    pick = rng.choice(len(segs), n, p=L / L.sum())
    t = rng.random(n)[:, None]
    s = segs[pick]
    return s[:, 0] + (s[:, 1] - s[:, 0]) * t


# ---------- main ----------
def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "part"


def convert(usd, out_dir, slug, meta):
    stage = Usd.Stage.Open(str(usd), load=Usd.Stage.LoadAll)
    if not stage:
        raise SystemExit(f"cannot open {usd}")
    MATS.clear()
    ms = meshes(stage)
    if not ms:
        raise SystemExit("no visible meshes in the model")
    parts, chain = group(stage, ms)
    if not chain and len(parts) < 4:              # few meshes: take each apart into its loose solids
        budget = max(2, MAXP // len(parts))
        parts = [q for p in parts for q in comp_split(p, budget)]
    if len(parts) == 1:
        parts = kmeans_split(parts[0], meta.get("clusters", 6))
    for p in parts:
        p["tris"] = tri_arrays(p)
        p["area"] = float(np.linalg.norm(np.cross(p["tris"][:, 1] - p["tris"][:, 0], p["tris"][:, 2] - p["tris"][:, 0]), axis=1).sum() / 2) if len(p["tris"]) else 0
    parts = [p for p in parts if p["area"] > 0]
    if len(parts) > MAXP:                                     # keep the biggest, fold the rest into one
        parts.sort(key=lambda p: -p["area"])
        rest = parts[MAXP - 1:]
        parts = parts[:MAXP - 1] + [{"key": "other", "ms": sum((p["ms"] for p in rest), []),
                                     "tris": np.concatenate([p["tris"] for p in rest]), "area": sum(p["area"] for p in rest)}]
    # stage axes -> z up, centred, scaled
    up = UsdGeom.GetStageUpAxis(stage)
    def toz(X):
        X = X.reshape(-1, 3)
        return np.c_[X[:, 0], -X[:, 2], X[:, 1]] if up == UsdGeom.Tokens.y else X
    allv = np.concatenate([toz(p["tris"]) for p in parts])
    lo, hi = allv.min(0), allv.max(0)
    ctr, scale = (lo + hi) / 2, SPAN / max(float((hi - lo).max()), 1e-9)
    tf = lambda X: (toz(X) - ctr) * scale
    for p in parts:
        p["T3"] = tf(p["tris"]).reshape(-1, 3, 3)
        p["E"] = tf(feature_edges(p)).reshape(-1, 2, 3)
        p["c"] = p["T3"].reshape(-1, 3).mean(0)
        p["a"] = p["area"] * scale * scale
    # names
    names = meta.get("parts", {})
    order_names = meta.get("chain", [])
    if chain:
        parts.sort(key=lambda p: (p.get("depth") or 0))
    else:
        parts.sort(key=lambda p: -p["a"])
    used = set()
    for i, p in enumerate(parts):
        pid = slugify(p["key"])
        while pid in used:
            pid += "-b"
        used.add(pid); p["id"] = pid
        info = None
        for pat, v in list(names.items()) + list(COMMON.items()):
            if re.search(pat, p["key"], re.I):
                info = dict(v)
                side = "（左）" if re.search(r"left|_l\b", p["key"], re.I) else "（右）" if re.search(r"right|_r\b", p["key"], re.I) else ""
                if side and "左" not in info["name"] and "右" not in info["name"]:
                    info["name"] += side
                break
        if info is None and chain and i < len(order_names):
            info = order_names[i]
        if info is None:
            info = {"name": p["key"].replace("_", " "), "say": meta.get("generic_say", "原模型里的一个独立部件。")}
        p["name"], p["say"] = info["name"], info.get("say", "")
    # point budgets: bigger parts get more, small ones still show
    w = np.array([p["a"] ** 0.6 for p in parts]); w = w / w.sum()
    elen = np.array([np.linalg.norm(p["E"][:, 1] - p["E"][:, 0], axis=1).sum() if len(p["E"]) else 0 for p in parts])
    ew = elen ** 0.7 / max((elen ** 0.7).sum(), 1e-9)
    rows = []
    for i, p in enumerate(parts):
        ns = max(600, int(SURF * w[i]))
        ne = max(300, int(EDGE * ew[i])) if len(p["E"]) else 0
        S = surface(p["T3"], ns)
        E = along(p["E"], ne)
        if not len(E):                                     # smooth part: use a sparse wire from its own surface instead
            E = surface(p["T3"], max(300, ns // 3))
        acc = E[rng.choice(len(E), max(8, len(E) // 40), replace=False)] if len(E) else np.zeros((0, 3))
        for X, kind in ((E, 0), (S, 1), (acc, 2)):
            rows += [(x, y, z, kind, i) for x, y, z in X]
    # explode moves
    C = np.average([p["c"] for p in parts], axis=0, weights=[p["a"] for p in parts])
    moves = {}
    if chain:
        base = parts[0]["c"]
        step = min(40.0, 110.0 / max(1, max((p.get("depth") or 0) for p in parts)))
        for p in parts:
            d = p["c"] - base
            n = np.linalg.norm(d)
            u = d / n if n > 1e-6 else np.array([0, 0, 1.0])
            k = p.get("depth") or 0
            moves[p["id"]] = (u * step * k + np.array([0, 0, 0.25 * step * k])).round(1).tolist()
    else:
        dist = [float(np.linalg.norm(p["c"] - C)) for p in parts]
        rank = np.argsort(np.argsort(dist)) / max(len(parts) - 1, 1)
        for i, p in enumerate(parts):
            d = p["c"] - C
            n = np.linalg.norm(d)
            u = d / n if n > 3 else np.array([0, 0, 1.0])
            moves[p["id"]] = (u * (70 + 70 * rank[i])).round(1).tolist()
        moves[parts[0]["id"]] = [0.0, 0.0, 0.0] if np.linalg.norm(parts[0]["c"] - C) < 15 else moves[parts[0]["id"]]
        fam = {}
        for p in parts:
            if p.get("parent"):
                fam.setdefault(p["parent"], []).append(p)
        if len(fam) >= 1 and len(fam) < len(parts):
            # parents spread apart radially; inside each, solids come off their main solid
            pc = {k: np.average([q["c"] for q in v], axis=0, weights=[q["a"] for q in v]) for k, v in fam.items()}
            Cf = np.average(list(pc.values()), axis=0, weights=[sum(q["a"] for q in v) for v in fam.values()])
            for k, v in fam.items():
                d = pc[k] - Cf; n = np.linalg.norm(d)
                base = d / n * 50 if n > 3 and len(fam) > 1 else np.zeros(3)
                main = max(v, key=lambda q: q["a"])
                T3 = np.concatenate([q["T3"].reshape(-1, 3) for q in v])
                thin = np.zeros(3); thin[int(np.argmin(np.ptp(T3, 0)))] = 1.0
                ds = sorted(float(np.linalg.norm(q["c"] - main["c"])) for q in v)
                for q in v:
                    off = q["c"] - main["c"]; n2 = np.linalg.norm(off)
                    if q is main:
                        u = np.zeros(3)
                    elif n2 > 4:
                        u = off / n2
                    else:
                        u = thin * (1 if (q["c"] - main["c"]) @ thin >= 0 else -1)
                    r = (ds.index(float(np.linalg.norm(q["c"] - main["c"]))) + 1) / len(v)
                    moves[q["id"]] = (base + u * (30 + 45 * r) * (0 if q is main else 1)).round(1).tolist()
    ids = [p["id"] for p in parts]
    stagger = sorted(ids, key=lambda i: -np.linalg.norm(moves[i]))
    # write the point cloud
    rows = rows[:70000]
    buf = bytearray()
    for x, y, z, kind, i in rows:
        buf += struct.pack("<hhhBB", int(max(-32767, min(32767, x * 10))), int(max(-32767, min(32767, y * 10))),
                           int(max(-32767, min(32767, z * 10))), kind, i)
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    holo = {"format": "anatomy-holo-1", "scale": 0.1, "pieces": ids, "moves": moves, "count": len(rows),
            "points": base64.b64encode(bytes(buf)).decode()}
    (out_dir / f"{slug}.holo.json").write_text(json.dumps(holo), encoding="utf-8")
    # figure page (the HUD reads its parts, names and narration)
    title = meta.get("title", slug)
    label = f'{title}: {", ".join(meta.get("aliases", []))}. {meta.get("desc", "")}'.replace('"', "'")
    g = []
    for k, p in enumerate(parts):
        x, y = 50 + (k % 4) * 205, 50 + (k // 4) * 120
        m = ",".join(f"{v:.1f}" for v in moves[p["id"]])
        g.append(f'<g class="it" data-k="{k}" data-piece="{p["id"]}" data-m="{m}"><rect class="iso-fill" x="{x}" y="{y}" '
                 f'width="150" height="80" rx="6"/><path class="iso-edge" d="M{x},{y} h150 v80 h-150 z"/></g>')
    D = {"W": 900, "H": 900, "V": [0.8, -0.6, 0.45], "EX": [1, 0, 0], "EY": [0, 1, 0], "EZ": [0, 0, 1],
         "camera": {"k": 1, "origin": [450, 450]},
         "pieces": {p["id"]: {"name": p["name"], "say": p["say"]} for p in parts}, "stagger": stagger, "order": ids}
    src = meta.get("source", "")
    page = (f'<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>{title}</title><style>body{{background:#0b0b0b;'
            f'color:#a3a3a3;font:13px ui-monospace,Menlo,monospace;margin:24px}}svg{{width:min(90vw,900px);height:auto}}'
            f'.iso-fill{{fill:#16232b}}.iso-edge{{fill:none;stroke:#5fb7d4;stroke-width:1}}</style></head><body>'
            f'<p>Jarvis anatomy figure · 由 SimReady 模型转换。来源：{src}</p>'
            f'<svg class="iso" viewBox="0 0 900 900" role="img" aria-label="{label}">{"".join(g)}</svg>'
            f'<script>\nconst D = {json.dumps(D, ensure_ascii=False)};\n</script></body></html>')
    (out_dir / f"{slug}.html").write_text(page, encoding="utf-8")
    log(f"{slug}: {len(parts)} parts, {len(rows)} points ({'joint chain' if chain else 'groups'})")
    for p in parts:
        log(f"  {p['id']:<28} {p['name']}  move={moves[p['id']]}")
    # what each part is made of, how big it really is, where it sits: clues for naming it later
    mpu = UsdGeom.GetStageMetersPerUnit(stage) or 0.01
    info = []
    for i, p in enumerate(parts):
        acc = {}
        for m in p["ms"]:
            if not len(m["T"]) or "Mt" not in m:
                continue
            V, T = m["V"], m["T"]
            A = np.linalg.norm(np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]), axis=1)
            for mi in np.unique(m["Mt"]):
                acc[int(mi)] = acc.get(int(mi), 0.0) + float(A[m["Mt"] == mi].sum())
        tot = sum(acc.values()) or 1
        mats = [(MATS[k] if 0 <= k < len(MATS) else "?", round(v / tot, 2)) for k, v in sorted(acc.items(), key=lambda kv: -kv[1])][:3]
        ext = np.ptp(p["T3"].reshape(-1, 3), 0) / scale * mpu * 1000
        info.append({"n": i, "id": p["id"], "usd_name": p["key"], "parent": p.get("parent") or "",
                     "copies": p.get("count", 1), "materials": mats, "size_mm": [round(float(x)) for x in ext],
                     "centre": [round(float(x)) for x in p["c"]], "move": moves[p["id"]], "share_of_surface": round(p["a"] / sum(q["a"] for q in parts), 3)})
    meta["_info"] = {"parts": info, "overall_mm": [round(float(x)) for x in (hi - lo) * mpu * 1000], "chain": chain}
    return len(parts), len(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("usd"); ap.add_argument("out")
    ap.add_argument("--slug", required=True); ap.add_argument("--meta")
    a = ap.parse_args()
    meta = json.loads(Path(a.meta).read_text(encoding="utf-8")) if a.meta else {}
    convert(a.usd, a.out, a.slug, meta)
