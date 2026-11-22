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


def build_hatch(cfg, **_):
    gold = photo("HatchGold", "metal_plate", mix_color=BRASS, scale=8, metal=0.6, rough=0.3)
    void = _material("Void", (0.004, 0.004, 0.006), rough=1.0)
    vinyl = photo("SlideVinyl", "leather_white", tint=(0.75, 0.6, 0.25), scale=6, coat=0.6, rough=0.3)
    iron = photo("Iron", "rusty_metal", tint=(0.6, 0.55, 0.5), scale=20, metal=0.8)
    lockbrass = photo("LockBrass", "metal_plate", mix_color=BRASS, scale=25, metal=0.6, rough=0.35)
    w, h_rect = 0.4, 0.6
    arch = [(-w, 0.0, 0.0), (-w, 0.0, h_rect)]
    arch += [(-w * math.cos(math.radians(a)), 0.0, h_rect + w * math.sin(math.radians(a))) for a in range(10, 171, 10)]
    arch += [(w, 0.0, h_rect), (w, 0.0, 0.0)]
    frame = [tube_path(arch, 0.055, gold)]
    # Dark opening (flat fill of the arch outline, slightly behind the frame)
    mesh = bpy.data.meshes.new("Opening")
    verts = [(x, 0.04, z) for (x, _, z) in arch]
    mesh.from_pydata(verts, [], [list(range(len(verts)))])
    op = bpy.data.objects.new("Opening", mesh)
    bpy.context.scene.collection.objects.link(op)
    _assign(op, void)
    frame.append(op)
    # The slide's inflated entry lip across the bottom, and its ramp falling away into the dark
    frame.append(limb((-w + 0.03, -0.02, 0.06), (w - 0.03, -0.02, 0.06), 0.06, vinyl))
    # Chains: two crossing diagonals of alternating links, plus a padlock
    lock = []
    for (x0, z0, x1, z1) in ((-w, 0.62, w, 0.22), (w, 0.62, -w, 0.22)):
        a, b = Vector((x0, -0.06, z0)), Vector((x1, -0.06, z1))
        n = 26
        d = (b - a).normalized()
        ang = math.atan2(d.z, d.x)
        for i in range(n):
            p = a.lerp(b, (i + 0.5) / n)
            o = torus(tuple(p), 0.022, 0.006, iron)
            # Oval links, alternating face-on and edge-on along the chain
            o.scale = (1.5, 1.0, 1.0)
            o.rotation_euler = (math.pi / 2 if i % 2 == 0 else 0.0, -ang, 0)
            lock.append(o)
    lock.append(box((0, -0.1, 0.36), (0.12, 0.05, 0.1), lockbrass, bevel=0.015))
    lock.append(torus((0, -0.1, 0.43), 0.04, 0.009, iron, rot=(math.pi / 2, 0, 0)))
    lock.append(sphere((0, -0.128, 0.355), (1, 0.4, 1.4), 0.011, _material("Keyhole", (0.0, 0.0, 0.0), rough=1)))
    return _finish({"frame": frame, "lock": lock})


def build_child(cfg, **_):
    porcelain = _material("Porcelain", (0.88, 0.78, 0.72), rough=0.3, sss=0.25, coat=0.35)
    cheek = _material("Cheek", (0.82, 0.48, 0.46), rough=0.4, sss=0.2)
    gown = photo("Gown", "rough_linen", tint=(1.45, 1.42, 1.36), scale=9)
    lace = photo("Lace", "rough_linen", tint=(1.6, 1.57, 1.5), scale=20)
    hair = photo("ChildHair", "curly_teddy_natural", tint=(0.42, 0.26, 0.16), scale=14)
    shoes = photo("Shoes", "brown_leather", tint=(0.25, 0.22, 0.22), scale=20, coat=0.8)
    eye = _material("DollEye", (0.03, 0.025, 0.03), rough=0.04, coat=1.0)
    white = _material("EyeWhite", (0.85, 0.83, 0.8), rough=0.2, coat=0.6)
    lips = _material("Lips", (0.55, 0.14, 0.15), rough=0.35)
    body = []
    for x in (-0.045, 0.045):
        body.append(sphere((x, -0.025, 0.022), (1.0, 1.6, 0.7), 0.03, shoes))
    # Nightgown: a flared bell blended from metaballs so it reads as soft cloth
    body.append(blob([
        ("capsule", (0, 0, 0.12), (0, 0, 0.35), 0.1),
        ("ellipsoid", (0, 0, 0.1), 0.19, (1.0, 0.85, 0.5)),
        ("ellipsoid", (0, 0, 0.22), 0.15, (1.0, 0.85, 0.75)),
        ("ellipsoid", (0, 0, 0.33), 0.11, (1.25, 0.8, 0.6)),
    ], gown))
    body.append(torus((0, 0, 0.055), 0.122, 0.015, lace))
    body.append(torus((0, 0, 0.37), 0.052, 0.013, lace))
    for side in (-1, 1):
        body.append(blob([("capsule", (side * 0.07, 0, 0.34), (side * 0.11, -0.03, 0.21), 0.05)], gown))
        body.append(sphere((side * 0.112, -0.035, 0.19), (1, 1, 1.2), 0.024, porcelain))
    # Head: a big porcelain-doll head sitting right on the collar
    body.append(sphere((0, 0, 0.47), (1, 1, 1.05), 0.11, porcelain))
    # Hair: bob cap, fringe and side curtains
    body.append(sphere((0, 0.03, 0.49), (1.08, 1.0, 1.04), 0.112, hair))
    body.append(sphere((0, -0.068, 0.545), (1.15, 0.5, 0.42), 0.075, hair))
    for side in (-1, 1):
        body.append(sphere((side * 0.088, 0.0, 0.43), (0.45, 0.85, 1.15), 0.065, hair))
    for side in (-1, 1):
        body.append(sphere((side * 0.055, -0.093, 0.435), (1, 0.4, 0.7), 0.018, cheek))
    body.append(sphere((0, -0.108, 0.41), (1.3, 0.5, 0.6), 0.009, lips))
    # Big glassy doll eyes (whites + dark irises); the blink pass swaps them for closed lids
    eyes, lids = [], []
    for side in (-1, 1):
        eyes.append(sphere((side * 0.038, -0.093, 0.47), (1, 0.6, 1.15), 0.024, white))
        eyes.append(sphere((side * 0.038, -0.105, 0.468), (1, 0.5, 1.1), 0.016, eye))
        lids.append(sphere((side * 0.038, -0.094, 0.47), (1.05, 0.62, 1.2), 0.025, porcelain))
        lids.append(limb((side * 0.038 - 0.02, -0.11, 0.465), (side * 0.038 + 0.02, -0.11, 0.465), 0.0025, eye))
    return _finish({"body": body, "eyes": eyes, "lids": lids})


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

    # Arched sash windows looking out on a real moonlit night
    for i, win in enumerate(L["windows"]):
        cx, top, w, h = X(win["x"]), Z(win["y"]), win["w"] / 100, win["h"] / 100
        r = w / 2
        bottom = top - h
        def arch(rad, y, steps=18):
            pts = [(cx - rad, y, bottom), (cx - rad, y, top - r)]
            pts += [(cx - rad * math.cos(a), y, top - r + rad * math.sin(a)) for a in [math.pi * k / steps for k in range(1, steps)]]
            pts += [(cx + rad, y, top - r), (cx + rad, y, bottom)]
            return pts
        crop = win["sky"]
        verts = [(x, D - 0.015, z) for (x, _, z) in arch(r, D - 0.015)]
        uvs = [(crop[0] + (x - (cx - r)) / w * (crop[2] - crop[0]), 1 - crop[3] + (z - bottom) / h * (crop[3] - crop[1])) for (x, _, z) in verts]
        shell.append(_mesh(f"Sky{i}", verts, [list(range(len(verts)))], _sky(f"Sky{i}", L["sky"], crop), uvs))
        shell.append(tube_path(arch(r + 0.07, D - 0.04), 0.07, paint))
        shell.append(tube_path(arch(r, D - 0.03), 0.035, paint))
        shell.append(_box(cx - 0.018, cx + 0.018, D - 0.04, D - 0.02, bottom, top - 0.02, paint))
        for fz in (0.3, 0.62):
            shell.append(_box(cx - r, cx + r, D - 0.04, D - 0.02, bottom + h * fz - 0.018, bottom + h * fz + 0.018, paint))
        for a in (math.pi * 0.25, math.pi * 0.75):
            shell.append(limb((cx, D - 0.03, top - r), (cx + math.cos(a) * r, D - 0.03, top - r + math.sin(a) * r), 0.016, paint))
        shell.append(_box(cx - r - 0.18, cx + r + 0.18, D - 0.16, D, bottom - 0.1, bottom, paint, bevel=0.015))

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


BUILDERS = {
    "room": build_room,
    "shelf": build_shelf,
    "key": build_key,
    "rocking_horse": build_rocking_horse,
    "hatch": build_hatch,
    "child": build_child,
    "painting": build_painting,
}
