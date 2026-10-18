"""Author the fictional Northwatch M-4 tank in actual Blender and export meshes.

Run: blender --background --python tools/export-tank.py
The editable workshop is a new scene; an existing scene is never erased.
Game coordinates use metres, X forward, Y up, Z right, with the origin on ground.
"""
import bpy, bmesh, json, math, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'tanks')
os.makedirs(OUT, exist_ok=True)
scene = bpy.data.scenes.new('Northwatch M-4 Tank Workshop')
bpy.context.window.scene = scene
scene.world = bpy.data.worlds.new('Tank Workshop Sky')
scene.world.use_nodes = True
sky = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
sky.inputs[0].default_value = (.28, .36, .4, 1)
sky.inputs[1].default_value = .6
collection = bpy.data.collections.new('Editable Northwatch M-4')
scene.collection.children.link(collection)
materials, parts, pivots = {}, [], {}
metadata = {
    'bounds': {'length': 5.2, 'width': 2.4, 'height': 2.6},
    'hull': {'length': 5.2, 'width': 2.4, 'height': 1.4},
    'turretPivot': [0, 1.55, 0], 'turretBounds': [2.2, .95, 1.6],
    'turretCenter': [0, .375, 0], 'gunPivot': [.9, .5, 0],
    'barrelLength': 3.1, 'barrelRadius': .1, 'muzzle': [3.1, 0, 0],
    'wheelRadius': .37, 'wheelHeight': .5,
    'wheelXs': [-1.9, -1.14, -.38, .38, 1.14, 1.9],
    'trackZ': .99, 'trackHalfStraight': 1.9, 'trackRadius': .47,
    'trackCenterHeight': .54, 'treadsPerSide': 30,
}

def coord(v):
    x, y, z = v
    return (x, -z, y)

for name, position in [('hull', (0, 0, 0)), ('turret', metadata['turretPivot']),
                       ('cannon', metadata['gunPivot']), ('wheel', (0, 0, 0)),
                       ('tread', (0, 0, 0))]:
    obj = bpy.data.objects.new(name.title()+' Pivot', None)
    collection.objects.link(obj)
    obj.empty_display_type = 'ARROWS'; obj.empty_display_size = .3
    obj.location = coord(position)
    if name == 'cannon': obj.parent = pivots['turret']
    pivots[name] = obj

def material(color):
    if color not in materials:
        rgb = [int(color[i:i+2], 16)/255 for i in (0, 2, 4)]
        mat = bpy.data.materials.new('M-4 '+color)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*[v/12.92 if v < .04045 else ((v+.055)/1.055)**2.4 for v in rgb], 1)
        bsdf.inputs['Roughness'].default_value = .8
        mat.diffuse_color = (*rgb, 1)
        materials[color] = mat
    return materials[color]

def mesh(name, vertices, faces, color, group='hull', paint=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([coord(v) for v in vertices], [], faces)
    bm = bmesh.new(); bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data); bm.free()
    data.materials.append(material(color))
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj); obj.parent = pivots[group]
    obj['color'] = '#'+color; obj['group'] = group; obj['paint'] = paint
    parts.append(obj)
    return obj

def box(name, center, size, color, group='hull', paint=False):
    x, y, z = center; a, b, c = [v/2 for v in size]
    vertices = [(x+sx*a,y+sy*b,z+sz*c) for sx,sy,sz in
                [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    return mesh(name, vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)], color, group, paint)

def prism(name, profile, depth, color, group='hull', paint=False):
    n = len(profile)
    vertices = [(x,y,z) for z in [-depth/2,depth/2] for x,y in profile]
    faces = [tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
    faces += [(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)]
    return mesh(name, vertices, faces, color, group, paint)

def cylinder(name, center, radius, length, color, group='hull', axis='x', sides=12, paint=False):
    vertices=[]
    for end in [-length/2,length/2]:
        for i in range(sides):
            a=i*math.tau/sides
            p=(end,radius*math.sin(a),radius*math.cos(a)) if axis=='x' else (radius*math.cos(a),radius*math.sin(a),end)
            vertices.append(tuple(center[k]+p[k] for k in range(3)))
    return mesh(name,vertices,[tuple(range(sides-1,-1,-1)),tuple(range(sides,sides*2))]+[(j,(j+1)%sides,(j+1)%sides+sides,j+sides) for j in range(sides)],color,group,paint)

# Sloped armour remains inside the actual 5.2 x 2.4 metre hull collider.
prism('Lower armoured hull',[(-2.6,.35),(2.6,.35),(2.6,.9),(2.22,1.3),(-2.1,1.3),(-2.6,1.05)],1.9,'718565',paint=True)
prism('Upper sloped armour',[(-2.35,.95),(2.6,.95),(2.05,1.4),(-1.95,1.4)],2.08,'839775',paint=True)
box('Engine deck',(-1.55,1.37,0),(1.3,.03,1.5),'566b53')
for x in [-2.05,-1.85,-1.65,-1.45,-1.25,-1.05]:
    box('Engine cooling louvre',(x,1.39,0),(.065,.018,1.3),'394b43')
for side in [-1,1]:
    z=side*metadata['trackZ']
    profile=[]
    for i in range(9):
        a=-math.pi/2+i*math.pi/8; profile.append((1.9+.47*math.cos(a),.54+.47*math.sin(a)))
    for i in range(9):
        a=math.pi/2+i*math.pi/8; profile.append((-1.9+.47*math.cos(a),.54+.47*math.sin(a)))
    track=prism('Continuous track belt '+str(side),profile,.4,'35463f')
    track.location.y=-z
    box('Track mudguard',(0,1.05,side*1.035),(4.96,.14,.33),'62795b',paint=True)
    for x in [-2.25,2.25]: box('Tow eye',(x,.63,side*.76),(.24,.16,.22),'c0bda2')
    box('Headlamp guard',(2.25,1.25,side*.79),(.18,.13,.2),'d5d5ad')
    box('Rear lamp',(-2.54,.98,side*.78),(.035,.11,.18),'b66c54')
    box('Side stowage',(-.75,1.27,side*1.067),(1.03,.25,.12),'75896a',paint=True)

# A faceted turret and a 3.1 metre cannon rotate on independent exported pivots.
prism('Turret armour',[(-1.1,-.1),(1.1,-.1),(1.1,.48),(.65,.85),(-.85,.85),(-1.1,.55)],1.6,'7e9270','turret',True)
box('Turret roof',(-.14,.86,0),(1.1,.04,1.22),'879a78','turret',True)
box('Command cupola',(-.4,.95,-.26),(.62,.18,.65),'63795a','turret',True)
box('Cupola hatch',(-.4,1.045,-.26),(.52,.01,.54),'a4ad8b','turret')
box('Periscope',(.35,.91,-.49),(.3,.1,.16),'334c47','turret')
box('Periscope glass',(.49,.91,-.49),(.025,.06,.12),'789ca4','turret')
for side in [-1,1]:
    box('Turret side marking',(-.2,.39,side*.805),(.42,.25,.014),'ddd9b4','turret')
    box('Marking inset',(-.2,.39,side*.815),(.18,.25,.015),'7e9270','turret',True)
    box('Smoke launcher',(.63,.26,side*.73),(.38,.18,.14),'435a4a','turret')
box('Cannon mantlet',(-.08,0,0),(.45,.38,.58),'5a7353','cannon',True)
cylinder('Cannon tube',(1.55,0,0),.1,3.1,'5b7057','cannon',paint=True)
cylinder('Cannon sleeve',(.27,0,0),.17,.6,'7f9172','cannon',paint=True)
box('Muzzle brake',(2.98,0,0),(.24,.25,.22),'4c6250','cannon')
box('Dark muzzle',(3.099,0,0),(.002,.135,.135),'202e2b','cannon')

# Shared moving parts are authored once, then instanced around the real tracks.
cylinder('Road wheel', (0,0,0),.37,.34,'596d52','wheel',axis='z',paint=True)
cylinder('Wheel hub',(0,0,.17),.15,.04,'a6ad8b','wheel',axis='z')
box('Wheel spoke',(0,0,.192),(.49,.055,.012),'839775','wheel',True)
box('Tread shoe',(0,0,0),(.26,.075,.42),'43564a','tread')
box('Tread grip',(0,-.045,0),(.055,.035,.42),'879080','tread')

export = {'metadata': metadata, 'parts': []}
for obj in parts:
    data=obj.data; data.calc_loop_triangles()
    # Apply within-part offsets, but leave the animation pivot as the runtime parent.
    positions=[]
    for v in data.vertices:
        p=obj.matrix_local @ v.co
        positions.extend(round(value,5) for value in (p.x,p.z,-p.y))
    export['parts'].append({'name':obj.name,'group':obj['group'],'positions':positions,
                            'indices':[i for t in data.loop_triangles for i in t.vertices],
                            'color':obj['color'],'paint':bool(obj['paint'])})
with open(os.path.join(ROOT,'tank-models.js'),'w',encoding='utf-8',newline='\n') as file:
    file.write('/* Original fictional Blender tank: tools/export-tank.py. Metres, X forward, Y up, Z right. */\n(function(root){\n"use strict";root.MayhemTankModels=')
    file.write(json.dumps(export,separators=(',',':')))
    file.write(';\nif(typeof module!=="undefined"&&module.exports)module.exports=root.MayhemTankModels;\n})(globalThis);\n')
manifest={'author':'Mayhem Meadows','license':'MIT','fictional':True,'source':'northwatch-tank.blend',
          'generator':'../../tools/export-tank.py','units':'metres','blenderVersion':bpy.app.version_string,
          'metadata':metadata,'parts':len(parts),'triangles':sum(len(p['indices'])//3 for p in export['parts'])}
with open(os.path.join(OUT,'manifest.json'),'w',encoding='utf-8',newline='\n') as file:
    json.dump(manifest,file,indent=2); file.write('\n')

# Put moving-part copies in their operating positions for the editable preview.
for side in [-1,1]:
    for x in metadata['wheelXs']:
        for source in [p for p in parts if p['group']=='wheel']:
            obj=source.copy(); obj.data=source.data; collection.objects.link(obj); obj.parent=pivots['hull']
            obj.location=coord((x,.5,side*.99)); obj.rotation_euler.z=math.pi if side<0 else 0
    a=metadata['trackHalfStraight']; r=metadata['trackRadius']; length=4*a+2*math.pi*r
    for index in range(metadata['treadsPerSide']):
        d=index*length/metadata['treadsPerSide']
        if d<2*a: x,y,rotation=-a+d,.54-r,0
        elif d<2*a+math.pi*r:
            angle=-math.pi/2+(d-2*a)/r; x,y,rotation=a+r*math.cos(angle),.54+r*math.sin(angle),angle+math.pi/2
        elif d<4*a+math.pi*r: x,y,rotation=a-(d-2*a-math.pi*r),.54+r,math.pi
        else:
            angle=math.pi/2+(d-4*a-math.pi*r)/r; x,y,rotation=-a+r*math.cos(angle),.54+r*math.sin(angle),angle+math.pi/2
        for source in [p for p in parts if p['group']=='tread']:
            obj=source.copy(); obj.data=source.data; collection.objects.link(obj); obj.parent=pivots['hull']
            obj.location=coord((x,y,side*.99)); obj.rotation_euler.y=rotation
for name in ['wheel','tread']:
    pivots[name].hide_render=True; pivots[name].hide_viewport=True
    for child in pivots[name].children: child.hide_render=True; child.hide_set(True)

floor_mat=material('d4cfb2')
floor=bpy.data.meshes.new('Workshop ground'); floor.from_pydata([(-200,-200,-.07),(200,-200,-.07),(200,200,-.07),(-200,200,-.07)],[],[(0,1,2,3)])
floor.materials.append(floor_mat); obj=bpy.data.objects.new('Workshop ground',floor); scene.collection.objects.link(obj)
light=bpy.data.objects.new('Tank softbox',bpy.data.lights.new('Tank softbox','AREA')); scene.collection.objects.link(light)
light.data.energy=1900; light.data.size=8; light.location=(1,-4,10)
light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
camera=bpy.data.objects.new('Tank preview camera',bpy.data.cameras.new('Tank preview camera')); scene.collection.objects.link(camera)
camera.location=(9,-11,7); camera.rotation_euler=(Vector((.3,0,1.15))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type=next(i.identifier for i in camera.data.bl_rna.properties['type'].enum_items if i.identifier.startswith('ORTH'))
camera.data.ortho_scale=9.1; scene.camera=camera
scene.render.resolution_x=1200; scene.render.resolution_y=850; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.filepath=os.path.join(OUT,'tank-preview.png')
scene.render.engine='CYCLES'; scene.cycles.samples=24
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'northwatch-tank.blend'),copy=True,compress=True)
print(json.dumps(manifest),flush=True)
if os.environ.get('MAYHEM_SKIP_PREVIEW')!='1': bpy.ops.render.render(write_still=True)
