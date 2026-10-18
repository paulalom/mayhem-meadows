"""Original compact rail fleet. Run in live Blender; preserves other scenes.

Exports the actual Blender triangles, in metres (+X forward, +Y up, +Z right).
Two passenger cab cars or two freight cabs with a container wagon form a train.
"""
import bpy
import bmesh
import json
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'trains')
os.makedirs(OUT, exist_ok=True)
NAME = 'Mayhem Rail Workshop'
old = bpy.data.scenes.get(NAME)
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(NAME)
bpy.context.window.scene = scene
scene.world = bpy.data.worlds.new('Rail Workshop Sky')
scene.world.use_nodes = True
background = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
background.inputs[0].default_value = (.25, .32, .38, 1)
background.inputs[1].default_value = .7
materials = {}
models = {}
current = None

def material(color):
    if color not in materials:
        rgb = tuple(int(color[i:i+2], 16) / 255 for i in (0, 2, 4))
        m = bpy.data.materials.new('Rail ' + color)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*[v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb], 1)
        bsdf.inputs['Roughness'].default_value = .65
        m.diffuse_color = (*rgb, 1)
        materials[color] = m
    return materials[color]

def start(key, length, height, stage):
    global current
    collection = bpy.data.collections.new('Rail ' + key)
    scene.collection.children.link(collection)
    parent = bpy.data.objects.new('Rail ' + key, None)
    collection.objects.link(parent)
    parent.location = (0, stage, 0)
    current = {'parent': parent, 'collection': collection, 'parts': [], 'length': length, 'height': height}
    models[key] = current

def mesh(name, verts, faces, color):
    data = bpy.data.meshes.new(name)
    data.from_pydata([(x, -z, y) for x, y, z in verts], [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    data.materials.append(material(color))
    obj = bpy.data.objects.new(name, data)
    current['collection'].objects.link(obj)
    obj.parent = current['parent']
    obj['color'] = '#' + color
    current['parts'].append(obj)

def box(name, center, dimensions, color):
    x, y, z = center
    a, b, c = [v / 2 for v in dimensions]
    verts = [(x + sx*a, y + sy*b, z + sz*c) for sx, sy, sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    mesh(name, verts, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)], color)

def wheels(length):
    for bogie in [-1, 1]:
        bx = bogie * length * .31
        box('Bogie frame', (bx,.36,0), (1.25,.23,1.65), '34464b')
        for axle in [-1, 1]:
            x = bx + axle*.43
            for side in [-1, 1]:
                verts = [(x + math.cos(j*math.pi/6)*.32,.32 + math.sin(j*math.pi/6)*.32, side*.78 + end*.08) for end in [-1,1] for j in range(12)]
                faces = [tuple(range(11,-1,-1)),tuple(range(12,24))] + [(j,(j+1)%12,(j+1)%12+12,j+12) for j in range(12)]
                mesh('Steel wheel', verts, faces, '35434a')
    for end in [-1, 1]:
        box('Coupler', (end*(length/2-.12),.58,0), (.24,.18,.26), '34464b')

def cab(length, passenger):
    wheels(length)
    color = 'efead8' if passenger else 'e2b152'
    box('Underframe', (0,.62,0), (length-.25,.32,2.05), '40575c')
    # Chamfered cab roof/nose: visibly distinct from a road vehicle.
    x0, x1 = -length/2+.18, length/2-.18
    verts = [(x0,.8,-1.08),(x1,.8,-1.08),(x1,1.9,-1.08),(x1-.45,2.5,-.92),(x0,2.5,-.92),
             (x0,.8,1.08),(x1,.8,1.08),(x1,1.9,1.08),(x1-.45,2.5,.92),(x0,2.5,.92)]
    mesh('Cab body', verts, [(0,4,3,2,1),(5,6,7,8,9),(0,1,6,5),(1,2,7,6),(2,3,8,7),(3,4,9,8),(4,0,5,9)], color)
    box('Roof', (-.12,2.54,0), (length-.8,.17,1.91), '7f9695')
    for side in [-1,1]:
        box('Teal belt', (0,1.12,side*1.085), (length-.4,.31,.025), '278d91')
        box('Cab side glass', (length/2-.9,1.91,side*1.07), (.72,.62,.045), '315768')
        for x in ([-2.7,-1.6,-.5,.6] if passenger else [-1.7,-.65]):
            box('Window', (x,1.91,side*1.07), (.86,.64,.045), '315768')
        for x in ([-3.6,1.65] if passenger else [-2.55]):
            box('Sliding door', (x,1.56,side*1.09), (.6,1.4,.03), 'bbcbbd')
            box('Door glass', (x,1.95,side*1.115), (.4,.48,.025), '315768')
    box('Windscreen', (x1+.015,1.69,0), (.04,.47,1.65), '315768')
    for side in [-1,1]:
        box('Headlight', (x1+.025,1.03,side*.7), (.045,.17,.25), 'fff1b6')
        box('Tail marker', (x0-.015,1.03,side*.7), (.035,.14,.17), 'c25449')
    box('Destination board', (x1+.025,1.99,0), (.04,.13,.85), '253d46')
    for x in [-.7,.7]:
        box('Roof vent', (x,2.65,0), (.75,.12,.65), '536e75')

start('passenger', 8.5, 2.71, -4)
cab(8.5, True)
start('cab', 6, 2.71, 0)
cab(6, False)
start('container', 7, 2.55, 4)
wheels(7)
box('Flat wagon', (0,.67,0), (6.8,.26,2.16), '40575c')
box('Container', (0,1.65,0), (6.3,1.8,2.1), 'ad664d')
for side in [-1,1]:
    for i in range(21):
        box('Container rib', (-3+i*.3,1.65,side*1.062), (.055,1.77,.035), 'bc7756')
    box('Rail freight stripe', (0,1.7,side*1.09), (2.25,.27,.022), 'e4d7b0')

export = {}
for key, item in models.items():
    parts = []
    for obj in item['parts']:
        data = obj.data
        data.calc_loop_triangles()
        parts.append({'name':obj.name,'positions':[round(v,4) for p in data.vertices for v in (p.co.x,p.co.z,-p.co.y)],'indices':[v for tri in data.loop_triangles for v in tri.vertices],'color':obj['color']})
    export[key] = {'parts':parts,'bounds':{'length':item['length'],'width':2.255 if key != 'container' else 2.2,'height':item['height']}}
with open(os.path.join(ROOT,'train-models.js'),'w',encoding='utf-8',newline='\n') as file:
    file.write('/* Original Blender meshes. Regenerate with tools/export-trains.py. Metres: X forward, Y up, Z right. */\n(function(root){\n\"use strict\";root.MayhemTrainModels=')
    file.write(json.dumps(export,separators=(',',':')))
    file.write(';\nif(typeof module!==\"undefined\"&&module.exports)module.exports=root.MayhemTrainModels;\n})(globalThis);\n')
with open(os.path.join(OUT,'manifest.json'),'w',encoding='utf-8',newline='\n') as file:
    json.dump({'author':'Mayhem Meadows','license':'MIT','source':'train-workshop.blend','generator':'../../tools/export-trains.py','units':'metres','models':{key:{'bounds':v['bounds'],'triangles':sum(len(p['indices'])//3 for p in v['parts'])} for key,v in export.items()}},file,indent=2)
    file.write('\n')

lightdata = bpy.data.lights.new('Rail softbox',type='AREA')
lightdata.energy = 2400
lightdata.size = 18
light = bpy.data.objects.new('Rail softbox',lightdata)
scene.collection.objects.link(light)
light.location = (3,-8,14)
light.rotation_euler = (Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
camera = bpy.data.objects.new('Rail fleet camera',bpy.data.cameras.new('Rail fleet camera'))
scene.collection.objects.link(camera)
camera.location = (14,-19,17)
camera.rotation_euler = (Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type = next(i.identifier for i in camera.data.bl_rna.properties['type'].enum_items if i.identifier.startswith('ORTH'))
camera.data.ortho_scale = 18
scene.camera = camera
scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.filepath = os.path.join(OUT,'fleet-preview.png')
scene.render.image_settings.file_format = next(i.identifier for i in scene.render.image_settings.bl_rna.properties['file_format'].enum_items if i.identifier == 'PNG')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'train-workshop.blend'),copy=True,compress=True)
bpy.ops.render.render(write_still=True)
print(json.dumps({'models':list(export),'triangles':sum(len(p['indices'])//3 for v in export.values() for p in v['parts']),'output':OUT}))
