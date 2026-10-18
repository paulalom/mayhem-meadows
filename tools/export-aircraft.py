"""Author Mayhem Meadows' original low-poly fleet in Blender and export browser meshes.

Run in Blender's Python console: exec(compile(open(PATH).read(), PATH, 'exec')).
The existing scene is preserved. Only the dedicated workshop is rebuilt. No add-ons,
downloads, generated textures, or network access are needed. Model units are metres;
the browser coordinate convention is X forward, Y up, Z starboard. Each animated
mesh is stored relative to its pivot, so the game can spin it without a rig.
"""

import bpy
import bmesh
import json
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "aircraft")
os.makedirs(OUT, exist_ok=True)
SCENE_NAME = "Mayhem Aircraft Workshop"

# Never clear the user's current scene. A rerun replaces our own workshop only.
old = bpy.data.scenes.get(SCENE_NAME)
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(SCENE_NAME)
bpy.context.window.scene = scene
scene.world = bpy.data.worlds.new("Aircraft Workshop Sky")
scene.world.use_nodes = True
background = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
background.inputs[0].default_value = (0.22, 0.29, 0.36, 1)
background.inputs[1].default_value = 0.65

WHITE = "f1eee2"
INK = "23333d"
GLASS = "31586a"
GLASS_LIGHT = "508c9c"
RUBBER = "273039"
METAL = "93a7ac"
ORANGE = "f4a33a"
RED = "e85b4a"
TEAL = "2ca9a2"
OLIVE = "6b8063"
materials = {}
airframes = {}
current = None


def cv(p):
    """Game right-handed coordinates -> Blender right-handed coordinates."""
    return (p[0], -p[2], p[1])


def iv(p):
    return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]


def mat(hexcolor):
    if hexcolor not in materials:
        rgb = tuple(int(hexcolor[i:i + 2], 16) / 255 for i in (0, 2, 4))
        m = bpy.data.materials.new("Aircraft " + hexcolor)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        # Blender's shader expects linear RGB; the export keeps authored sRGB.
        lin = tuple(v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb)
        bsdf.inputs["Base Color"].default_value = (*lin, 1)
        bsdf.inputs["Roughness"].default_value = .48 if hexcolor in (GLASS, GLASS_LIGHT) else .74
        m.diffuse_color = (*rgb, 1)
        materials[hexcolor] = m
    return materials[hexcolor]


def start(key, title, stage):
    global current
    collection = bpy.data.collections.new(title)
    scene.collection.children.link(collection)
    root = bpy.data.objects.new(title, None)
    collection.objects.link(root)
    root.location = cv(stage)
    root["airframe"] = key
    root["source"] = "Original Mayhem Meadows artwork; built in Blender"
    current = {"key": key, "title": title, "root": root, "collection": collection, "parts": []}
    airframes[key] = current


def mesh(name, vertices, faces, color, pivot=(0, 0, 0), animation=None):
    verts = [cv(tuple(v[i] - pivot[i] for i in range(3))) for v in vertices]
    data = bpy.data.meshes.new(current["key"] + " " + name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mat(color))
    # Blender renders backfaces by default; WebGL does not. Orient every closed
    # shell outward so the exact exported mesh is visible with front-face culling.
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    data.update()
    obj = bpy.data.objects.new(name, data)
    current["collection"].objects.link(obj)
    obj.parent = current["root"]
    obj.location = cv(pivot)
    obj["color"] = "#" + color
    if animation:
        obj["animation"] = animation
    current["parts"].append(obj)
    return obj


def box(name, c, d, color, pivot=(0, 0, 0), animation=None):
    x, y, z = c
    a, b, c = (q / 2 for q in d)
    verts = [(x + sx * a, y + sy * b, z + sz * c)
             for sx, sy, sz in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
    return mesh(name, verts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                              (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)], color, pivot, animation)


def hull(name, rings, color, segments=12):
    # Rings: longitudinal X, vertical centre Y, half-height, half-width.
    verts = []
    for x, y, h, w in rings:
        for j in range(segments):
            t = 2 * math.pi * j / segments
            verts.append((x, y + math.sin(t) * h, math.cos(t) * w))
    faces = [tuple(reversed(range(segments)))]
    for r in range(len(rings) - 1):
        for j in range(segments):
            a, b = r * segments + j, r * segments + (j + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.append(tuple((len(rings) - 1) * segments + j for j in range(segments)))
    return mesh(name, verts, faces, color)


def tube(name, a, b, r, color, segments=10, pivot=(0, 0, 0), animation=None, r2=None):
    a, b = Vector(a), Vector(b)
    axis = (b - a).normalized()
    u = axis.cross(Vector((0, 1, 0)))
    if u.length < .01:
        u = axis.cross(Vector((0, 0, 1)))
    u.normalize()
    v = axis.cross(u).normalized()
    verts = []
    for centre, radius in [(a, r), (b, r if r2 is None else r2)]:
        for j in range(segments):
            t = 2 * math.pi * j / segments
            verts.append(centre + (u * math.cos(t) + v * math.sin(t)) * radius)
    faces = [tuple(reversed(range(segments))), tuple(range(segments, segments * 2))]
    faces += [(j, (j + 1) % segments, (j + 1) % segments + segments, j + segments)
              for j in range(segments)]
    return mesh(name, verts, faces, color, pivot, animation)


def aerofoil(name, outline, y, thick, color, pivot=(0, 0, 0), animation=None):
    # Outline ordered around the X/Z plane. The top is shallowly faceted.
    n = len(outline)
    verts = [(x, y - thick / 2, z) for x, z in outline]
    verts += [(x, y + thick / 2, z) for x, z in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(j, (j + 1) % n, (j + 1) % n + n, j + n) for j in range(n)]
    return mesh(name, verts, faces, color, pivot, animation)


def fin(name, outline, halfwidth, color, z=0):
    n = len(outline)
    verts = [(x, y, z - halfwidth) for x, y in outline] + [(x, y, z + halfwidth) for x, y in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(j, (j + 1) % n, (j + 1) % n + n, j + n) for j in range(n)]
    return mesh(name, verts, faces, color)


def wheel(x, y, z, r=.28, width=.22):
    tube("Tyre", (x, y, z - width / 2), (x, y, z + width / 2), r, RUBBER, 12)
    tube("Wheel hub", (x, y, z - width / 2 - .012), (x, y, z + width / 2 + .012), r * .46, METAL, 10)


def window_patch(name, points, color=GLASS):
    return mesh(name, points, [tuple(range(len(points)))], color)


def lights(x, y, z):
    box("Port navigation light", (x, y, -z), (.18, .12, .18), RED)
    box("Starboard navigation light", (x, y, z), (.18, .12, .18), "77db88")


def propeller(x, y, z, radius=1.0, blades=2):
    pivot = (x, y, z)
    tube("Propeller spinner", (x - .12, y, z), (x + .27, y, z), .20, INK, 10, pivot, "propeller", .04)
    for k in range(blades):
        t = k * math.tau / blades
        coords = []
        for r, angle in [(.15, -.25), (radius * .94, -.085), (radius, .045), (.18, .42)]:
            coords.append((x + .025, y + r * math.cos(t + angle), z + r * math.sin(t + angle)))
        mesh("Propeller blade", coords, [(0, 1, 2, 3), (3, 2, 1, 0)], INK, pivot, "propeller")
        # Bright tips read clearly at idle and in flight.
        coords = []
        for r, angle in [(radius * .82, -.085), (radius * .94, -.085), (radius, .045), (radius * .85, .075)]:
            coords.append((x + .03, y + r * math.cos(t + angle), z + r * math.sin(t + angle)))
        mesh("Propeller safety tip", coords, [(0, 1, 2, 3), (3, 2, 1, 0)], ORANGE, pivot, "propeller")


def rotor(x, y, z, radius, blades=3):
    pivot = (x, y, z)
    tube("Rotor mast", (x, y - .6, z), (x, y + .12, z), .105, METAL)
    tube("Main rotor hub", (x, y - .05, z), (x, y + .10, z), .26, INK, 10, pivot, "mainRotor")
    for k in range(blades):
        t = k * math.tau / blades
        outline = []
        for r, offset in [(.25, -.12), (radius * .98, -.10), (radius, .20), (.45, .30)]:
            outline.append((x + r * math.cos(t) + offset * math.sin(t),
                            z + r * math.sin(t) - offset * math.cos(t)))
        aerofoil("Main rotor blade", outline, y, .045, INK, pivot, "mainRotor")
        tip = []
        for r, offset in [(radius * .87, -.10), (radius * .98, -.10), (radius, .20), (radius * .89, .20)]:
            tip.append((x + r * math.cos(t) + offset * math.sin(t),
                        z + r * math.sin(t) - offset * math.cos(t)))
        aerofoil("Main rotor safety tip", tip, y + .025, .018, ORANGE, pivot, "mainRotor")


def tail_rotor(x, y, z, radius=.75):
    pivot = (x, y, z)
    tube("Tail rotor hub", (x, y, z - .12), (x, y, z + .14), .13, METAL, 8, pivot, "tailRotor")
    for k in range(3):
        t = k * math.tau / 3
        verts = []
        for r, offset in [(.12, -.06), (radius, -.06), (radius, .12), (.16, .16)]:
            verts.append((x + r * math.cos(t) + offset * math.sin(t),
                          y + r * math.sin(t) - offset * math.cos(t), z + .05))
        mesh("Tail rotor blade", verts, [(0, 1, 2, 3), (3, 2, 1, 0)], INK, pivot, "tailRotor")


def trainer():
    start("trainer", "01 Meadowlark trainer", (-24, 0, -20))
    hull("Ivory fuselage", [(-3.65, 1.65, .12, .12), (-2.5, 1.53, .27, .27),
                            (-.8, 1.51, .54, .55), (.9, 1.48, .57, .58),
                            (2.5, 1.42, .43, .46), (3.1, 1.41, .31, .33)], WHITE)
    hull("Teal cowling", [(2.15, 1.42, .45, .47), (3.1, 1.41, .32, .34)], TEAL)
    hull("Cabin glazing", [(-.95, 1.90, .35, .52), (.48, 1.96, .40, .53),
                          (1.24, 1.72, .17, .48)], GLASS, 8)
    # Uprights divide the canopy into doors and windshield.
    for z in (-.54, .54):
        tube("Cabin door frame", (-.65, 1.54, z), (-.65, 2.16, z * .85), .035, WHITE, 6)
        tube("Windscreen frame", (.63, 1.54, z), (.55, 2.19, z * .87), .035, WHITE, 6)
        tube("Door sill", (-.9, 1.49, z), (.85, 1.49, z), .025, TEAL, 6)
        box("Door handle", (-.45, 1.52, z * 1.05), (.21, .045, .045), INK)
    aerofoil("High wing", [(1.0, -5.25), (-.55, -5.25), (-.95, -1), (-.95, 1), (-.55, 5.25), (1.0, 5.25)], 2.35, .15, WHITE)
    for sign in (-1, 1):
        aerofoil("Wingtip teal", [(1.0, sign * 4.6), (-.60, sign * 4.6), (-.55, sign * 5.25), (1.0, sign * 5.25)], 2.44, .035, TEAL)
        tube("Wing support", (.2, .95, sign * .38), (-.1, 2.26, sign * 3.3), .045, METAL, 6)
        tube("Main gear", (.3, .95, sign * .45), (.1, .30, sign * 1.1), .075, WHITE, 8)
        wheel(.1, .29, sign * 1.11, .29, .22)
    tube("Nose gear", (2.1, 1.15, 0), (2.05, .24, 0), .06, METAL, 8)
    wheel(2.05, .23, 0, .23, .18)
    aerofoil("Tailplane", [(-2.50, -1.9), (-3.55, -1.8), (-3.65, 1.8), (-2.50, 1.9)], 1.73, .10, TEAL)
    fin("Vertical tail", [(-3.6, 1.65), (-3.55, 3.05), (-2.95, 2.95), (-2.25, 1.65)], .085, TEAL)
    fin("Tail flash", [(-3.56, 2.45), (-3.55, 2.7), (-3.12, 2.64), (-2.98, 2.39)], .093, WHITE)
    propeller(3.18, 1.41, 0, 1.12, 2)
    lights(.5, 2.46, 5.20)


def commuter():
    start("commuter", "02 Cloudliner commuter", (0, 0, -20))
    hull("Commuter fuselage", [(-6.5, 2.35, .19, .15), (-5.1, 2.05, .55, .48),
                               (-3, 2.08, .86, .84), (3.8, 2.10, .86, .86),
                               (5.3, 2.03, .64, .70), (6.35, 1.83, .26, .30)], WHITE)
    hull("Blue lower fuselage", [(-5.4, 1.77, .25, .39), (-3, 1.68, .48, .78),
                                  (3.5, 1.68, .49, .79), (5.4, 1.75, .28, .55)], "327eaa")
    for s in (-1, 1):
        for x in (-2.8, -1.55, -.3, .95, 2.2, 3.4):
            box("Passenger window", (x, 2.38, s * .807), (.59, .42, .055), GLASS)
        box("Passenger door", (-3.9, 2.0, s * .66), (.82, 1.25, .04), "cbd7d8")
        box("Door window", (-3.9, 2.34, s * .691), (.48, .38, .035), GLASS)
        tube("Main undercarriage", (-1.3, 1.60, s * 1.0), (-1.4, .40, s * 1.75), .11, METAL, 8)
        wheel(-1.4, .36, s * 1.75, .36, .28)
        aerofoil("Wing", [(2.0, s * .5), (.2, s * 8.3), (-1.5, s * 8.0), (-1.3, s * .5)], 2.88, .20, WHITE)
        aerofoil("Wingtip blue", [(.37, s * 7.7), (.2, s * 8.3), (-1.5, s * 8), (-1.46, s * 7.4)], 3.0, .04, "327eaa")
        hull_obj = hull("Turboprop nacelle", [(-1.0, 2.36, .28, .33), (.9, 2.39, .49, .46),
                                             (2.65, 2.38, .40, .39)], WHITE, 10)
        # Translate each nacelle in its mesh so its pivot remains zero.
        for v in hull_obj.data.vertices:
            v.co.y -= s * 2.65
        propeller(2.79, 2.39, s * 2.65, 1.40, 4)
    # Cockpit glazing split down the middle, without a transparent body.
    hull("Cockpit crown", [(4.0, 2.55, .41, .71), (4.85, 2.48, .31, .61),
                           (5.5, 2.19, .14, .43)], GLASS, 8)
    tube("Nose gear", (4.9, 1.69, 0), (4.8, .31, 0), .085, METAL, 8)
    wheel(4.8, .29, 0, .29, .24)
    fin("Blue vertical tail", [(-6.4, 2.2), (-6.05, 5.1), (-4.9, 4.95), (-3.5, 2.25)], .14, "327eaa")
    fin("Tail orange flash", [(-6.13, 4.0), (-6.05, 4.45), (-5.17, 4.28), (-4.95, 3.86)], .15, ORANGE)
    aerofoil("Horizontal tail", [(-4.5, -3), (-6.25, -2.9), (-6.25, 2.9), (-4.5, 3)], 2.65, .14, "327eaa")
    lights(.5, 3.03, 8.2)


def light_heli(key, title, stage, body, stripe, variant):
    start(key, title, stage)
    hull("Cabin shell", [(-1.8, 1.60, .42, .50), (-1, 1.62, .76, .85),
                          (.9, 1.58, .80, .91), (2.25, 1.49, .59, .66),
                          (2.8, 1.40, .27, .32)], body)
    hull("Cockpit bubble", [(.25, 1.90, .60, .86), (1.6, 1.79, .59, .80),
                             (2.55, 1.52, .32, .47)], GLASS, 10)
    # Roof and keel keep the canopy framed instead of one featureless bubble.
    box("Cabin roof", (.0, 2.29, 0), (2.2, .17, 1.52), body)
    hull("Cabin belt", [(-1.65, 1.26, .15, .55), (.8, 1.16, .15, .86), (2.27, 1.21, .12, .58)], stripe, 8)
    for s in (-1, 1):
        tube("Windscreen pillar", (1.32, 1.30, s * .81), (1.03, 2.31, s * .66), .045, body, 6)
        tube("Sliding door frame", (-.63, 1.06, s * .78), (-.63, 2.27, s * .71), .045, body, 6)
        tube("Rear door frame", (-1.39, 1.24, s * .57), (-1.15, 2.18, s * .60), .04, body, 6)
        box("Cabin door handle", (-.75, 1.44, s * .84), (.26, .05, .05), METAL)
        tube("Skid rail", (-1.7, .16, s * 1.0), (1.8, .16, s * 1.0), .09, INK, 10)
        tube("Skid upturned toe", (1.8, .16, s * 1.0), (2.15, .43, s * 1.0), .09, INK, 10)
        for x in (-.9, 1.0):
            tube("Skid support", (x, 1.1, s * .45), (x, .2, s * 1.0), .065, METAL, 8)
    hull("Tail boom", [(-1.4, 1.74, .38, .37), (-3.5, 1.95, .20, .18), (-6.1, 2.18, .10, .10)], body, 8)
    fin("Tail fin", [(-6.25, 1.45), (-6.2, 3.25), (-5.65, 3.17), (-5.25, 2.13)], .075, stripe)
    aerofoil("Tail stabiliser", [(-4.4, -1.25), (-5.35, -1.15), (-5.35, 1.15), (-4.4, 1.25)], 1.99, .08, stripe)
    hull("Engine fairing", [(-1.4, 2.27, .26, .4), (-.5, 2.50, .32, .41), (.3, 2.46, .22, .32)], body, 8)
    for s in (-1, 1):
        tube("Turbine exhaust", (-1.55, 2.36, s * .29), (-1.92, 2.29, s * .30), .15, INK, 10)
    rotor(-.5, 3.06, 0, 5.1, 3)
    tail_rotor(-5.85, 2.25, .19, .72)
    box("Tail beacon", (-6.1, 3.27, 0), (.20, .12, .17), RED)
    tube("Roof antenna", (-.80, 2.55, .55), (-1.1, 3.05, .55), .023, INK, 6)
    lights(-.15, 2.4, .82)
    if variant == "news":
        tube("Camera mount", (1.25, 1.05, 0), (1.35, .68, 0), .07, METAL, 8)
        hull("Broadcast camera gimbal", [(.95, .57, .23, .25), (1.45, .57, .28, .28), (1.72, .57, .17, .18)], WHITE, 10)
        tube("Camera lens", (1.64, .57, 0), (1.86, .57, 0), .13, INK, 12)
        tube("Camera glass", (1.85, .57, 0), (1.87, .57, 0), .10, GLASS_LIGHT, 12)
        tube("Broadcast aerial", (-1.1, 2.57, -.45), (-1.1, 3.00, -.45), .035, METAL, 6)
        tube("Broadcast aerial crossbar", (-1.1, 2.98, -.7), (-1.1, 2.98, -.2), .025, METAL, 6)
        for s in (-1, 1):
            box("News identity panel", (-.35, 1.56, s * .874), (.69, .31, .035), "f3b746")
    if variant == "police":
        box("Police blue beacon", (-.35, 2.44, .59), (.36, .14, .19), "5bafff")
        box("Police red beacon", (-.35, 2.44, -.59), (.36, .14, .19), RED)
        tube("Searchlight mount", (1.7, 1.10, -.35), (1.7, .84, -.35), .06, METAL, 8)
        tube("Searchlight housing", (1.7, .86, -.35), (1.84, .65, -.35), .22, INK, 12)
        tube("Searchlight lens", (1.82, .67, -.35), (1.85, .63, -.35), .19, "fff0b0", 12)
        # Side-mounted toy impact-round cannon; muzzle faces starboard (+Z).
        box("Gunner mounting rail", (.20, 1.14, 1.04), (1.45, .13, .16), METAL)
        tube("Cannon swivel", (.22, 1.14, 1.03), (.22, 1.45, 1.03), .10, INK, 8)
        box("Impact cannon breech", (.22, 1.42, 1.02), (.43, .35, .44), INK)
        tube("Impact drum magazine", (-.06, 1.42, 1.04), (-.06, 1.42, 1.40), .27, "879494", 12)
        for dx, dy in [(-.085, -.075), (.085, -.075), (-.085, .075), (.085, .075)]:
            tube("Impact cannon barrel", (.3 + dx, 1.42 + dy, 1.16), (.3 + dx, 1.42 + dy, 1.83), .045, METAL, 8)
        tube("Cannon orange safety collar", (.3, 1.42, 1.69), (.3, 1.42, 1.84), .19, ORANGE, 10)
        for s in (-1, 1):
            box("Police door shield", (-.15, 1.58, s * .88), (.52, .38, .04), "dce9e4")


def transport():
    start("transportheli", "06 Atlas transport helicopter", (24, 0, 0))
    hull("Armoured cargo cabin", [(-4.45, 2.30, .59, .69), (-2.8, 2.3, 1.12, 1.28),
                                    (2.25, 2.28, 1.17, 1.31), (4.3, 2.13, .96, 1.09),
                                    (5.0, 1.94, .42, .56)], OLIVE, 12)
    hull("Transport cockpit", [(2.35, 2.8, .64, 1.16), (3.75, 2.62, .66, 1.08),
                                 (4.8, 2.19, .35, .64)], GLASS, 8)
    for s in (-1, 1):
        box("Sliding cargo door", (-1.0, 2.27, s * 1.25), (2.8, 1.50, .08), "819177")
        for x in (-1.7, -.3, 1.3):
            box("Cargo cabin window", (x, 2.6, s * 1.31), (.74, .52, .05), GLASS)
        tube("Cargo door rail", (-2.7, 3.12, s * 1.26), (.65, 3.12, s * 1.26), .045, METAL, 6)
        box("Door handle", (-1.9, 2.0, s * 1.31), (.31, .08, .07), INK)
        tube("Front gear", (3.6, 1.5, s * .8), (3.6, .45, s * 1.38), .13, METAL, 8)
        wheel(3.6, .40, s * 1.4, .4, .31)
        tube("Main gear", (-2.8, 1.4, s * 1.0), (-2.9, .45, s * 1.85), .15, METAL, 8)
        wheel(-2.9, .43, s * 1.87, .43, .35)
        hull_obj = hull("Turbine pod", [(-2.5, 3.3, .36, .40), (.2, 3.42, .47, .48), (1.3, 3.31, .35, .35)], OLIVE, 10)
        for v in hull_obj.data.vertices:
            v.co.y -= s * .72
        tube("Engine intake", (1.3, 3.3, s * .72), (1.37, 3.3, s * .72), .28, INK, 10)
        tube("Hot exhaust", (-2.4, 3.31, s * .72), (-2.9, 3.30, s * .72), .24, INK, 10)
    hull("Transport tail boom", [(-3.6, 2.66, .70, .70), (-6.4, 2.88, .37, .32), (-10.0, 3.34, .14, .12)], OLIVE, 10)
    fin("Transport tail fin", [(-10.1, 2.6), (-9.95, 5.0), (-9.05, 4.85), (-8.4, 3.18)], .13, OLIVE)
    aerofoil("Tailplanes", [(-7.45, -2.1), (-9.0, -1.9), (-9.0, 1.9), (-7.45, 2.1)], 3.12, .14, "3f5247")
    rotor(-.45, 4.24, 0, 7.1, 4)
    tail_rotor(-9.5, 3.65, .29, 1.02)
    box("Rescue belly panel", (.6, 1.16, 0), (1.3, .07, 1.2), ORANGE)
    for s in (-1, 1):
        box("Transport identity flash", (-3.2, 2.25, s * 1.1), (.36, .73, .06), "e4dfc6")
    lights(-1, 3.5, 1.2)


def fighter():
    start("fighter", "07 Kestrel interceptor", (-24, 0, 20))
    hull("Interceptor fuselage", [(-6.5, 1.75, .40, .47), (-4.2, 1.68, .76, .85),
                                  (-1.2, 1.60, .72, .95), (2.7, 1.67, .60, .62),
                                  (5.4, 1.61, .35, .37), (7.2, 1.56, .025, .035)], "a8b9b2", 10)
    hull("Canopy glass", [(-.15, 2.1, .32, .48), (1.1, 2.31, .57, .52),
                            (2.55, 2.18, .46, .45), (3.05, 1.99, .08, .23)], GLASS, 10)
    hull("Nose dark cap", [(5.55, 1.61, .33, .35), (7.2, 1.56, .026, .036)], "526a67", 10)
    for s in (-1, 1):
        aerofoil("Swept wing", [(1.2, s * .7), (-2.5, s * 5.1), (-5.4, s * 4.9), (-3.7, s * .5)], 1.53, .17, "839a92")
        aerofoil("Wing safety flash", [(-2.4, s * 4.75), (-2.5, s * 5.1), (-3.3, s * 5.04), (-3.19, s * 4.70)], 1.63, .025, ORANGE)
        aerofoil("Tailplane", [(-4.9, s * .5), (-5.5, s * 2.8), (-7.0, s * 2.6), (-6.2, s * .4)], 1.83, .10, "526a67")
        fin("Canted twin fin", [(-6.0, 1.8), (-5.4, 4.35), (-4.25, 4.17), (-3.65, 1.85)], .10, "526a67", s * .65)
        fin("Fin orange flash", [(-5.55, 3.7), (-5.45, 4.1), (-4.46, 3.95), (-4.57, 3.57)], .113, ORANGE, s * .65)
        # Dark side intakes and landing gear give a useful ground silhouette.
        hull_obj = hull("Intake housing", [(-2.8, 1.35, .37, .35), (.4, 1.38, .42, .37)], "839a92", 8)
        for v in hull_obj.data.vertices:
            v.co.y -= s * .85
        tube("Engine intake shadow", (.43, 1.38, s * .85), (.48, 1.38, s * .85), .31, INK, 8)
        tube("Main gear strut", (-2.5, 1.3, s * .6), (-2.45, .34, s * 1.25), .08, METAL, 8)
        wheel(-2.45, .31, s * 1.25, .31, .25)
        tube("Exhaust outer ring", (-6.58, 1.74, s * .38), (-6.20, 1.74, s * .38), .36, INK, 10)
        tube("Exhaust inner ring", (-6.60, 1.74, s * .38), (-6.63, 1.74, s * .38), .26, "526a67", 10)
    tube("Nose gear", (3.6, 1.3, 0), (3.65, .28, 0), .07, METAL, 8)
    wheel(3.65, .26, 0, .26, .21)
    lights(-2.6, 1.68, 5.02)


trainer()
commuter()
light_heli("helicopter", "03 Firefly civilian helicopter", (24, 0, -20), WHITE, TEAL, "civil")
light_heli("news", "04 Channel Six news helicopter", (-24, 0, 0), "ecb43d", "cc573f", "news")
light_heli("policeheli", "05 Patrol police helicopter", (0, 0, 0), "324c64", WHITE, "police")
transport()
fighter()

# Export only our meshes; local part geometry is expressed relative to its pivot.
export = {}
total_triangles = 0
for key, item in airframes.items():
    parts = []
    all_positions = []
    for obj in item["parts"]:
        data = obj.data
        data.calc_loop_triangles()
        positions = [v for vert in data.vertices for v in iv(vert.co)]
        indices = [v for tri in data.loop_triangles for v in tri.vertices]
        pivot = iv(obj.location)
        part = {"name": obj.name, "positions": positions, "indices": indices,
                "color": obj["color"], "pivot": pivot}
        if "animation" in obj:
            part["animation"] = obj["animation"]
        parts.append(part)
        total_triangles += len(indices) // 3
        all_positions.extend([[positions[i + j] + pivot[j] for j in range(3)]
                              for i in range(0, len(positions), 3)])
        # A three-blade rotor's idle pose is narrower than its turning sweep.
        # Include that sweep in framing and selection dimensions.
        spin_axes = {"mainRotor": (0, 2), "tailRotor": (0, 1), "propeller": (1, 2)}
        if obj.get("animation") in spin_axes:
            a, b = spin_axes[obj["animation"]]
            radius = max(math.hypot(positions[i + a], positions[i + b])
                         for i in range(0, len(positions), 3))
            for axis in (a, b):
                for sign in (-1, 1):
                    point = pivot[:]
                    point[axis] += radius * sign
                    all_positions.append(point)
    low = [min(p[i] for p in all_positions) for i in range(3)]
    high = [max(p[i] for p in all_positions) for i in range(3)]
    export[key] = {"name": item["title"][3:], "parts": parts,
                   "bounds": {"length": round(high[0] - low[0], 3),
                              "height": round(high[1] - low[1], 3),
                              "width": round(high[2] - low[2], 3)}}

runtime = os.path.join(ROOT, "aircraft-models.js")
with open(runtime, "w", encoding="utf-8", newline="\n") as f:
    f.write("/* Original Mayhem Meadows fleet. Authored in Blender; regenerate with tools/export-aircraft.py.\n")
    f.write(" * Metres: +X forward, +Y up, +Z starboard. Animated parts use local pivot coordinates. */\n")
    f.write("(function (root) {\n  'use strict';\n  root.MayhemAircraftModels = ")
    f.write(json.dumps(export, separators=(",", ":")))
    f.write(";\n})(typeof window !== 'undefined' ? window : globalThis);\n")

with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump({"author": "Mayhem Meadows", "license": "MIT", "source": "aircraft-workshop.blend",
               "generator": "../../tools/export-aircraft.py", "units": "metres",
               "coordinates": "+X forward; +Y up; +Z starboard",
               "airframes": {key: {"name": x["name"], "bounds": x["bounds"],
                                    "triangles": sum(len(p["indices"]) // 3 for p in x["parts"])}
                              for key, x in export.items()}}, f, indent=2)
    f.write("\n")

# A neutral studio scene makes the source pleasant to inspect and edit.
floor_mesh = bpy.data.meshes.new("Workshop floor")
floor_mesh.from_pydata([(-42, -36, -.06), (42, -36, -.06), (42, 35, -.06), (-42, 35, -.06)], [], [(0, 1, 2, 3)])
floor = bpy.data.objects.new("Workshop floor", floor_mesh)
scene.collection.objects.link(floor)
floor.data.materials.append(mat("d0d9d4"))

def light(name, loc, power, size):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat("-Z", "Y").to_euler()

light("Large softbox", (10, -20, 38), 8000, 30)
light("Warm rim", (-25, 20, 25), 5000, 22)
camera_data = bpy.data.cameras.new("Fleet overview")
camera = bpy.data.objects.new("Fleet overview", camera_data)
scene.collection.objects.link(camera)
camera.location = (42, -61, 55)
camera.rotation_euler = (Vector((0, 0, 1)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 93
scene.camera = camera
scene.render.resolution_x = 1500
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.join(OUT, "fleet-preview.png")
scene.render.film_transparent = False
try:
    scene.render.engine = "BLENDER_EEVEE"
except TypeError:
    pass
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            area.spaces.active.shading.color_type = "MATERIAL"
            area.spaces.active.clip_end = 1000
            area.spaces.active.region_3d.view_distance = 75

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "aircraft-workshop.blend"), copy=True, compress=True)
bpy.ops.render.render(write_still=True)
print(json.dumps({"airframes": len(export), "triangles": total_triangles,
                  "runtime_bytes": os.path.getsize(runtime), "output": OUT,
                  "bounds": {k: v["bounds"] for k, v in export.items()}}, indent=2))
