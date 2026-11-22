"""Cut the Rijksmuseum bisque doll photo (CC0) into animation layers, and make her Gothic.

Run inside Blender (for numpy + image IO), after rendering the dress layers:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P tools/cut_doll.py -- [--preview]

Steps: remove the grey studio background; split the photo into head, arms, legs and body using
the regions below (fractions of the photo); recolour (blonde curls -> black, cloth -> black
stockings/sleeves, bisque -> cold pale porcelain); composite the rendered Gothic dress
(gdress_torso / gdress_skirt, from tools/sprites.json) over her body; write every layer at the
same size into public/sprites/nursery/pdoll_*.png and record joints + hitbox in the manifest.
"""
import json
import math
import pathlib
import sys

import bpy
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "source" / "images" / "bisque_doll.jpg"
OUT = ROOT / "public" / "sprites" / "nursery"
PREVIEW = "--preview" in sys.argv

# Size of the doll in game units (height of the photo crop) and output resolution.
HEIGHT = 112
PPU = 3

# Regions, as fractions of the photo (x right, y down). Tuned by eye on the gridded preview.
CROP = (0.17, 0.045, 0.85, 0.94)          # x0, y0, x1, y1 around the doll
NECK_Y = 0.252                            # head (with curls) above this line
SHOULDER_Y = 0.30
ARM_SPLIT_L = 0.33                        # left arm is left of this x (below the shoulders)
ARM_SPLIT_R = 0.703                       # right arm is right of this x
HIP_Y = 0.585                             # legs below this line
LEG_SPLIT = 0.5                           # left / right leg
JOINTS = {                                # pivots, in photo fractions
    "neck": (0.5, 0.25), "shoulder_l": (0.315, 0.315), "shoulder_r": (0.685, 0.315),
    "hip_l": (0.42, 0.585), "hip_r": (0.6, 0.585), "waist": (0.5, 0.5), "feet": (0.5, 0.935),
}
# Where the rendered Gothic dress goes (photo fractions x0, y0, x1, y1): the bodice from the
# neckline to the waist, the flared skirt from the waist to just below the knees.
BODICE_BOX = (0.3, 0.272, 0.7, 0.53)
SKIRT_BOX = (0.2, 0.455, 0.8, 0.79)


def load(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    return a


def save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(path.stem, w, h, alpha=True)
    img.pixels[:] = np.ascontiguousarray(arr[::-1]).ravel()
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def shift_or(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def fill_holes(m, step=4):
    """Fill enclosed holes (eye sockets, dark creases): flood the outside from the border on a
    downsampled grid, and everything not reached is the doll."""
    small = m[::step, ::step]
    outside = np.zeros_like(small)
    outside[0, :] = ~small[0, :]; outside[-1, :] = ~small[-1, :]; outside[:, 0] = ~small[:, 0]; outside[:, -1] = ~small[:, -1]
    while True:
        grown = outside | np.roll(outside, 1, 0) | np.roll(outside, -1, 0) | np.roll(outside, 1, 1) | np.roll(outside, -1, 1)
        grown &= ~small
        if (grown == outside).all():
            break
        outside = grown
    inside = np.repeat(np.repeat(~outside, step, 0), step, 1)[: m.shape[0], : m.shape[1]]
    return m | (inside & ~shift_or(~inside, 1))


def background_mask(a):
    """The backdrop and her shadow are neutral grey; the doll (cream cloth, pink bisque, blonde
    hair) is warmer/more saturated. Mask by colour, clean up, then fill interior holes."""
    rgb = a[..., :3]
    sat = rgb.max(-1) - rgb.min(-1)
    warm = rgb[..., 0] - rgb[..., 2]
    m = (sat > 0.05) & (warm > 0.035)
    m = ~shift_or(~m, 1)          # drop specks
    m = shift_or(m, 2)            # close small gaps
    m = ~shift_or(~m, 1)
    return fill_holes(m), None


def main():
    a = load(SRC)
    H, W = a.shape[:2]
    m, bg = background_mask(a)
    # Opening: remove slivers a few pixels wide (stray threads, edge artefacts) without
    # changing the silhouette.
    m = shift_or(~shift_or(~m, 4), 4) & m
    yy, xx = np.mgrid[0:H, 0:W]
    fx, fy = xx / W, yy / H

    if PREVIEW:
        prev = a.copy()
        prev[~m, :3] = prev[~m, :3] * 0.3 + np.array([0.2, 0.6, 1.0]) * 0.7
        for f in np.arange(0.05, 1.0, 0.05):
            col = [1, 0, 0] if abs(f * 10 - round(f * 10)) < 1e-6 else [1, 0.7, 0.2]
            prev[int(H * f) - 2:int(H * f) + 2, :, :3] = col
            prev[:, int(W * f) - 2:int(W * f) + 2, :3] = col
        for name, (jx, jy) in JOINTS.items():
            prev[int(jy * H) - 9:int(jy * H) + 9, int(jx * W) - 9:int(jx * W) + 9, :3] = [0, 1, 0]
        small = prev[::3, ::3]
        save(small, pathlib.Path(sys.argv[sys.argv.index("--preview") + 1]))
        return

    # --- recolour: hair -> black, cloth -> black, bisque -> cold porcelain
    rgb = a[..., :3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    hair = m & (fy < 0.25) & ((g - b) > 0.1) & (np.abs(r - g) < 0.14)
    hair = shift_or(hair, 1) & m & (fy < 0.26)
    # Bisque (by position): the face, the shoulder plate, and the forearms + hands. Everything else
    # of the body is cloth, dyed black.
    plate = (fy >= NECK_Y - 0.01) & (fy < 0.305) & (fx > 0.34) & (fx < 0.66)
    pink = (r - g) > 0.045
    forearms = (fy > 0.385) & ((fx < ARM_SPLIT_L) | (fx > ARM_SPLIT_R)) & pink
    skin = m & ~hair & ((fy < NECK_Y) | plate | forearms)
    # Around the head, the mask also caught some of her shadow on the backdrop (greyish, neither
    # hair nor pink bisque): drop it.
    m = m & ~((fy < NECK_Y) & ~hair & ~pink)
    skin &= m
    cloth = m & ~hair & ~skin
    out = rgb.copy()
    out[hair] = (lum[hair, None] ** 1.4) * np.array([0.22, 0.19, 0.2])          # black ringlets with sheen
    out[cloth] = (lum[cloth, None] ** 1.2) * np.array([0.13, 0.12, 0.14])       # black stockings / sleeves
    sk = lum[skin, None]
    out[skin] = sk * np.array([0.93, 0.9, 0.92]) * 0.95 + (rgb[skin] - sk) * 0.25   # desaturated, cooler bisque
    # Overall: darken and desaturate a touch to sit in the night-time room
    l2 = out @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    out = l2[..., None] + (out - l2[..., None]) * 0.8
    out *= 0.9
    rgba = np.concatenate([np.clip(out, 0, 1), m[..., None].astype(np.float32)], -1)

    # --- part masks
    head = m & (fy < NECK_Y)
    arm_l = m & (fx < ARM_SPLIT_L) & (fy >= NECK_Y - 0.01)
    arm_r = m & (fx > ARM_SPLIT_R) & (fy >= NECK_Y - 0.01)
    legs = m & (fy >= HIP_Y) & ~arm_l & ~arm_r
    leg_l, leg_r = legs & (fx < LEG_SPLIT), legs & (fx >= LEG_SPLIT)
    body = m & ~head & ~arm_l & ~arm_r & ~legs
    # Overlap the seams a little so joints don't open up gaps when rotated
    body |= m & shift_or(head, 6) & (fy >= NECK_Y - 0.012) & ~arm_l & ~arm_r
    body |= m & shift_or(legs, 6) & (fy < HIP_Y + 0.015) & ~arm_l & ~arm_r

    # --- crop + resample to game resolution
    x0, y0, x1, y1 = (int(CROP[0] * W), int(CROP[1] * H), int(CROP[2] * W), int(CROP[3] * H))
    ch = y1 - y0
    scale = HEIGHT * PPU / ch
    ow, oh = int(round((x1 - x0) * scale)), int(round(ch * scale))

    def resample(img):
        sy = (np.arange(oh) + 0.5) / scale + y0
        sx = (np.arange(ow) + 0.5) / scale + x0
        # box-filtered downsample: average a small neighbourhood
        acc = np.zeros((oh, ow, img.shape[2]), np.float32)
        k = max(1, int(1 / scale))
        n = 0
        for oy in range(k):
            for ox in range(k):
                yi = np.clip((sy - 0.5 / scale + (oy + 0.5) / scale / k).astype(int), 0, H - 1)
                xi = np.clip((sx - 0.5 / scale + (ox + 0.5) / scale / k).astype(int), 0, W - 1)
                acc += img[yi][:, xi]
                n += 1
        return acc / n

    def layer(mask):
        lay = rgba.copy()
        lay[..., 3] = lay[..., 3] * mask
        out = resample(lay)
        # un-premultiply-ish: keep colour where alpha exists
        return out

    to_game = lambda f: ((f[0] * W - x0) * scale / PPU, (f[1] * H - y0) * scale / PPU)

    # --- the rendered Gothic dress, fitted to her
    man_path = OUT / "manifest.json"
    man = json.loads(man_path.read_text())
    layers = {
        "pdoll_head": layer(head), "pdoll_arm_l": layer(arm_l), "pdoll_arm_r": layer(arm_r),
        "pdoll_leg_l": layer(leg_l), "pdoll_leg_r": layer(leg_r), "pdoll_body": layer(body),
    }
    skirt = np.zeros((oh, ow, 4), np.float32)

    def place(name, box):
        """Map a rendered dress layer's visible bbox onto a target box (photo fractions x0, y0, x1, y1)."""
        src = load(OUT / f"{name}.png")
        sh, sw = src.shape[:2]
        al = src[..., 3] > 0.5
        sy_, sx_ = np.nonzero(al)
        bx0, bx1, by0, by1 = sx_.min(), sx_.max() + 1, sy_.min(), sy_.max() + 1
        tx0, ty0 = to_game((box[0], box[1]))
        tx1, ty1 = to_game((box[2], box[3]))
        out = np.zeros((oh, ow, 4), np.float32)
        ys, xs = np.mgrid[0:oh, 0:ow]
        gx, gy = (xs + 0.5) / PPU, (ys + 0.5) / PPU
        px = (bx0 + (gx - tx0) / (tx1 - tx0) * (bx1 - bx0)).astype(int)
        py = (by0 + (gy - ty0) / (ty1 - ty0) * (by1 - by0)).astype(int)
        ok = (px >= 0) & (px < sw) & (py >= 0) & (py < sh)
        out[ok] = src[py[ok], px[ok]]
        return out

    if (OUT / "gskirt.png").exists():
        skirt = place("gskirt", SKIRT_BOX)
        # Grade the rendered skirt like the dyed cloth: neutral, cold black velvet (keeping its
        # folds), with the lace ruffle staying pale.
        sl = skirt[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        skirt[..., :3] = np.where(sl[..., None] > 0.35, sl[..., None] * np.array([0.82, 0.82, 0.86]),
                                  (sl[..., None] ** 1.1) * np.array([0.55, 0.55, 0.62]))
    layers["pdoll_skirt"] = skirt

    # Full composite (for the hitbox): back to front
    full = np.zeros((oh, ow, 4), np.float32)
    for name in ("pdoll_leg_l", "pdoll_leg_r", "pdoll_body", "pdoll_skirt", "pdoll_head", "pdoll_arm_l", "pdoll_arm_r"):
        lay = layers[name]
        al = lay[..., 3:4]
        full[..., :3] = full[..., :3] * (1 - al) + lay[..., :3] * al
        full[..., 3:4] = np.maximum(full[..., 3:4], al)
    layers["pdoll"] = full

    sys.path.insert(0, str(ROOT / "tools"))
    for name, lay in layers.items():
        save(np.clip(lay, 0, 1), OUT / f"{name}.png")

    # Manifest entries (same size for every layer; joints in game units from the top-left)
    gw, gh = ow / PPU, oh / PPU
    pivots = {k: [round(v[0], 1), round(v[1], 1)] for k, v in ((k, to_game(f)) for k, f in JOINTS.items())}
    alpha = full[..., 3] > 0.5
    ys, xs = np.nonzero(alpha)
    bbox = [round(xs.min() / PPU, 1), round(ys.min() / PPU, 1), round((xs.max() + 1 - xs.min()) / PPU, 1), round((ys.max() + 1 - ys.min()) / PPU, 1)]
    for name in layers:
        man[name] = {"w": round(gw, 1), "h": round(gh, 1), "source": "Rijksmuseum BK-1972-141 (CC0) + rendered dress",
                     "bbox": bbox, "rects": [], "pivots": pivots}
    man_path.write_text(json.dumps(man, indent=1), encoding="utf-8")
    print("doll layers", list(layers), "size", gw, gh, "bbox", bbox)


main()
