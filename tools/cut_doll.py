"""Turn the Rijksmuseum bisque doll photo (BK-1972-141, CC0) into the goth ballerina's animation layers.

Run inside Blender (numpy + image IO), after rendering the costume (`gballet` in tools/sprites.json):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P tools/cut_doll.py -- [--preview out.png]
Then check every pose with tools/pose_sheet.py.

1. Mask her out of the grey studio photo (by colour), fill the eye sockets, drop specks.
2. Split her into head, arms, legs and body; keep only the connected piece of each part (this
   removes stray threads and fragments of neighbouring parts).
3. Recolour: blonde curls -> black, cloth body/limbs -> black, bisque -> cold pale porcelain.
4. Re-proportion her like a dancer: torso shortened, legs lengthened (joints move accordingly).
5. Dress her: black lace ruff over the neck seam, satin bodice, layered tulle tutu at the hips,
   satin pointe shoes with ribbons (attached to the leg layers so they move with the legs).
6. Write every layer (same size) to public/sprites/nursery/pdoll_*.png, with joints + hitbox.
Afterwards regenerate src/sprites.generated.ts (e.g. `render_sprites.py -- key`).
"""
import json
import pathlib
import sys

import bpy
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "source" / "images" / "bisque_doll.jpg"
OUT = ROOT / "public" / "sprites" / "nursery"
WORK = ROOT / "art" / "source" / "generated"      # costume renders are inputs only; they don't ship
COSTUME = ("gballet_bodice", "gballet_collar", "gballet_tutu", "gballet_shoe")
OBSOLETE = ("gskirt",)
PREVIEW = "--preview" in sys.argv

HEIGHT = 168   # height of the output frame in game units (1.5x the original 112)
PPU = 3        # output pixels per game unit

# --- Source photo landmarks (fractions; x right, y down), measured on the gridded preview
NECK_Y, SHOULDER_Y, HIP_Y, FEET_Y = 0.252, 0.30, 0.585, 0.935
ARM_SPLIT_L, ARM_SPLIT_R, LEG_SPLIT = 0.33, 0.703, 0.515
BODY_L, BODY_R, SLEEVE_Y = 0.335, 0.665, 0.40   # below the shoulders the body is only bodice-wide; the arms take the sleeves
FACE = (0.51, 0.185, 0.112, 0.064)   # face oval: centre x, y, radii (everything else on the head is hair)
SEEDS = {"head": (0.5, 0.15), "arm_l": (0.27, 0.45), "arm_r": (0.74, 0.45), "leg_l": (0.42, 0.8), "leg_r": (0.58, 0.8), "body": (0.5, 0.42)}

# --- Re-proportioning (dancer-like): torso x0.72, legs x1.15
TORSO_K, LEG_K = 0.72, 1.15
D_HIP = SHOULDER_Y + (HIP_Y - SHOULDER_Y) * TORSO_K            # 0.505
D_FEET = D_HIP + (FEET_Y - HIP_Y) * LEG_K                       # 0.9075
CROP = (0.17, 0.045, 0.85, 0.93)                                # output frame, in *destination* fractions

# Joints in destination fractions
JOINTS = {
    "neck": (0.5, 0.25), "shoulder_l": (0.315, 0.315), "shoulder_r": (0.685, 0.315),
    "hip_l": (0.42, D_HIP), "hip_r": (0.6, D_HIP), "waist": (0.5, D_HIP - 0.02), "feet": (0.5, 0.922),
}
# Costume placement boxes (destination fractions x0, y0, x1, y1)
COLLAR_BOX = (0.39, 0.236, 0.61, 0.29)
BODICE_BOX = (0.335, 0.29, 0.665, D_HIP + 0.01)
TUTU_BOX = (0.08, D_HIP - 0.055, 0.92, D_HIP + 0.075)
SHOE_L_BOX = (0.37, 0.80, 0.475, 0.925)
SHOE_R_BOX = (0.525, 0.80, 0.63, 0.925)


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


def flood(region, seeds, step=3):
    """Pixels of `region` connected to any seed (x, y fractions), on a downsampled grid."""
    small = region[::step, ::step]
    h, w = small.shape
    reach = np.zeros_like(small)
    for fx, fy in seeds:
        y, x = int(fy * h), int(fx * w)
        # nudge the seed onto the region if it lands just off it
        ys, xs = np.nonzero(small[max(0, y - 6):y + 7, max(0, x - 6):x + 7])
        if len(ys):
            reach[max(0, y - 6) + ys[0], max(0, x - 6) + xs[0]] = True
    while True:
        grown = reach | np.roll(reach, 1, 0) | np.roll(reach, -1, 0) | np.roll(reach, 1, 1) | np.roll(reach, -1, 1)
        grown &= small
        if (grown == reach).all():
            break
        reach = grown
    big = np.repeat(np.repeat(reach, step, 0), step, 1)[: region.shape[0], : region.shape[1]]
    return region & shift_or(big, step)


def fill_holes(m, step=4):
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


def doll_mask(a):
    """The backdrop and her shadow are neutral grey; the doll is warmer/more saturated."""
    rgb = a[..., :3]
    sat = rgb.max(-1) - rgb.min(-1)
    warm = rgb[..., 0] - rgb[..., 2]
    m = (sat > 0.05) & (warm > 0.035)
    m = ~shift_or(~m, 1)
    m = shift_or(m, 2)
    m = ~shift_or(~m, 1)
    m = fill_holes(m)
    return shift_or(~shift_or(~m, 4), 4) & m   # opening: drop slivers


def grade_black(lay, keep_light=0.35):
    """Neutral, cold black fabric (keeping folds); light details (lacing, ribbons' sheen) stay pale."""
    l = lay[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lay[..., :3] = np.where(l[..., None] > keep_light, l[..., None] * np.array([0.8, 0.8, 0.85]),
                            (l[..., None] ** 1.1) * np.array([0.6, 0.6, 0.68]))
    return lay


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    for n in COSTUME:   # fresh renders land in the sprite folder: move them out of the game
        if (OUT / f"{n}.png").exists():
            (OUT / f"{n}.png").replace(WORK / f"{n}.png")
    for n in OBSOLETE:
        (OUT / f"{n}.png").unlink(missing_ok=True)
    a = load(SRC)
    H, W = a.shape[:2]
    m = doll_mask(a)
    yy, xx = np.mgrid[0:H, 0:W]
    fx, fy = xx / W, yy / H

    if PREVIEW:
        prev = a.copy()
        prev[~m, :3] = prev[~m, :3] * 0.3 + np.array([0.2, 0.6, 1.0]) * 0.7
        for f in np.arange(0.05, 1.0, 0.05):
            col = [1, 0, 0] if abs(f * 10 - round(f * 10)) < 1e-6 else [1, 0.7, 0.2]
            prev[int(H * f) - 2:int(H * f) + 2, :, :3] = col
            prev[:, int(W * f) - 2:int(W * f) + 2, :3] = col
        save(prev[::3, ::3], pathlib.Path(sys.argv[sys.argv.index("--preview") + 1]))
        return

    # --- 1-2. parts, each reduced to its connected piece
    regions = {
        "head": m & (fy < NECK_Y),
        "arm_l": m & (fx < ARM_SPLIT_L) & (fy >= NECK_Y - 0.01),
        "arm_r": m & ((fx > ARM_SPLIT_R) | ((fx > BODY_R) & (fy < SLEEVE_Y))) & (fy >= NECK_Y - 0.01),
    }
    legs = m & (fy >= HIP_Y) & ~regions["arm_l"] & ~regions["arm_r"]
    regions["leg_l"] = legs & (fx < LEG_SPLIT)
    regions["leg_r"] = legs & (fx >= LEG_SPLIT)
    regions["body"] = m & ~regions["head"] & ~regions["arm_l"] & ~regions["arm_r"] & ~legs
    # the body keeps no sleeve: below the shoulders it is only as wide as the bodice
    regions["body"] &= (fy < SHOULDER_Y + 0.015) | ((fx > BODY_L) & (fx < BODY_R))
    # the outline's outermost pixels carry backdrop colour: erode the outline (not the cuts between parts)
    inner = ~shift_or(~m, 3)
    parts = {k: flood(v, [SEEDS[k]]) & inner for k, v in regions.items()}

    # --- 3. recolour
    rgb = a[..., :3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    pink = (r - g) > 0.045
    hair = m & (fy < 0.25) & ((g - b) > 0.1) & (np.abs(r - g) < 0.14)
    fx0, fy0, frx, fry = FACE
    outside_face = ((fx - fx0) / frx) ** 2 + ((fy - fy0) / fry) ** 2 > 1
    hair = (shift_or(hair, 1) | (outside_face & (fy < NECK_Y - 0.012))) & m & (fy < 0.26)
    plate = (fy >= NECK_Y - 0.01) & (fy < 0.305) & (fx > 0.34) & (fx < 0.66)
    forearms = (fy > 0.385) & ((fx < ARM_SPLIT_L) | (fx > ARM_SPLIT_R)) & pink
    skin = ~hair & ((fy < NECK_Y) | plate | forearms)
    parts["head"] &= hair | pink        # drop backdrop shadow caught around the curls
    out = rgb.copy()
    out[hair] = (lum[hair, None] ** 1.4) * np.array([0.22, 0.19, 0.2])
    cloth = ~hair & ~skin
    out[cloth] = (lum[cloth, None] ** 1.2) * np.array([0.12, 0.115, 0.13])
    sk = lum[skin, None]
    out[skin] = sk * np.array([0.93, 0.9, 0.92]) * 0.95 + (rgb[skin] - sk) * 0.25
    l2 = out @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    out = (l2[..., None] + (out - l2[..., None]) * 0.8) * 0.9
    rgba = np.concatenate([np.clip(out, 0, 1), np.ones((H, W, 1), np.float32)], -1)

    # --- 4. re-proportion while resampling into the output frame
    x0, y0, x1, y1 = CROP
    oh = int(round(HEIGHT * PPU))
    ow = int(round(oh * (x1 - x0) * W / ((y1 - y0) * H)))

    def src_y(d, part):
        """Destination y fraction -> source y fraction, per part."""
        if part in ("leg_l", "leg_r"):
            return HIP_Y + (d - D_HIP) / LEG_K
        if part == "body":
            return np.where(d <= SHOULDER_Y, d, SHOULDER_Y + (d - SHOULDER_Y) / TORSO_K)
        return d  # head and arms keep their place

    def layer(part):
        dy = y0 + (np.arange(oh) + 0.5) / oh * (y1 - y0)
        dx = x0 + (np.arange(ow) + 0.5) / ow * (x1 - x0)
        sy = np.clip((src_y(dy, part) * H).astype(int), 0, H - 1)
        sx = np.clip((dx * W).astype(int), 0, W - 1)
        # 3x3 supersample for smooth edges
        acc = np.zeros((oh, ow, 4), np.float32)
        mask = parts[part].astype(np.float32)
        step = max(1, int(H / oh / 2))
        for oy in (-step, 0, step):
            for ox in (-step, 0, step):
                yy_ = np.clip(sy + oy, 0, H - 1)[:, None]
                xx_ = np.clip(sx + ox, 0, W - 1)[None, :]
                c = rgba[yy_, xx_].copy()
                c[..., 3] = mask[yy_, xx_]
                acc += c
        acc /= 9
        if part in ("body", "leg_l", "leg_r"):
            # parts drawn behind others overlap them by a pixel, so the cuts never show as seams
            a_ = acc[..., 3]
            grown = np.maximum.reduce([np.roll(np.roll(a_, dy_, 0), dx_, 1) for dy_ in (-1, 0, 1) for dx_ in (-1, 0, 1)])
            acc[..., 3] = grown
        return acc

    layers = {k: layer(k) for k in parts}
    to_game = lambda f: ((f[0] - x0) / (x1 - x0) * ow / PPU, (f[1] - y0) / (y1 - y0) * oh / PPU)

    # --- 5. costume
    def place(name, box, flip=False):
        src = load(WORK / f"{name}.png")
        sh, sw = src.shape[:2]
        al = src[..., 3] > 0.5
        ys_, xs_ = np.nonzero(al)
        bx0, bx1, by0, by1 = xs_.min(), xs_.max() + 1, ys_.min(), ys_.max() + 1
        tx0, ty0 = to_game((box[0], box[1]))
        tx1, ty1 = to_game((box[2], box[3]))
        res = np.zeros((oh, ow, 4), np.float32)
        ys, xs = np.mgrid[0:oh, 0:ow]
        gx, gy = (xs + 0.5) / PPU, (ys + 0.5) / PPU
        u = (gx - tx0) / (tx1 - tx0)
        if flip:
            u = 1 - u
        fxs = bx0 + u * (bx1 - bx0)
        fys = by0 + (gy - ty0) / (ty1 - ty0) * (by1 - by0)
        sx_ = abs((bx1 - bx0) / ((tx1 - tx0) * PPU)) / 3   # box-filter the (larger) render
        sy_ = abs((by1 - by0) / ((ty1 - ty0) * PPU)) / 3
        for oy in (-1, 0, 1):
            for ox in (-1, 0, 1):
                px = (fxs + ox * sx_).astype(int)
                py = (fys + oy * sy_).astype(int)
                ok = (px >= 0) & (px < sw) & (py >= 0) & (py < sh)
                c = np.zeros_like(res)
                c[ok] = src[py[ok], px[ok]]
                c[..., :3] *= c[..., 3:4]
                res += c / 9
        res[..., :3] /= np.maximum(res[..., 3:4], 1e-4)
        return grade_black(res)

    def over(base, top):
        t = top[..., 3:4]
        base[..., :3] = base[..., :3] * (1 - t) + top[..., :3] * t
        base[..., 3:4] = np.maximum(base[..., 3:4], t)

    over(layers["body"], place("gballet_bodice", BODICE_BOX))
    over(layers["body"], place("gballet_collar", COLLAR_BOX))
    over(layers["leg_l"], place("gballet_shoe", SHOE_L_BOX))
    over(layers["leg_r"], place("gballet_shoe", SHOE_R_BOX, flip=True))
    tutu = place("gballet_tutu", TUTU_BOX)

    named = {
        "pdoll_head": layers["head"], "pdoll_arm_l": layers["arm_l"], "pdoll_arm_r": layers["arm_r"],
        "pdoll_leg_l": layers["leg_l"], "pdoll_leg_r": layers["leg_r"], "pdoll_body": layers["body"], "pdoll_skirt": tutu,
    }
    full = np.zeros((oh, ow, 4), np.float32)
    for n in ("pdoll_leg_l", "pdoll_leg_r", "pdoll_body", "pdoll_skirt", "pdoll_head", "pdoll_arm_l", "pdoll_arm_r"):
        over(full, named[n])
    named["pdoll"] = full
    for n, lay in named.items():
        save(np.clip(lay, 0, 1), OUT / f"{n}.png")

    # --- 6. manifest
    man_path = OUT / "manifest.json"
    man = json.loads(man_path.read_text())
    for n in COSTUME + OBSOLETE:
        man.pop(n, None)
    pivots = {k: [round(float(v[0]), 1), round(float(v[1]), 1)] for k, v in ((k, to_game(f)) for k, f in JOINTS.items())}
    ys, xs = np.nonzero(full[..., 3] > 0.5)
    bbox = [round(float(xs.min()) / PPU, 1), round(float(ys.min()) / PPU, 1),
            round(float(xs.max() + 1 - xs.min()) / PPU, 1), round(float(ys.max() + 1 - ys.min()) / PPU, 1)]
    for n in named:
        man[n] = {"w": round(ow / PPU, 1), "h": round(oh / PPU, 1), "source": "Rijksmuseum BK-1972-141 (CC0) + rendered costume",
                  "bbox": bbox, "rects": [], "pivots": pivots}
    man_path.write_text(json.dumps(man, indent=1), encoding="utf-8")
    print("doll layers", list(named), "size", round(ow / PPU, 1), round(oh / PPU, 1), "bbox", bbox)


main()
