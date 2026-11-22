"""Render 3D models to game sprites with one shared camera, lighting and colour grade.

Usage (from the repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P tools/render_sprites.py -- [name ...]

Reads tools/sprites.json, renders each sprite (or only the named ones) to <outDir>/<name>.png and
writes src/sprites.generated.ts with each sprite's size in game units (bottom-centre pivot).

A sprite either imports a Poly Haven "model" or uses a procedural "build" from tools/procedural.py.
"passes" renders several sprites from one camera, each showing only some parts (all aligned).
"""
import json
import math
import pathlib
import sys

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "source" / "polyhaven"
WORK = ROOT / "art" / "source" / "generated"
sys.path.insert(0, str(ROOT / "tools"))
import procedural  # noqa: E402

# --- Look: shared by every sprite so they match ---
KEY = {"color": (1.0, 0.72, 0.45), "strength": 3.2, "rot": (math.radians(50), 0, math.radians(-35))}   # warm candlelight, upper left/front
RIM = {"color": (0.55, 0.66, 1.0), "strength": 2.4, "rot": (math.radians(60), 0, math.radians(150))}   # cool moonlight from behind right
FILL = {"color": (0.9, 0.85, 0.95), "strength": 0.35, "rot": (math.radians(80), 0, math.radians(10))}  # faint front fill
WORLD = (0.015, 0.012, 0.02)
GRADE_SATURATION = 0.7   # 1 = unchanged
GRADE_VALUE = 0.92       # brightness multiplier
GRADE_WARMTH = 0.03      # push towards warm
SAMPLES = 96


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (*WORLD, 1)
    scene.world = world
    for name, l in (("Key", KEY), ("Rim", RIM), ("Fill", FILL)):
        data = bpy.data.lights.new(name, "SUN")
        data.color = l["color"]
        data.energy = l["strength"]
        data.angle = math.radians(8)
        obj = bpy.data.objects.new(name, data)
        obj.rotation_euler = Euler(l["rot"])
        scene.collection.objects.link(obj)
    return scene


def import_model(model: str):
    gltf = next((SRC / model).glob("*.gltf"), None)
    if gltf is None:
        raise FileNotFoundError(f"{model}: run python tools/fetch_polyhaven.py first")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(gltf))
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new("Root", None)
    bpy.context.scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    return root, [o for o in new if o.type == "MESH"]


def world_verts(meshes):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        ev = o.evaluated_get(deps)
        m = ev.to_mesh()
        mw = o.matrix_world
        arr = np.empty(len(m.vertices) * 3, dtype=np.float64)
        m.vertices.foreach_get("co", arr)
        arr = arr.reshape(-1, 3)
        mat = np.array(mw)
        pts.append(arr @ mat[:3, :3].T + mat[:3, 3])
        ev.to_mesh_clear()
    return np.concatenate(pts)


def render_still(path: pathlib.Path, grade=None):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if grade is not None:
        grade_image(path, **grade)


def alpha_mask(path: pathlib.Path):
    """Alpha channel of a PNG as a (rows, cols) array, top row first."""
    img = bpy.data.images.load(str(path))
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, 3]
    bpy.data.images.remove(img)
    return a


def collision_shape(path: pathlib.Path, ppu: float, cell: float = 4.0, fill: float = 0.35):
    """Hitbox data from the sprite's visible pixels, in game units relative to its top-left corner.

    bbox: tight box around opaque pixels. rects: the opaque area as a few merged rectangles
    (a grid of `cell`-unit squares, solid where >= `fill` of the pixels are opaque).
    """
    a = alpha_mask(path) > 0.5
    rows, cols = a.shape
    ys, xs = np.nonzero(a)
    if len(xs) == 0:
        return {"bbox": [0, 0, 0, 0], "rects": []}
    bbox = [xs.min() / ppu, ys.min() / ppu, (xs.max() + 1 - xs.min()) / ppu, (ys.max() + 1 - ys.min()) / ppu]
    cp = max(1, int(round(cell * ppu)))
    gr, gc = -(-rows // cp), -(-cols // cp)
    padded = np.zeros((gr * cp, gc * cp), dtype=bool)
    padded[:rows, :cols] = a
    grid = padded.reshape(gr, cp, gc, cp).mean(axis=(1, 3)) >= fill
    # Merge: horizontal runs per row, then stack identical runs down the rows.
    open_rects = {}
    rects = []
    for r in range(gr + 1):
        runs = set()
        if r < gr:
            c = 0
            while c < gc:
                if grid[r, c]:
                    c0 = c
                    while c < gc and grid[r, c]:
                        c += 1
                    runs.add((c0, c))
                else:
                    c += 1
        for key in list(open_rects):
            if key not in runs:
                r0 = open_rects.pop(key)
                rects.append((key[0], r0, key[1] - key[0], r - r0))
        for key in runs:
            open_rects.setdefault(key, r)
    unit = cp / ppu
    def clip(x, y, w, h):
        w = min(w, cols / ppu - x); h = min(h, rows / ppu - y)
        return [round(x, 1), round(y, 1), round(w, 1), round(h, 1)]
    return {
        "bbox": [round(float(v), 1) for v in bbox],
        "rects": [clip(c * unit, r * unit, w * unit, h * unit) for (c, r, w, h) in rects],
    }


def render_background(cfg, defaults, out_dir: pathlib.Path):
    """A room shell rendered with an exact world<->pixel mapping (1 Blender unit = 100 game units,
    Blender Z = (760 - world y) / 100), so the image lines up with the level's geometry."""
    scene = reset_scene()
    WORK.mkdir(parents=True, exist_ok=True)
    _root, _meshes, parts = procedural.BUILDERS[cfg["build"]]({**cfg, "_work_dir": WORK}, import_model=import_model, render_still=render_still)
    bg = cfg["background"]
    x0, y0, w, h, ppu = bg["x0"], bg["y0"], bg["w"], bg["h"], bg["ppu"]
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(w, h) / 100
    cam_data.clip_end = 200
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = ((x0 + w / 2) / 100, -50, (760 - (y0 + h / 2)) / 100)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.render.resolution_x = round(w * ppu)
    scene.render.resolution_y = round(h * ppu)
    scene.cycles.samples = cfg.get("samples", 64)
    results = {}
    for name, show in cfg["passes"].items():
        for part, objs in parts.items():
            for o in objs:
                o.hide_render = part not in show
        out = out_dir / f"{name}.png"
        render_still(out, grade=cfg.get("grade", {}))
        top, height = y0, h
        crop = cfg.get("crop", {}).get(name)
        if crop:
            top, height = crop[0], crop[1] - crop[0]
            img = bpy.data.images.load(str(out))
            px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
            r0 = round((y0 + h - crop[1]) * ppu)  # pixel rows are stored bottom-up
            r1 = round((y0 + h - crop[0]) * ppu)
            cut = px[r0:r1].copy()
            bpy.data.images.remove(img)
            new = bpy.data.images.new(name, cut.shape[1], cut.shape[0], alpha=True)
            new.pixels[:] = cut.ravel()
            new.filepath_raw = str(out)
            new.file_format = "PNG"
            new.save()
            bpy.data.images.remove(new)
        results[name] = {"w": w, "h": height, "x": x0, "y": top, "source": cfg["build"]}
    return results


def render_sprite(cfg, defaults, out_dir: pathlib.Path):
    if cfg.get("background"):
        return render_background(cfg, defaults, out_dir)
    scene = reset_scene()
    if cfg.get("build"):
        WORK.mkdir(parents=True, exist_ok=True)
        root, meshes, parts = procedural.BUILDERS[cfg["build"]](
            {**cfg, "_work_dir": WORK}, import_model=import_model, render_still=render_still)
    else:
        root, meshes = import_model(cfg["model"])
        parts = {"all": meshes}
    root.rotation_euler = (0, 0, math.radians(cfg.get("yaw", 0)))
    bpy.context.view_layer.update()

    # Sit the model on the ground, centred.
    v = world_verts(meshes)
    lo, hi = v.min(axis=0), v.max(axis=0)
    root.location = Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))
    bpy.context.view_layer.update()
    v = world_verts(meshes)

    # Orthographic camera looking along +Y, tilted slightly down.
    tilt = math.radians(cfg.get("tilt", defaults["tiltDegrees"]))
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    rot = Euler((math.pi / 2 - tilt, 0, 0)).to_matrix()
    cam.rotation_euler = Euler((math.pi / 2 - tilt, 0, 0))

    # Fit tightly: project every vertex into camera space.
    inv = np.array(rot.transposed())
    local = v @ inv.T
    x0, x1 = local[:, 0].min(), local[:, 0].max()
    y0, y1 = local[:, 1].min(), local[:, 1].max()
    z_near = local[:, 2].max()
    ex, ey = x1 - x0, y1 - y0
    margin = 1.01
    centre_local = Vector(((x0 + x1) / 2, (y0 + y1) / 2, z_near + 10))
    cam.location = rot @ centre_local
    cam_data.clip_end = 100
    cam_data.ortho_scale = max(ex, ey) * margin

    # Size in game units -> pixels.
    units_per_m = cfg["size"] / (ex if cfg["fit"] == "width" else ey)
    game_w, game_h = ex * margin * units_per_m, ey * margin * units_per_m
    ppu = defaults["pixelsPerUnit"]
    scene.render.resolution_x = max(4, round(game_w * ppu))
    scene.render.resolution_y = max(4, round(game_h * ppu))

    # Joint positions (for cut-out rigs), in game units from the sprite's top-left.
    pivots = {}
    for o in parts.get("_pivots", []):
        q = np.array(rot.transposed()) @ np.array(o.matrix_world.translation)
        gx = ((q[0] - (x0 + x1) / 2) / (ex * margin) + 0.5) * game_w
        gy = (0.5 - (q[1] - (y0 + y1) / 2) / (ey * margin)) * game_h
        pivots[o.name.split(":", 1)[1]] = [round(float(gx), 1), round(float(gy), 1)]

    # One render per pass; every pass shares this camera so the layers line up.
    passes = cfg.get("passes") or {cfg["name"]: None}
    results = {}
    for name, show in passes.items():
        for part, objs in parts.items():
            for o in objs:
                o.hide_render = show is not None and part not in show
        out = out_dir / f"{name}.png"
        render_still(out, grade={})
        results[name] = {"w": round(float(game_w), 1), "h": round(float(game_h), 1), "source": cfg.get("model") or cfg["build"],
                         **collision_shape(out, ppu, cfg.get("cell", 4.0))}
        if pivots:
            results[name]["pivots"] = pivots
    return results


def grade_image(path: pathlib.Path, saturation=GRADE_SATURATION, value=GRADE_VALUE, warmth=GRADE_WARMTH):
    img = bpy.data.images.load(str(path))
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    lum = (rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[:, None]
    rgb = lum + (rgb - lum) * saturation
    rgb *= value
    rgb[:, 0] *= 1 + warmth
    rgb[:, 2] *= 1 - warmth
    px[:, :3] = np.clip(rgb, 0, 1)
    img.pixels[:] = px.ravel()
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    config = json.loads((ROOT / "tools" / "sprites.json").read_text(encoding="utf-8"))
    out_dir = ROOT / config["outDir"]
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for cfg in config["sprites"]:
        if argv and cfg["name"] not in argv:
            continue
        for name, m in render_sprite(cfg, config, out_dir).items():
            manifest[name] = m
            print("rendered", name, m)
    manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    # TypeScript view of the manifest for the game.
    rel = config["outDir"].removeprefix("public/")
    lines = [
        "// Generated by tools/render_sprites.py - do not edit by hand.",
        "// Size of each rendered sprite in game units. bbox/rects describe its visible (opaque) pixels,",
        "// in game units from the sprite's top-left corner; they are used as hitboxes.",
        "// Backgrounds (x/y set) are drawn at that world position instead.",
        "export const SPRITES = {",
    ]
    for name, m in sorted(manifest.items()):
        extra = ""
        if "x" in m:
            extra = f', x: {m["x"]}, y: {m["y"]}'
        if "bbox" in m:
            rects = ", ".join("[" + ", ".join(str(v) for v in r) + "]" for r in m["rects"])
            extra += f', bbox: [{", ".join(str(v) for v in m["bbox"])}], rects: [{rects}]'
        if "pivots" in m:
            extra += ", pivots: { " + ", ".join(f"{k}: [{v[0]}, {v[1]}]" for k, v in m["pivots"].items()) + " }"
        lines.append(f'\t{name}: {{ file: "{rel}/{name}.png", w: {m["w"]}, h: {m["h"]}{extra} }},')
    lines.append("} as const;")
    lines.append("")
    lines.append("export type SpriteName = keyof typeof SPRITES;")
    (ROOT / "src" / "sprites.generated.ts").write_text("\n".join(lines) + "\n", encoding="utf-8")


main()
