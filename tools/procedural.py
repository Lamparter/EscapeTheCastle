"""Procedural Blender models for props with no suitable free model (run inside Blender).

Each builder returns (root, meshes, parts): `parts` maps a part name to its objects so the render
script can render passes that show only some parts (e.g. the hatch's chains, the player's blink).
Units are metres; the camera looks along +Y, so -Y faces the viewer and +X is screen-right.
"""
import math
import pathlib

import bpy
from mathutils import Vector

TEXTURES = pathlib.Path(__file__).resolve().parent.parent / "art" / "source" / "textures"
# Brass/gilt: a real scratched-metal photo blended towards gold.
BRASS = ((0.78, 0.56, 0.24), 0.72)

# ---------------------------------------------------------------- helpers


def _smooth(obj, subsurf=0):
    n = len(obj.data.polygons)
    obj.data.polygons.foreach_set("use_smooth", [True] * n)
    if subsurf:
        m = obj.modifiers.new("Subsurf", "SUBSURF")
        m.levels = m.render_levels = subsurf
    return obj


def _material(name, color, rough=0.5, metal=0.0, sss=0.0, ramp=None, noise_scale=6.0, voronoi=False, coat=0.0):
    """Principled material; `ramp` = (dark, light) colours driven by a noise/voronoi texture."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if sss:
        bsdf.inputs["Subsurface Weight"].default_value = sss
        bsdf.inputs["Subsurface Radius"].default_value = (0.02, 0.01, 0.008)
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
    if ramp:
        tex = nt.nodes.new("ShaderNodeTexVoronoi" if voronoi else "ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = noise_scale
        if not voronoi:
            tex.inputs["Detail"].default_value = 8.0
        coord = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(coord.outputs["Generated" if voronoi else "Object"], tex.inputs["Vector"])
        cr = nt.nodes.new("ShaderNodeValToRGB")
        cr.color_ramp.elements[0].color = (*ramp[0], 1)
        cr.color_ramp.elements[1].color = (*ramp[1], 1)
        if voronoi:
            cr.color_ramp.elements[0].position = 0.25
            cr.color_ramp.elements[1].position = 0.45
        nt.links.new(tex.outputs["Distance" if voronoi else "Fac"], cr.inputs["Fac"])
        nt.links.new(cr.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def photo(name, tex, tint=(1, 1, 1), scale=4.0, metal=0.0, rough=None, coat=0.0, sss=0.0, mix_color=None):
    """Material from real CC0 photo textures (art/source/textures/<tex>/), box-projected on object
    coordinates so it works on any mesh. `tint` multiplies the photo's colour; `mix_color` = (rgb, amount)
    blends towards a flat colour (e.g. to turn grey metal into brass while keeping its photo detail)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metal
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
    if sss:
        bsdf.inputs["Subsurface Weight"].default_value = sss
        bsdf.inputs["Subsurface Radius"].default_value = (0.02, 0.01, 0.008)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    def image(kind, non_color):
        path = TEXTURES / tex / f"{kind}.jpg"
        if not path.exists():
            raise FileNotFoundError(f"{path}: run python tools/fetch_polyhaven.py first")
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(path), check_existing=True)
        if non_color:
            node.image.colorspace_settings.name = "Non-Color"
        node.projection = "BOX"
        node.projection_blend = 0.3
        nt.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    col = image("diffuse", False)
    tint_node = nt.nodes.new("ShaderNodeMix")
    tint_node.data_type = "RGBA"
    tint_node.blend_type = "MULTIPLY"
    tint_node.inputs["Factor"].default_value = 1.0
    nt.links.new(col.outputs["Color"], tint_node.inputs[6])
    tint_node.inputs[7].default_value = (*tint, 1)
    out = tint_node.outputs[2]
    if mix_color:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MIX"
        mix.inputs["Factor"].default_value = mix_color[1]
        nt.links.new(out, mix.inputs[6])
        mix.inputs[7].default_value = (*mix_color[0], 1)
        out = mix.outputs[2]
    nt.links.new(out, bsdf.inputs["Base Color"])
    r = image("rough", True)
    if rough is None:
        nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = rough
    n = image("nor_gl", True)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 0.6
    nt.links.new(n.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def _assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def _active():
    return bpy.context.active_object


def sphere(loc, scale=(1, 1, 1), r=1.0, mat=None, rot=(0, 0, 0), sub=1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, rotation=rot, segments=32, ring_count=16)
    o = _active()
    o.scale = scale
    _smooth(o, sub)
    return _assign(o, mat) if mat else o


def limb(p0, p1, r, mat=None, r_end=None, verts=24):
    """Tapered cylinder between two points."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r_end if r_end is not None else r,
                                    depth=d.length, location=(p0 + p1) / 2)
    o = _active()
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    _smooth(o, 1)
    return _assign(o, mat) if mat else o


def torus(loc, major, minor, mat=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=32, minor_segments=12)
    o = _active()
    _smooth(o)
    return _assign(o, mat) if mat else o


def box(loc, size, mat=None, bevel=0.01, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = _active()
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new("Bevel", "BEVEL")
        b.width = bevel
        b.segments = 3
    _smooth(o)
    return _assign(o, mat) if mat else o


def tube_path(points, radius, mat=None, closed=False):
    """A round tube along a polyline (for chains of curves, rockers, frames)."""
    cu = bpy.data.curves.new("Tube", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 6
    sp = cu.splines.new("POLY")
    sp.points.add(len(points) - 1)
    for p, q in zip(sp.points, points):
        p.co = (*q, 1)
    sp.use_cyclic_u = closed
    o = bpy.data.objects.new("Tube", cu)
    bpy.context.scene.collection.objects.link(o)
    if mat:
        o.data.materials.append(mat)
    # Convert to mesh so the render script's vertex fitting sees it.
    bpy.context.view_layer.objects.active = o
    for s in bpy.context.selected_objects:
        s.select_set(False)
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return _active()


def blob(elements, mat=None, resolution=0.008):
    """Smoothly blended organic shape from metaball elements, converted to a mesh.

    elements: ("ball", centre, radius) | ("ellipsoid", centre, radius, (sx, sy, sz)) |
              ("capsule", p0, p1, radius)
    """
    mb = bpy.data.metaballs.new("Blob")
    mb.resolution = resolution
    mb.render_resolution = resolution * 0.6
    mb.threshold = 0.6
    for el in elements:
        if el[0] == "capsule":
            p0, p1, r = Vector(el[1]), Vector(el[2]), el[3]
            e = mb.elements.new(type="CAPSULE")
            e.co = (p0 + p1) / 2
            e.radius = r
            e.size_x = (p1 - p0).length / 2
            e.rotation = Vector((1, 0, 0)).rotation_difference(p1 - p0)
        elif el[0] == "ellipsoid":
            e = mb.elements.new(type="ELLIPSOID")
            e.co = el[1]
            e.radius = el[2]
            e.size_x, e.size_y, e.size_z = el[3]
        else:
            e = mb.elements.new(type="BALL")
            e.co = el[1]
            e.radius = el[2]
    o = bpy.data.objects.new("Blob", mb)
    bpy.context.scene.collection.objects.link(o)
    for sel in bpy.context.selected_objects:
        sel.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = _active()
    _smooth(o)
    return _assign(o, mat) if mat else o


def _finish(parts):
    root = bpy.data.objects.new("Root", None)
    bpy.context.scene.collection.objects.link(root)
    meshes = []
    for objs in parts.values():
        for o in objs:
            o.parent = root
            meshes.append(o)
    return root, meshes, parts


# ---------------------------------------------------------------- builders


def build_key(cfg, **_):
    brass = photo("Brass", "metal_plate", mix_color=BRASS, scale=30, metal=0.6, rough=0.32)
    objs = []
    # Ornate bow: a ring with three lobes, like an old skeleton key
    objs.append(torus((-0.045, 0, 0), 0.022, 0.0045, brass, rot=(math.pi / 2, 0, 0)))
    for a in (90, 180, 270):
        x = -0.045 + math.cos(math.radians(a)) * 0.024
        z = math.sin(math.radians(a)) * 0.024
        objs.append(torus((x, 0, z), 0.008, 0.003, brass, rot=(math.pi / 2, 0, 0)))
    # Collar rings and shaft
    objs.append(limb((-0.024, 0, 0), (0.07, 0, 0), 0.0045, brass))
    for x in (-0.018, -0.012):
        objs.append(torus((x, 0, 0), 0.0065, 0.002, brass, rot=(0, math.pi / 2, 0)))
    # Bit (teeth)
    objs.append(box((0.058, 0, -0.012), (0.016, 0.004, 0.022), brass, bevel=0.001))
    objs.append(box((0.067, 0, -0.016), (0.006, 0.004, 0.014), brass, bevel=0.001))
    return _finish({"key": objs})


def _dapple_photo():
    m = photo("Dapple", "painted_plaster_wall", tint=(1.0, 0.98, 0.94), scale=5, coat=0.5, rough=0.35)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    base = bsdf.inputs["Base Color"].links[0].from_socket
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 14
    gen = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(gen.outputs["Generated"], vor.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.45, 0.44, 0.43, 1)
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    ramp.color_ramp.elements[1].position = 0.45
    nt.links.new(vor.outputs["Distance"], ramp.inputs["Fac"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(base, mul.inputs[6])
    nt.links.new(ramp.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    return m


def build_rocking_horse(cfg, **_):
    dapple = _dapple_photo()
    wood = photo("RockerWood", "dark_wood", tint=(0.8, 0.6, 0.55), scale=3, coat=0.4)
    hair = photo("Hair", "curly_teddy_natural", tint=(0.22, 0.2, 0.2), scale=12)
    leather = photo("Saddle", "leather_red_02", scale=8, coat=0.3)
    reins = photo("Reins", "brown_leather", scale=10)
    black = _material("Eye", (0.01, 0.01, 0.01), rough=0.1, coat=1.0)
    gold = photo("Trim", "metal_plate", mix_color=BRASS, scale=30, metal=0.6, rough=0.3)
    objs = []
    R = 1.4

    def rocker_z(x):
        return R - math.sqrt(R * R - x * x) + 0.05

    # Rockers: two curved bows joined by slats
    for y in (-0.11, 0.11):
        pts = [(x, y, rocker_z(x) - 0.02) for x in [i / 24 * 1.16 - 0.58 for i in range(25)]]
        objs.append(tube_path(pts, 0.024, wood))
    for x in (-0.33, 0.0, 0.33):
        objs.append(box((x, 0, rocker_z(x) + 0.01), (0.05, 0.26, 0.025), wood, bevel=0.006))
    # Carved body: one smooth blended shape (body, chest, neck, head and four legs)
    legs = ((0.19, -0.06, 0.32), (0.15, 0.06, 0.25), (-0.17, -0.06, -0.25), (-0.2, 0.06, -0.33))
    els = [
        ("ellipsoid", (0.0, 0, 0.52), 0.2, (1.55, 0.62, 0.7)),
        ("ball", (0.17, 0, 0.55), 0.13),
        ("capsule", (0.2, 0, 0.58), (0.33, 0, 0.78), 0.1),
        ("capsule", (0.32, 0, 0.8), (0.47, 0, 0.68), 0.085),
        ("ball", (0.47, 0, 0.68), 0.075),
    ]
    for (xt, y, xb) in legs:
        els.append(("capsule", (xt, y, 0.48), (xb, y * 1.3, rocker_z(xb) + 0.05), 0.055))
    objs.append(blob(els, dapple))
    for (xt, y, xb) in legs:
        objs.append(sphere((xb, y * 1.3, rocker_z(xb) + 0.035), (1.3, 1.1, 0.8), 0.027, black))
    # Ears, eyes, nostril
    for y in (-0.025, 0.025):
        objs.append(limb((0.33, y, 0.84), (0.31, y, 0.91), 0.02, dapple, r_end=0.003))
    for y in (-0.047, 0.047):
        objs.append(sphere((0.39, y, 0.8), (1, 0.6, 1), 0.014, black))
    # Bridle, reins and saddle
    objs.append(torus((0.45, 0, 0.71), 0.05, 0.006, reins, rot=(0, math.radians(-50), 0)))
    objs.append(tube_path([(0.43, -0.05, 0.71), (0.28, -0.08, 0.66), (0.1, -0.1, 0.66)], 0.005, reins))
    objs.append(sphere((-0.03, 0, 0.6), (0.12, 0.13, 0.03), 1.0, leather))
    objs.append(limb((-0.03, -0.12, 0.59), (-0.03, -0.13, 0.48), 0.004, gold))
    objs.append(torus((-0.03, -0.13, 0.465), 0.018, 0.004, gold, rot=(math.pi / 2, 0, 0)))
    # Mane along the crest and a long horsehair tail
    for i in range(11):
        t = i / 10
        x, z = 0.17 + 0.17 * t, 0.66 + 0.2 * t
        objs.append(limb((x - 0.01, 0.0, z + 0.05), (x - 0.07, -0.03, z - 0.05), 0.022, hair, r_end=0.004))
    objs.append(limb((-0.23, 0, 0.58), (-0.38, 0.02, 0.38), 0.04, hair, r_end=0.012))
    objs.append(limb((-0.38, 0.02, 0.38), (-0.41, 0.02, 0.26), 0.012, hair, r_end=0.003))
    return _finish({"horse": objs})


def _lancet(half, spring, y, steps=14):
    """A pointed Gothic arch outline (bottom-left, up, over the point, down to bottom-right) of span
    2*half whose arcs spring at height `spring`; returns (points, apex height)."""
    R = 1.6 * half
    c = R - half
    t0 = math.acos(-c / R)                   # angle where the left arc reaches x = 0 (the point)
    left = [(c + R * math.cos(math.pi - (math.pi - t0) * k / steps), y, spring + R * math.sin(math.pi - (math.pi - t0) * k / steps)) for k in range(steps + 1)]
    right = [(-x, y, z) for (x, _, z) in reversed(left[:-1])]
    return [(-half, y, 0.0)] + left + right + [(half, y, 0.0)], spring + R * math.sin(t0)


def _fill(name, pts, mat):
    """Flat face filling a closed outline (in the x-z plane)."""
    return _mesh(name, list(pts), [list(range(len(pts)))], mat)


def build_hatch(cfg, **_):
    """The slide hatch, a little Gothic Revival doorway: a pointed lancet opening into the dark, framed
    by carved mahogany mouldings with a gilt bead, turned columns with capitals, a crocketed finial and
    a polished brass threshold. Chained shut with iron chains and an ornate brass shield padlock
    (the `lock` pass, which falls away when the key is used)."""
    mahogany = photo("HatchMahogany", "dark_wood", tint=(0.62, 0.36, 0.26), scale=3, rough=0.45, coat=0.25)
    carved = photo("HatchCarved", "dark_wood", tint=(0.5, 0.29, 0.21), scale=6, rough=0.5)
    gold = photo("HatchGold", "metal_plate", mix_color=BRASS, scale=8, metal=0.6, rough=0.28)
    void = _material("Void", (0.004, 0.004, 0.006), rough=1.0)
    iron = photo("Iron", "rusty_metal", tint=(0.45, 0.42, 0.4), scale=20, metal=0.8)
    lockbrass = photo("LockBrass", "metal_plate", mix_color=BRASS, scale=25, metal=0.6, rough=0.3)
    w, spring = 0.34, 0.5
    frame = []

    # Backing panel and the dark opening
    back, apex = _lancet(w + 0.2, spring, 0.08)
    frame.append(_fill("HatchBack", [(x, 0.08, z) for (x, _, z) in back], mahogany))
    hole, top = _lancet(w, spring, 0.02)
    frame.append(_fill("Opening", hole, void))
    # Mouldings: gilt bead at the opening, a fat torus moulding, a fillet and an outer roll
    for off, r, mat in ((0.012, 0.016, gold), (0.06, 0.04, carved), (0.115, 0.016, gold), (0.16, 0.03, mahogany)):
        pts, _ = _lancet(w + off, spring, -0.01 - r * 0.5)
        frame.append(tube_path(pts, r, mat))
    # Hood moulding over the arch with carved label stops
    hood, hood_top = _lancet(w + 0.22, spring, -0.06)
    hood = [p for p in hood if p[2] >= spring - 0.02]
    frame.append(tube_path(hood, 0.028, carved))
    for sx in (-1, 1):
        frame.append(sphere((sx * (w + 0.22), -0.07, spring - 0.03), (1, 0.8, 1.2), 0.04, carved))
    # Crocketed finial at the point
    frame.append(limb((0, -0.06, hood_top - 0.02), (0, -0.06, hood_top + 0.16), 0.035, carved, r_end=0.004))
    for k in range(3):
        z = hood_top + 0.02 + k * 0.045
        for sx in (-1, 1):
            frame.append(sphere((sx * (0.03 - k * 0.008), -0.07, z), (1, 0.8, 0.8), 0.018 - k * 0.004, carved))
    frame.append(sphere((0, -0.06, hood_top + 0.17), (1, 1, 1), 0.022, gold))
    # Turned columns either side: plinth, ringed shaft, bell capital
    for sx in (-1, 1):
        x = sx * (w + 0.245)
        frame.append(box((x, -0.02, 0.04), (0.11, 0.1, 0.08), carved, bevel=0.01))
        frame.append(limb((x, -0.03, 0.08), (x, -0.03, spring - 0.06), 0.028, mahogany))
        for z in (0.1, 0.18, spring * 0.5, spring - 0.1):
            frame.append(torus((x, -0.03, z), 0.031, 0.008, gold if z == spring * 0.5 else carved))
        frame.append(limb((x, -0.03, spring - 0.07), (x, -0.03, spring), 0.03, carved, r_end=0.05))
        frame.append(box((x, -0.03, spring + 0.015), (0.12, 0.1, 0.03), carved, bevel=0.008))
    # Polished brass threshold
    frame.append(box((0, -0.05, 0.015), (2 * w + 0.66, 0.14, 0.03), gold, bevel=0.008))

    # Chains crossing the opening, and an ornate shield padlock
    lock = []
    for (x0, z0, x1, z1) in ((-w, spring + 0.12, w, 0.12), (w, spring + 0.12, -w, 0.12)):
        a, b = Vector((x0, -0.08, z0)), Vector((x1, -0.08, z1))
        n = 24
        d = (b - a).normalized()
        ang = math.atan2(d.z, d.x)
        for i in range(n):
            p = a.lerp(b, (i + 0.5) / n)
            o = torus(tuple(p), 0.022, 0.006, iron)
            o.scale = (1.5, 1.0, 1.0)
            o.rotation_euler = (math.pi / 2 if i % 2 == 0 else 0.0, -ang, 0)
            lock.append(o)
    cz = (spring + 0.12 + 0.12) / 2
    # Shield padlock: shackle through the chains, a domed brass body with a scrolled top edge,
    # a raised escutcheon and keyhole
    lock.append(torus((0, -0.13, cz + 0.1), 0.06, 0.014, iron, rot=(math.pi / 2, 0, 0)))
    lock.append(sphere((0, -0.15, cz), (1.0, 0.4, 0.8), 0.1, lockbrass))
    lock.append(sphere((0, -0.15, cz - 0.07), (0.7, 0.38, 0.75), 0.075, lockbrass))
    lock.append(tube_path([(-0.085, -0.19, cz + 0.05), (-0.03, -0.195, cz + 0.075), (0, -0.197, cz + 0.06),
                           (0.03, -0.195, cz + 0.075), (0.085, -0.19, cz + 0.05)], 0.01, gold))
    lock.append(sphere((0, -0.19, cz - 0.02), (1, 0.35, 1.25), 0.03, gold))
    lock.append(sphere((0, -0.205, cz - 0.022), (1, 0.4, 1.7), 0.011, _material("Keyhole", (0.0, 0.0, 0.0), rough=1)))
    return _finish({"frame": frame, "lock": lock})


def build_painting(cfg, import_model, render_still, **_):
    """Render the marble bust as a dark old oil portrait, then put it on the gilt frame's canvas."""
    scene = bpy.context.scene
    # Pass 1: the sitter.
    root, meshes = import_model("marble_bust_01")
    # Turning the sitter's head lets the portrait "watch" the player (one render per angle).
    root.rotation_euler = (0, 0, math.radians(cfg.get("bustYaw", 0)))
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    # Find the canvas proportions on the frame later; first guess the frame's ratio and refine below.
    frame_root, frame_meshes = import_model("fancy_picture_frame_02")
    canvas = next(o for o in frame_meshes if any(m and m.name.endswith("_canvas") for m in o.data.materials))
    cpts = [canvas.matrix_world @ Vector(c) for c in canvas.bound_box]
    cw = max(p.x for p in cpts) - min(p.x for p in cpts)
    ch = max(p.z for p in cpts) - min(p.z for p in cpts)
    for o in frame_meshes + [frame_root]:
        o.hide_render = True
    cam_data = bpy.data.cameras.new("SitterCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("SitterCam", cam_data)
    scene.collection.objects.link(cam)
    head_h = hi.z - lo.z
    cam_data.ortho_scale = head_h * 1.05
    cam.location = ((lo.x + hi.x) / 2, lo.y - 3, lo.z + head_h * 0.55)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
    scene.render.resolution_y = 768
    scene.render.resolution_x = round(768 * cw / ch)
    scene.render.film_transparent = False
    bg = scene.world.node_tree.nodes["Background"].inputs[0]
    old_bg = tuple(bg.default_value)
    bg.default_value = (0.035, 0.026, 0.018, 1)
    sitter_path = cfg["_work_dir"] / f"{cfg['name']}_sitter.png"
    render_still(sitter_path, grade={"saturation": 0.5, "value": 0.6, "warmth": 0.12})
    bg.default_value = old_bg
    scene.render.film_transparent = True
    for o in meshes + [root]:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for o in frame_meshes + [frame_root]:
        o.hide_render = False
    # Pass 2: swap the canvas texture for our sitter.
    img = bpy.data.images.load(str(sitter_path))
    for m in canvas.data.materials:
        if m and m.name.endswith("_canvas"):
            tex = next(n for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and "diff" in (n.image.name if n.image else ""))
            tex.image = img
    return frame_root, frame_meshes, {"painting": frame_meshes}


def build_shelf(cfg, **_):
    """A dark wooden wall shelf on brass brackets (sized to the shelf hitbox: 1.84 x 0.16)."""
    wood = photo("ShelfWood", "dark_wood", tint=(0.85, 0.65, 0.55), scale=2, coat=0.3)
    brass = photo("Bracket", "metal_plate", mix_color=BRASS, scale=12, metal=0.6, rough=0.35)
    objs = [box((0, 0, 0.08), (1.84, 0.36, 0.16), wood, bevel=0.02)]
    objs.append(box((0, -0.17, 0.0), (1.84, 0.04, 0.04), wood, bevel=0.012))  # front lip moulding
    # Carved corbels under each end, with brass finials
    for x in (-0.72, 0.72):
        objs.append(limb((x, 0.06, 0.0), (x, 0.06, -0.26), 0.085, wood, r_end=0.03, verts=8))
        objs.append(sphere((x, 0.06, -0.28), (1, 1, 1), 0.035, brass))
    return _finish({"shelf": objs})


# ---------------------------------------------------------------- dollhouse room shell

IMAGES = pathlib.Path(__file__).resolve().parent.parent / "art" / "source" / "images"


def _wallpaper(name, image, tile=(2.0, 2.7), axes="xz", dim=(0.42, 0.44, 0.38), crop=((0.04, 0.94), (0.04, 0.94))):
    """A real wallpaper scan laid in repeating roll-sized tiles (cropping the scan's printed edges)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.75
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Object"], sep.inputs["Vector"])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    for i, (axis, size) in enumerate(zip(axes, tile)):
        div = nt.nodes.new("ShaderNodeMath")
        div.operation = "DIVIDE"
        nt.links.new(sep.outputs[axis.upper()], div.inputs[0])
        div.inputs[1].default_value = size
        fr = nt.nodes.new("ShaderNodeMath")
        fr.operation = "FRACT"
        nt.links.new(div.outputs[0], fr.inputs[0])
        cut = nt.nodes.new("ShaderNodeMath")
        cut.operation = "MULTIPLY_ADD"
        nt.links.new(fr.outputs[0], cut.inputs[0])
        cut.inputs[1].default_value = crop[i][1] - crop[i][0]
        cut.inputs[2].default_value = crop[i][0]
        nt.links.new(cut.outputs[0], comb.inputs[i])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(IMAGES / f"{image}.jpg"), check_existing=True)
    tex.extension = "EXTEND"
    nt.links.new(comb.outputs["Vector"], tex.inputs["Vector"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mul.inputs[6])
    mul.inputs[7].default_value = (*dim, 1)
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    return m


def _sky(name, image, crop):
    """Emissive night-sky photo for a window, cropped to (u0, v0, u1, v1) of the panorama (v from the top)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 0.55
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(IMAGES / f"{image}.jpg"), check_existing=True)
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def _mesh(name, verts, faces, mat, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        for loop in me.loops:
            layer.data[loop.index].uv = uvs[loop.vertex_index]
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return _assign(o, mat)


def _box(x0, x1, y0, y1, z0, z1, mat, bevel=0.0):
    return box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), mat, bevel=bevel)


def build_room(cfg, **_):
    """The nursery as a cut-away dollhouse room, at exact game scale: Blender X = x / 100,
    Z = (760 - y) / 100 (y = game units). The back wall is 3 m deep; floor and ceiling are
    tilted like a stage set so an orthographic front camera sees them, as in a dollhouse photo."""
    L = cfg["layout"]
    X = lambda x: x / 100
    Z = lambda y: (760 - y) / 100
    W, wl, wr = X(L["w"]), X(L["wallL"]), X(L["wallR"])
    D = 3.0
    crop = tuple(tuple(c) for c in L.get("wallpaperCrop", [[0.04, 0.94], [0.04, 0.94]]))
    paper = _wallpaper("Wallpaper", L["wallpaper"], crop=crop, dim=(0.25, 0.26, 0.22))
    paper_side = _wallpaper("WallpaperSide", L["wallpaper"], axes="yz", dim=(0.13, 0.135, 0.12), crop=crop)
    plaster = photo("Plaster", "painted_plaster_wall", tint=(0.82, 0.77, 0.66), scale=1.2, rough=0.6)
    ceiling = photo("Ceiling", "ceiling_interior", tint=(0.55, 0.52, 0.46), scale=0.6)
    wood = photo("RoomWood", "dark_wood", tint=(0.55, 0.4, 0.32), scale=1.2, rough=0.6)
    paint = photo("WindowPaint", "white_planks_clean", tint=(0.72, 0.69, 0.62), scale=2.5, rough=0.45)
    gilt = photo("Gilt", "metal_plate", mix_color=BRASS, scale=3, metal=0.6, rough=0.3)
    parquet = photo("Parquet", "herringbone_parquet", tint=(0.7, 0.6, 0.52), scale=0.28, rough=0.55)
    shell, floor = [], []

    # Walls and ceiling
    shell.append(_mesh("BackWall", [(wl, D, Z(670)), (wr, D, Z(670)), (wr, D, Z(22)), (wl, D, Z(22))], [(0, 1, 2, 3)], paper))
    shell.append(_mesh("LeftWall", [(0, 0, Z(780)), (wl, D, Z(670)), (wl, D, Z(22)), (0, 0, Z(-30))], [(0, 1, 2, 3)], paper_side))
    shell.append(_mesh("RightWall", [(W, 0, Z(780)), (wr, D, Z(670)), (wr, D, Z(22)), (W, 0, Z(-30))], [(0, 3, 2, 1)], paper_side))
    shell.append(_mesh("Ceiling", [(0, 0, Z(-30)), (W, 0, Z(-30)), (wr, D, Z(22)), (wl, D, Z(22))], [(0, 1, 2, 3)], ceiling))

    # Cornice: cove, dentils, egg-and-dart, fillet (painted plaster)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.26, depth=wr - wl, location=((wl + wr) / 2, D, Z(22)), rotation=(0, math.pi / 2, 0), vertices=48)
    cove = _assign(_smooth(_active()), plaster)
    shell.append(cove)
    shell.append(_box(wl, wr, D - 0.1, D, Z(62), Z(54), plaster, bevel=0.01))
    dent = _box(wl + 0.02, wl + 0.07, D - 0.12, D - 0.06, Z(70), Z(62), plaster, bevel=0.004)
    arr = dent.modifiers.new("Array", "ARRAY")
    arr.use_relative_offset = False
    arr.use_constant_offset = True
    arr.constant_offset_displace = (0.1, 0, 0)
    arr.count = int((wr - wl) / 0.1)
    shell.append(dent)
    egg = sphere((wl + 0.06, D - 0.08, Z(77)), (1, 0.6, 1.3), 0.035, plaster)
    arr = egg.modifiers.new("Array", "ARRAY")
    arr.use_relative_offset = False
    arr.use_constant_offset = True
    arr.constant_offset_displace = (0.12, 0, 0)
    arr.count = int((wr - wl) / 0.12)
    shell.append(egg)
    shell.append(_box(wl, wr, D - 0.06, D, Z(86), Z(81), plaster, bevel=0.005))

    # Picture rail and skirting board (dark wood)
    shell.append(_box(wl, wr, D - 0.05, D, Z(125), Z(117), wood, bevel=0.01))
    shell.append(_box(wl, wr, D - 0.05, D, Z(670), Z(626), wood, bevel=0.008))
    shell.append(limb((wl, D - 0.05, Z(626)), (wr, D - 0.05, Z(626)), 0.02, wood))

    # Victorian arched sash windows on a real moonlit night: a moulded mahogany surround with a gilt
    # bead and carved keystone, a corbelled sill, cream-painted sashes (two-over-two below, a sunburst
    # fanlight in the arch), and heavy velvet drapes on a brass pole, gathered in gilt tie-backs.
    velvet = photo("DrapeVelvet", "velour_velvet", scale=3, mix_color=((0.085, 0.022, 0.03), 0.86), rough=0.9)
    mahog = photo("WinMahogany", "dark_wood", tint=(0.6, 0.36, 0.27), scale=2, rough=0.45, coat=0.2)
    for i, win in enumerate(L["windows"]):
        cx, top, w, h = X(win["x"]), Z(win["y"]), win["w"] / 100, win["h"] / 100
        r = w / 2
        bottom = top - h
        spring_z = top - r
        def arch(rad, y, steps=24):
            pts = [(cx - rad, y, bottom), (cx - rad, y, spring_z)]
            pts += [(cx - rad * math.cos(a), y, spring_z + rad * math.sin(a)) for a in [math.pi * k / steps for k in range(1, steps)]]
            pts += [(cx + rad, y, spring_z), (cx + rad, y, bottom)]
            return pts
        crop = win["sky"]
        verts = [(x, D - 0.015, z) for (x, _, z) in arch(r, D - 0.015)]
        uvs = [(crop[0] + (x - (cx - r)) / w * (crop[2] - crop[0]), 1 - crop[3] + (z - bottom) / h * (crop[3] - crop[1])) for (x, _, z) in verts]
        shell.append(_mesh(f"Sky{i}", verts, [list(range(len(verts)))], _sky(f"Sky{i}", L["sky"], crop), uvs))

        # Sashes: a frame round the glass, meeting rail, glazing bars, and a sunburst fanlight
        shell.append(tube_path(arch(r, D - 0.03), 0.028, paint))
        shell.append(_box(cx - r, cx + r, D - 0.045, D - 0.02, spring_z - 0.025, spring_z + 0.01, paint, bevel=0.006))   # transom
        meet = bottom + (spring_z - bottom) * 0.5
        shell.append(_box(cx - r, cx + r, D - 0.05, D - 0.02, meet - 0.022, meet + 0.022, paint, bevel=0.006))           # meeting rail
        shell.append(_box(cx - 0.011, cx + 0.011, D - 0.04, D - 0.02, bottom, spring_z, paint))                            # glazing bar
        for sx in (-1, 1):                                                                                                    # sash horns
            shell.append(_box(cx + sx * (r - 0.03) - 0.012, cx + sx * (r - 0.03) + 0.012, D - 0.05, D - 0.02, meet - 0.06, meet - 0.02, paint, bevel=0.005))
        hub = r * 0.28
        fan = [(cx + hub * math.cos(a), D - 0.032, spring_z + hub * math.sin(a)) for a in [math.pi * k / 16 for k in range(17)]]
        shell.append(tube_path(fan, 0.011, paint))
        shell.append(tube_path([(x, D - 0.032, z) for (x, _, z) in arch(r * 0.72, 0, 24)[1:-1]], 0.009, paint))
        for k in range(1, 6):
            a = math.pi * k / 6
            shell.append(limb((cx + hub * math.cos(a), D - 0.032, spring_z + hub * math.sin(a)),
                              (cx + r * math.cos(a), D - 0.032, spring_z + r * math.sin(a)), 0.009, paint))

        # Moulded surround: gilt bead, a fat roll, a flat band and an outer ogee roll, in mahogany
        for off, rad, y, mat in ((0.035, 0.014, D - 0.04, gilt), (0.075, 0.035, D - 0.05, mahog), (0.13, 0.018, D - 0.04, mahog), (0.165, 0.026, D - 0.05, mahog)):
            shell.append(tube_path(arch(r + off, y), rad, mat))
        # Carved keystone with a gilt boss
        ky = top + 0.075
        shell.append(_box(cx - 0.055, cx + 0.055, D - 0.1, D - 0.02, ky - 0.06, ky + 0.1, mahog, bevel=0.012))
        shell.append(sphere((cx, D - 0.105, ky + 0.02), (1, 0.5, 1), 0.03, gilt))
        # Sill on two carved corbels
        shell.append(_box(cx - r - 0.24, cx + r + 0.24, D - 0.2, D, bottom - 0.07, bottom, mahog, bevel=0.015))
        shell.append(limb((cx - r - 0.24, D - 0.2, bottom - 0.005), (cx + r + 0.24, D - 0.2, bottom - 0.005), 0.012, gilt))
        for sx in (-1, 1):
            shell.append(_box(cx + sx * (r + 0.12) - 0.04, cx + sx * (r + 0.12) + 0.04, D - 0.13, D, bottom - 0.2, bottom - 0.07, mahog, bevel=0.015))
            shell.append(sphere((cx + sx * (r + 0.12), D - 0.13, bottom - 0.2), (1, 0.7, 0.7), 0.04, mahog))

        # Brass curtain pole above the arch, with ball finials
        pole_z = top + 0.2
        half = r + 0.5
        shell.append(limb((cx - half, D - 0.22, pole_z), (cx + half, D - 0.22, pole_z), 0.02, gilt))
        for sx in (-1, 1):
            shell.append(sphere((cx + sx * (half + 0.04), D - 0.22, pole_z), (1, 1, 1), 0.045, gilt))
            shell.append(limb((cx + sx * (half - 0.08), D - 0.04, pole_z), (cx + sx * (half - 0.08), D - 0.22, pole_z), 0.012, gilt))

        # Velvet drapes: deep pleats, gathered into gilt tie-backs and flaring to the floor-length hem
        drop_to = Z(600)
        tie_z = bottom + (spring_z - bottom) * 0.25
        for sx in (-1, 1):
            outer = cx + sx * (half - 0.03)
            inner_top = cx + sx * (r * 0.62)
            cols, rows = 48, 40
            pleats = 5 if w > 1.5 else 4
            verts, faces = [], []
            for j in range(rows + 1):
                z = pole_z - (pole_z - drop_to) * j / rows
                if z >= tie_z:
                    g = 1 - 0.78 * ((pole_z - z) / (pole_z - tie_z)) ** 1.6          # fraction of full width
                else:
                    g = 0.22 + 0.33 * ((tie_z - z) / (tie_z - drop_to)) ** 0.8
                for c in range(cols + 1):
                    u = c / cols
                    x = outer + (inner_top - outer) * u * g
                    depth = 0.09 * (0.45 + 0.55 * (1 - g)) * (math.sin(u * pleats * 2 * math.pi) + 0.3 * math.sin(u * pleats * 4.3 * math.pi + 1.1))
                    verts.append((x, D - 0.25 - 0.05 * (1 - u) - abs(depth), z))
            for j in range(rows):
                for c in range(cols):
                    a0 = j * (cols + 1) + c
                    q = (a0, a0 + 1, a0 + cols + 2, a0 + cols + 1)
                    faces.append(q if sx < 0 else tuple(reversed(q)))
            drape = _mesh(f"Drape{i}{sx}", verts, faces, velvet)
            _smooth(drape, 1)
            shell.append(drape)
            # Tie-back: a gilt cord band round the gathered drape, with a hanging tassel
            tx = outer + (inner_top - outer) * 0.22 * 0.5
            span = abs(inner_top - outer) * 0.24
            shell.append(limb((tx - span * 0.6, D - 0.34, tie_z), (tx + span * 0.6, D - 0.34, tie_z), 0.018, gilt))
            shell.append(sphere((tx, D - 0.35, tie_z - 0.03), (1, 0.8, 1), 0.03, gilt))
            shell.append(limb((tx, D - 0.35, tie_z - 0.05), (tx, D - 0.35, tie_z - 0.2), 0.012, gilt, r_end=0.04))
        # A swagged pelmet of the same velvet across the pole
        pel = []
        cols = 60
        for j in range(9):
            for c in range(cols + 1):
                u = c / cols
                x = cx - half + 2 * half * u
                sag = 0.16 * abs(math.sin(u * 3 * math.pi))
                z = pole_z + 0.04 - (0.06 + sag) * j / 8
                pel.append((x, D - 0.3 - 0.03 * math.sin(u * 3 * math.pi) ** 2, z))
        pf = [(j * (cols + 1) + c, j * (cols + 1) + c + 1, (j + 1) * (cols + 1) + c + 1, (j + 1) * (cols + 1) + c) for j in range(8) for c in range(cols)]
        pm = _mesh(f"Pelmet{i}", pel, pf, velvet)
        _smooth(pm, 1)
        shell.append(pm)
        shell.append(limb((cx - half, D - 0.31, pole_z + 0.045), (cx + half, D - 0.31, pole_z + 0.045), 0.014, gilt))

    # The dollhouse box: the room above, and gilt trim on the cut edges
    shell.append(_box(0, W, -0.02, D, Z(-30), Z(-150), wood))
    shell.append(_box(0, W, -0.06, 0.0, Z(-22), Z(-31), gilt, bevel=0.01))
    for (x0, x1) in ((0, 0.09), (W - 0.09, W)):
        shell.append(_box(x0, x1, -0.06, 0.0, Z(800), Z(-150), gilt, bevel=0.01))

    # Floor (its own pass, so the game can ripple it): parquet seen at an angle, slab front, gilt edge
    floor.append(_mesh("Floor", [(0, 0, Z(706)), (W, 0, Z(706)), (wr, D, Z(652)), (wl, D, Z(652))], [(0, 1, 2, 3)], parquet))
    floor.append(_mesh("SlabFront", [(0, -0.001, Z(742)), (W, -0.001, Z(742)), (W, -0.001, Z(706)), (0, -0.001, Z(706))], [(0, 1, 2, 3)], wood))
    floor.append(_box(0, W, -0.06, 0.0, Z(712), Z(705), gilt, bevel=0.008))

    # Candlelight pooling under the chandelier
    lamp = bpy.data.lights.new("Candles", "POINT")
    lamp.color = (1.0, 0.68, 0.38)
    lamp.energy = cfg.get("candleWatts", 380)
    lamp.shadow_soft_size = 0.6
    lo = bpy.data.objects.new("Candles", lamp)
    lo.location = (X(L["chandelierX"]), 1.6, Z(200))
    bpy.context.scene.collection.objects.link(lo)

    root = bpy.data.objects.new("Root", None)
    bpy.context.scene.collection.objects.link(root)
    return root, shell + floor, {"shell": shell, "floor": floor}



def build_gothic_skirt(cfg, **_):
    """A flared, pleated bell skirt of black velvet with a satin waist ribbon and a white lace hem
    ruffle, seen from the front: dressed over the photographed bisque doll by tools/cut_doll.py."""
    velvet = photo("SkirtVelvet", "velour_velvet", scale=8, mix_color=((0.004, 0.004, 0.006), 0.985), rough=0.92)
    satin = photo("SkirtSatin", "crepe_satin", scale=10, coat=0.5, mix_color=((0.01, 0.008, 0.014), 0.94))
    lace = photo("SkirtLace", "rough_linen", tint=(1.1, 1.08, 1.05), scale=30, rough=0.9)
    rings, segs = 28, 96
    verts, faces = [], []
    for i in range(rings + 1):
        z = i / rings                      # 0 = hem, 1 = waist
        flare = (1 - z) ** 2.4
        base = 0.115 + 0.19 * flare + 0.03 * (1 - z)
        for j in range(segs):
            th = 2 * math.pi * j / segs
            pleat = 1 + 0.07 * math.sin(14 * th) * (0.25 + flare)
            verts.append((base * pleat * math.cos(th), base * pleat * math.sin(th) * 0.8, 0.06 + z * 0.4))
    for i in range(rings):
        for j in range(segs):
            a, b = i * segs + j, i * segs + (j + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    skirt = _mesh("Skirt", verts, faces, velvet)
    _smooth(skirt, 1)
    objs = [skirt]
    # Lace ruffle peeking out under the hem (a pleated ring, slightly wider than the hem)
    rv, rf = [], []
    for i in range(4):
        z = 0.03 + i * 0.012
        for j in range(segs):
            th = 2 * math.pi * j / segs
            r = (0.31 + 0.01 * math.sin(28 * th)) * (1 + 0.025 * i)
            rv.append((r * math.cos(th), r * math.sin(th) * 0.8, z))
    for i in range(3):
        for j in range(segs):
            a, b = i * segs + j, i * segs + (j + 1) % segs
            rf.append((a, b, b + segs, a + segs))
    ruffle = _mesh("Ruffle", rv, rf, lace)
    _smooth(ruffle, 1)
    objs.append(ruffle)
    # Satin ribbon at the waist, with a bow at the front
    band = torus((0, 0, 0.46), 0.112, 0.012, satin)
    band.scale = (1, 0.8, 1)
    objs.append(band)
    for side in (-1, 1):
        objs.append(sphere((side * 0.03, -0.095, 0.455), (1.1, 0.45, 0.7), 0.026, satin))
        objs.append(limb((side * 0.008, -0.095, 0.45), (side * 0.03, -0.1, 0.37), 0.006, satin))
    objs.append(sphere((0, -0.098, 0.455), (1, 1, 1), 0.011, satin))
    return _finish({"skirt": objs})


def _pleated_ring(name, mat, r_in, r_out, z, pleats=40, wave=0.008, droop=0.0, segs=160, rings=6, ragged=0.0, seed=0):
    """A flat, pleated ring of fabric (tutu layers, ruffles): radius r_in..r_out at height z,
    with a wavy outer edge and an optional downward droop towards the edge. `ragged` > 0 makes the
    pleats irregular (several frequencies, random phases) and the hem uneven, like real tulle."""
    import random
    rnd = random.Random(seed)
    waves = [(pleats, wave, 0.0)]
    if ragged:
        waves = [(pleats * m, wave * a, rnd.uniform(0, 6.28)) for m, a in ((1, 0.6), (1.7, 0.35), (2.9, 0.25), (0.45, 0.4))]
        hem = [(int(rnd.uniform(3, 11)), rnd.uniform(0, 6.28)) for _ in range(4)]
    verts, faces = [], []
    for i in range(rings + 1):
        f = i / rings
        r = r_in + (r_out - r_in) * f
        for j in range(segs):
            th = 2 * math.pi * j / segs
            w = sum(math.sin(fr * th + ph) * a for fr, a, ph in waves) * f
            rr = r + w
            dz = 0.0
            if ragged:
                rr += sum(math.sin(n * th + ph) for n, ph in hem) * ragged * f * f
                dz = sum(math.cos(n * th + ph) for n, ph in hem) * ragged * 0.6 * f * f
            verts.append((rr * math.cos(th), rr * math.sin(th), z - droop * f * f + w * 0.35 + dz))
    for i in range(rings):
        for j in range(segs):
            a, b = i * segs + j, i * segs + (j + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    o = _mesh(name, verts, faces, mat)
    _smooth(o, 1)
    return o


def build_goth_ballet(cfg, **_):
    """Costume pieces for the goth ballerina, each its own layer: a fitted black satin bodice with a
    sweetheart neckline and silver lacing, a black lace ruff collar, a layered black tulle pancake
    tutu, and a black satin pointe shoe with ribbons. tools/cut_doll.py fits them onto the doll photo."""
    satin = photo("BalletSatin", "crepe_satin", scale=12, coat=0.6, mix_color=((0.01, 0.009, 0.012), 0.95))
    tulle = photo("BalletTulle", "crepe_georgette", scale=14, rough=0.8, mix_color=((0.012, 0.011, 0.014), 0.93))
    lace = photo("BalletLace", "crepe_georgette", scale=30, rough=0.85, mix_color=((0.02, 0.02, 0.024), 0.88))
    silver = photo("BalletSilver", "crepe_satin", scale=20, coat=0.7, mix_color=((0.55, 0.56, 0.6), 0.7))
    seam = _material("BalletSeam", (0.05, 0.05, 0.06), rough=0.5)
    parts = {"bodice": [], "collar": [], "tutu": [], "shoe": []}

    # Bodice: tapered to the waist, sweetheart neckline from two shaped cups, boning seams, lacing
    parts["bodice"].append(blob([
        ("capsule", (0, 0, 0.62), (0, 0, 0.74), 0.052),
        ("ellipsoid", (0, 0, 0.7), 0.06, (1.15, 0.75, 0.9)),
        ("ellipsoid", (-0.032, -0.012, 0.765), 0.04, (1.0, 0.8, 0.75)),
        ("ellipsoid", (0.032, -0.012, 0.765), 0.04, (1.0, 0.8, 0.75)),
    ], satin))
    for x in (-0.035, -0.012, 0.012, 0.035):
        parts["bodice"].append(limb((x * 0.9, -0.05, 0.6), (x * 1.1, -0.052, 0.75), 0.0018, seam))
    for i in range(6):
        z = 0.62 + i * 0.022
        parts["bodice"].append(limb((-0.008, -0.056, z), (0.008, -0.056, z + 0.011), 0.0016, silver))
        parts["bodice"].append(limb((0.008, -0.056, z), (-0.008, -0.056, z + 0.011), 0.0016, silver))

    # Collar: a small ruff of black lace, seen from the front as a scalloped band
    ruff = _pleated_ring("Ruff", lace, 0.03, 0.075, 0.9, pleats=26, wave=0.012, droop=0.02)
    ruff.rotation_euler = (math.radians(18), 0, 0)
    parts["collar"].append(ruff)

    # Tutu: stacked pancake layers of black tulle with wavy, drooping edges, and a satin basque
    for i in range(9):
        r = 0.2 + 0.075 * (i / 8) ** 0.8
        parts["tutu"].append(_pleated_ring(f"Tutu{i}", tulle, 0.055, r, 0.472 - i * 0.004, pleats=55 + i * 7,
                                           wave=0.006 + i * 0.0006, droop=0.02 + i * 0.004, segs=360, rings=8,
                                           ragged=0.004 + i * 0.0006, seed=i))
    band = torus((0, 0, 0.475), 0.058, 0.012, satin)
    parts["tutu"].append(band)

    # Pointe shoe (en pointe, toe down) with ribbons crossing up the ankle
    parts["shoe"].append(blob([
        ("capsule", (0, 0, 0.16), (0, -0.004, 0.06), 0.02),
        ("ellipsoid", (0, -0.006, 0.05), 0.022, (0.9, 1.0, 1.6)),
    ], satin))
    parts["shoe"].append(box((0, -0.006, 0.032), (0.02, 0.022, 0.012), satin, bevel=0.004))
    for k in range(4):
        z0 = 0.16 + k * 0.035
        parts["shoe"].append(limb((-0.024, -0.016, z0), (0.024, -0.016, z0 + 0.03), 0.0045, satin))
        parts["shoe"].append(limb((0.024, -0.016, z0 + 0.012), (-0.024, -0.016, z0 + 0.042), 0.0045, satin))
    return _finish(parts)


BUILDERS = {
    "goth_ballet": build_goth_ballet,
    "gothic_skirt": build_gothic_skirt,
    "room": build_room,
    "shelf": build_shelf,
    "key": build_key,
    "rocking_horse": build_rocking_horse,
    "hatch": build_hatch,
    "painting": build_painting,
}
