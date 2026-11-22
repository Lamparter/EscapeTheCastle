"""Render the player rig in its key poses (same maths as src/doll.ts) to a sheet for checking
proportions and joints. Run inside Blender:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P tools/pose_sheet.py -- out.png [scale]
"""
import json
import math
import pathlib
import sys

import bpy
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPR = ROOT / "public" / "sprites" / "nursery"
args = sys.argv[sys.argv.index("--") + 1:]
OUT_PATH = pathlib.Path(args[0])
UP = int(args[1]) if len(args) > 1 else 3
man = json.loads((SPR / "manifest.json").read_text())
info = man["pdoll"]
W, H, P = info["w"], info["h"], info["pivots"]
NAMES = ["pdoll_leg_l", "pdoll_leg_r", "pdoll_body", "pdoll_skirt", "pdoll_head", "pdoll_arm_l", "pdoll_arm_r"]


def load(name):
    img = bpy.data.images.load(str(SPR / f"{name}.png"))
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    return a


layers = {n: load(n) for n in NAMES if (SPR / f"{n}.png").exists()}
ph, pw = next(iter(layers.values())).shape[:2]
ppu = pw / W


def rot(deg):
    r = math.radians(deg)
    return np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])


def compose(p, out_w, out_h):
    """Inverse-map each output pixel into every layer (nearest), back to front."""
    canvas = np.zeros((out_h * UP, out_w * UP, 4), np.float32)
    ys, xs = np.mgrid[0:out_h * UP, 0:out_w * UP]
    world = np.stack([(xs + 0.5) / UP - out_w / 2, (ys + 0.5) / UP - (out_h - 6)], -1)  # feet at (0,0)
    # undo body transform: scale(sx,sy) then rotate(lean): world = R * S * local
    inv_body = np.linalg.inv(rot(p["lean"]) @ np.diag([p["sx"], p["sy"]]))
    local = world @ inv_body.T + np.array(P["feet"]) - np.array([0, p["bob"]])
    lift = 3.5 * H / 112 * p.get("walk", 0)
    spec = [
        ("pdoll_leg_l", "hip_l", p["legOut"] + p["legSwing"], -max(0, p.get("w", 0)) * lift, 1, 1),
        ("pdoll_leg_r", "hip_r", -p["legOut"] + p["legSwing"], -max(0, -p.get("w", 0)) * lift, 1, 1),
        ("pdoll_body", "waist", p["skirt"] * 0.25, 0, 1, 1),
        ("pdoll_skirt", "waist", p["skirt"], 0, p["skirtSx"], p["skirtSy"]),
        ("pdoll_head", "neck", p["head"], 0, 1, 1),
        ("pdoll_arm_l", "shoulder_l", p["armOut"] + p["armSwing"], 0, 1, 1),
        ("pdoll_arm_r", "shoulder_r", -p["armOut"] + p["armSwing"], 0, 1, 1),
    ]
    for name, piv, ang, dy, sx, sy in spec:
        if name not in layers:
            continue
        pv = np.array(P[piv]) + [0, dy]
        m = rot(ang) @ np.diag([sx, sy])
        src = (local - pv) @ np.linalg.inv(m).T + np.array(P[piv])
        px = (src[..., 0] * ppu).astype(int)
        py = (src[..., 1] * ppu).astype(int)
        ok = (px >= 0) & (px < pw) & (py >= 0) & (py < ph)
        lay = layers[name]
        c = np.zeros_like(canvas)
        c[ok] = lay[py[ok], px[ok]]
        a = c[..., 3:4]
        canvas[..., :3] = canvas[..., :3] * (1 - a) + c[..., :3] * a
        canvas[..., 3:4] = np.maximum(canvas[..., 3:4], a)
    return canvas


REST = dict(armOut=0, armSwing=0, legOut=0, legSwing=0, walk=0, head=0, skirt=0, lean=0, bob=0, sx=1, sy=1, skirtSx=1, skirtSy=1)
POSES = {
    "rest": REST,
    "idle": {**REST, "armOut": 3, "head": -4},
    "walk L": {**REST, "walk": 1, "w": 1, "armOut": 7, "armSwing": 16, "legSwing": 6, "lean": 8, "skirt": -4, "head": -3},
    "walk R": {**REST, "walk": 1, "w": -1, "armOut": 7, "armSwing": -16, "legSwing": -6, "lean": -2, "skirt": 4, "head": 3},
    "rise": {**REST, "armOut": 118, "legOut": -4, "skirtSx": 1.12, "skirtSy": 0.92, "head": -4},
    "fall": {**REST, "armOut": 110, "armSwing": 6, "legOut": 12, "legSwing": 8, "skirtSx": 1.2, "skirtSy": 0.84, "head": 8},
    "fall2": {**REST, "armOut": 90, "armSwing": -6, "legOut": 12, "legSwing": -8, "skirtSx": 1.2, "skirtSy": 0.84, "head": 8, "lean": 14},
    "sink": {**REST, "sy": 0.7, "sx": 1.16, "armOut": 60, "legOut": 8, "head": 6, "skirtSx": 1.15},
    "carry": {**REST, "armOut": 148},
}
ow, oh = int(W * 2.4), int(H * 1.35)
tiles = [compose(p, ow, oh) for p in POSES.values()]
sheet = np.concatenate(tiles, axis=1)
bg = np.zeros_like(sheet)
bg[..., :3] = (0.36, 0.33, 0.28)
bg[..., 3] = 1
for i in range(1, len(tiles)):
    bg[:, i * ow * UP - 1, :3] = 0.2
out = bg * (1 - sheet[..., 3:4]) + np.concatenate([sheet[..., :3], np.ones_like(sheet[..., :1])], -1) * sheet[..., 3:4]
img = bpy.data.images.new("sheet", out.shape[1], out.shape[0], alpha=True)
img.pixels[:] = np.ascontiguousarray(out[::-1]).ravel()
img.filepath_raw = str(OUT_PATH)
img.file_format = "PNG"
img.save()
print("poses:", list(POSES))
