"""Make the itch.io page background and banner from the game's own renders.
Run inside Blender (numpy + image IO):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P tools/itch_images.py -- <promo dir>
Writes <promo dir>/itch-background.jpg (2560 wide, fades into the page BG colour) and
<promo dir>/itch-banner.png (960 wide, the title plaque cut from <promo dir>/thumbnail-16x9.png,
a 1920x1080 capture of the game at ?shot=cover). <promo dir> defaults to ./promo.
"""
import pathlib
import sys

import bpy
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROMO = pathlib.Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else ROOT / "promo"
BG = np.array([0x0f, 0x0b, 0x0a], np.float32) / 255  # keep in sync with the BG colour in ITCH_PAGE.md


def load(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()  # row 0 = top
    bpy.data.images.remove(img)
    return a


def save(arr, path, fmt="PNG"):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(path.stem, w, h, alpha=True)
    img.pixels[:] = np.ascontiguousarray(arr[::-1]).ravel()
    img.filepath_raw = str(path)
    img.file_format = fmt
    if fmt == "JPEG":
        bpy.context.scene.render.image_settings.quality = 88
    img.save()
    bpy.data.images.remove(img)


def resize(a, w, h):
    """Area-average resample (good for downscaling)."""
    ys = (np.arange(h + 1) * a.shape[0] / h).astype(int)
    xs = (np.arange(w + 1) * a.shape[1] / w).astype(int)
    c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0), (0, 0))), 0), 1)
    s = c[ys[1:]][:, xs[1:]] - c[ys[:-1]][:, xs[1:]] - c[ys[1:]][:, xs[:-1]] + c[ys[:-1]][:, xs[:-1]]
    area = ((ys[1:] - ys[:-1])[:, None] * (xs[1:] - xs[:-1])[None, :])[..., None]
    return s / np.maximum(area, 1)


# --- Background: the whole nursery wall, dimmed, with a vignette that melts into the page colour
room = load(ROOT / "public" / "sprites" / "nursery" / "room.png")
H, W = room.shape[:2]
room = room[int(H * 0.1):int(H * 0.78)]          # cornice to skirting
out_w = 2560
out_h = int(round(room.shape[0] * out_w / W))
bg = resize(room, out_w, out_h)[..., :3]
bg = bg * 0.42                                    # dim, so the page column stays readable
yy, xx = np.mgrid[0:out_h, 0:out_w]
cx, cy = (xx / out_w - 0.5) / 0.62, (yy / out_h - 0.38) / 0.75
vig = np.clip(1 - (cx ** 2 + cy ** 2), 0, 1) ** 1.3
bottom = np.clip((out_h - yy) / (out_h * 0.35), 0, 1)[..., None]   # fade out fully at the bottom edge
t = (vig[..., None] * bottom)
bg = BG + (bg - BG) * t
save(np.concatenate([np.clip(bg, 0, 1), np.ones((out_h, out_w, 1), np.float32)], -1), PROMO / "itch-background.jpg", "JPEG")
print("background", out_w, out_h)

# --- Banner: the gilt title plaque, cut from the 16:9 thumbnail
thumb = load(PROMO / "thumbnail-16x9.png")
th, tw = thumb.shape[:2]
crop = thumb[int(th * 0.085):int(th * 0.52), int(tw * 0.155):int(tw * 0.845)]
bw = 960
bh = int(round(crop.shape[0] * bw / crop.shape[1]))
banner = resize(crop, bw, bh)
banner[..., 3] = 1
save(np.clip(banner, 0, 1), PROMO / "itch-banner.png")
print("banner", bw, bh)
