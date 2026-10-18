"""Author and export original low-poly Northwatch models in Blender.

Run in Blender or in a separate background Blender. No existing scene is erased.
Runtime coordinates are metres: X across/forward, Y up, Z depth/starboard.
"""
import bpy, bmesh, json, math, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'military')
os.makedirs(OUT, exist_ok=True)
scene = bpy.data.scenes.new('Mayhem Military Workshop')
bpy.context.window.scene = scene
scene.world = bpy.data.worlds.new('Northwatch Sky')
scene.world.use_nodes = True
bg = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs[0].default_value = (.32,.4,.5,1)
bg.inputs[1].default_value = .65
materials, models = {}, {}
current = None

def material(color):
    if color not in materials:
        rgb = [int(color[i:i+2],16)/255 for i in (0,2,4)]
        m = bpy.data.materials.new('Northwatch '+color)
        m.use_nodes = True
        node = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        node.inputs['Base Color'].default_value = (*[v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in rgb],1)
        node.inputs['Roughness'].default_value = .75
        m.diffuse_color = (*rgb,1)
        materials[color] = m
    return materials[color]

def start(key, width, depth, height, stage):
    global current
    coll = bpy.data.collections.new('Military '+key)
    scene.collection.children.link(coll)
    parent = bpy.data.objects.new('Military '+key,None)
    coll.objects.link(parent)
    parent.location = stage
    current = {'collection':coll,'parent':parent,'parts':[], 'bounds':{'length':width,'width':depth,'height':height}}
    models[key] = current

def mesh(name,verts,faces,color):
    data = bpy.data.meshes.new(name)
    data.from_pydata([(x,-z,y) for x,y,z in verts],[],faces)
    bm=bmesh.new(); bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(data); bm.free()
    data.materials.append(material(color))
    obj=bpy.data.objects.new(name,data)
    current['collection'].objects.link(obj); obj.parent=current['parent']; obj['color']='#'+color
    current['parts'].append(obj)

def box(name,center,size,color):
    x,y,z=center; a,b,c=[v/2 for v in size]
    verts=[(x+sx*a,y+sy*b,z+sz*c) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    mesh(name,verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],color)

def slab_roof(w,d,eave,rise,color='667260'):
    mesh('Pitched roof',[(-w/2,eave,-d/2),(w/2,eave,-d/2),(w/2,eave,d/2),(-w/2,eave,d/2),(0,eave+rise,-d/2),(0,eave+rise,d/2)],[(0,1,4),(3,5,2),(0,4,5,3),(4,1,2,5),(0,3,2,1)],color)

def windows(w,d,count,y):
    for i in range(count):
        x=(i-(count-1)/2)*(w-3)/max(1,count-1)
        for side in [-1,1]:
            box('Window frame',(x,y,side*(d/2-.025)),(1.35,1.25,.05),'d8d6b8')
            box('Window glass',(x,y,side*(d/2+.008)),(1.13,1.03,.022),'4e6b70')

start('hangar',28,20,8,(-26,25,0))
box('Hangar walls',(0,2.5,0),(28,5,20),'8d957b')
for j in range(12):
    a=j*math.pi/12; b=(j+1)*math.pi/12
    # shallow segmented barrel roof, with ends kept inside the physical box.
    mesh('Hangar roof bay',[(-14*math.cos(a),5+3*math.sin(a),-10),(-14*math.cos(b),5+3*math.sin(b),-10),(-14*math.cos(b),5+3*math.sin(b),10),(-14*math.cos(a),5+3*math.sin(a),10)],[(0,1,2,3)],'687867' if j%2 else '72816d')
for side in [-1,1]:
    mesh('Hangar gable',[(-14,5,side*9.99)]+[(-14*math.cos(j*math.pi/12),5+3*math.sin(j*math.pi/12),side*9.99) for j in range(13)],[(0,j+1,j+2) for j in range(12)],'7f8c73')
box('Closed sliding door',(0,2.32,-10),(22,4.6,.045),'53695e')
for x in range(-10,11,2): box('Door corrugation',(x,2.32,-10.03),(.075,4.5,.045),'87977d')
box('Door header',(0,4.76,-10.04),(23,.2,.06),'e4ddb9')
box('Side access door',(12.3,1.15,-10.025),(1.2,2.3,.04),'40584f')
for side in [-1,1]:
    for z in [-7,-3,1,5]: box('Side clerestory',(side*14.01,4.1,z),(.035,.7,2.8),'4d6871')

start('tower',8,8,14,(4,23,0))
box('Tower foundation',(0,.35,0),(8,.7,8),'929a8b')
box('Tower shaft',(0,5.2,0),(4.2,10.3,4.2),'979d86')
box('Control cabin',(0,11.5,0),(7.6,3,7.6),'737f6b')
for side in [-1,1]:
    box('Control glass',(0,11.65,side*3.81),(7.1,1.7,.03),'466d7c')
    box('Control side glass',(side*3.81,11.65,0),(.03,1.7,7.1),'466d7c')
for x in [-3.7,0,3.7]:
    for z in [-3.7,3.7]: box('Cabin mullion',(x,11.65,z),(.14,2,.13),'c8c9ac')
box('Control roof',(0,13.25,0),(8,.35,8),'4f625a')
box('Aerial',(0,13.72,0),(.08,.56,.08),'d1cfae')
box('Access door',(0,1.1,-2.13),(1.15,2.2,.05),'53695e')
for y in [3,6,9]: box('Shaft window',(0,y,-2.13),(.75,.85,.035),'4e6b70')

for key,w,d,h,stage in [('barracks',26,10,4,(-24,0,0)),('hq',24,12,5,(5,0,0)),('workshop',18,8,5,(-25,-17,0)),('gatehouse',7,6,3.2,(0,-15,0))]:
    start(key,w,d,h,stage)
    box('Foundation',(0,.18,0),(w,.36,d),'b5b69c')
    eave=h-.9
    box('Wall module',(0,eave/2,0),(w,eave,d),'93997e')
    slab_roof(w,d,eave,.9)
    windows(w-1,d,6 if key=='barracks' else 4 if key=='hq' else 2,2.0 if key!='gatehouse' else 1.7)
    box('Entry door',(0,1.12,-d/2-.015),(1.1,2.24,.035),'536759')
    if key=='workshop':
        for x in [-5,3]:
            box('Service shutter',(x,1.85,-d/2-.02),(5.5,3.7,.045),'52695d')
            for y in [.5,1,1.5,2,2.5,3,3.5]: box('Shutter rib',(x,y,-d/2-.05),(5.4,.045,.035),'91a087')
    if key=='hq': box('Headquarters entry canopy',(0,3.25,-d/2+.2),(4,.18,1.5),'dad5b0')

start('utility-truck',2.75,1.6,1.7,(15,-15,0))
# Wheels remain the game's animated, steering wheel assemblies; body bounds
# match the van's existing collider and suspension exactly.
box('Truck frame',(0,.43,0),(2.65,.25,1.4),'3d4a40')
box('Truck cab',(.63,1.02,0),(1.17,1.11,1.56),'78866a')
box('Truck hood',(1.08,.8,0),(.5,.38,1.58),'849075')
box('Canvas rear bed',(-.67,1.08,0),(1.37,1.19,1.58),'66755b')
box('Canvas roof',(-.67,1.66,0),(1.37,.08,1.6),'6e7d62')
box('Windshield',(1.22,1.29,0),(.026,.45,1.27),'476a74')
for side in [-1,1]:
    box('Cab side window',(.7,1.29,side*.788),(.75,.43,.018),'476a74')
    for x in [-1.16,-.7,-.24]: box('Canvas tie',(x,.75,side*.79),(.055,.4,.015),'c3bf99')
    box('Headlamp',(1.36,.76,side*.56),(.025,.17,.22),'e7dfad')
    box('Tail lamp',(-1.36,.65,side*.56),(.025,.14,.15),'b65d4b')
box('Front bumper',(1.32,.46,0),(.11,.16,1.6),'475948')
box('Grille',(1.365,.8,0),(.018,.25,.58),'3b4e42')
box('Rear bumper',(-1.32,.45,0),(.11,.16,1.6),'475948')

export={}
for key,item in models.items():
    parts=[]
    for obj in item['parts']:
        data=obj.data; data.calc_loop_triangles()
        parts.append({'name':obj.name,'positions':[round(v,4) for p in data.vertices for v in (p.co.x,p.co.z,-p.co.y)],'indices':[v for t in data.loop_triangles for v in t.vertices],'color':obj['color']})
    export[key]={'bounds':item['bounds'],'parts':parts}
with open(os.path.join(ROOT,'military-models.js'),'w',encoding='utf-8',newline='\n') as file:
    file.write('/* Original Blender meshes: tools/export-military.py. Metres, X forward, Y up, Z right. */\n(function(root){\n\"use strict\";root.MayhemMilitaryModels=')
    file.write(json.dumps(export,separators=(',',':')))
    file.write(';\nif(typeof module!==\"undefined\"&&module.exports)module.exports=root.MayhemMilitaryModels;\n})(globalThis);\n')
with open(os.path.join(OUT,'manifest.json'),'w',encoding='utf-8',newline='\n') as file:
    json.dump({'author':'Mayhem Meadows','license':'MIT','source':'military-workshop.blend','generator':'../../tools/export-military.py','units':'metres','models':{k:{'bounds':v['bounds'],'triangles':sum(len(p['indices'])//3 for p in v['parts'])} for k,v in export.items()}},file,indent=2)
    file.write('\n')

lightdata=bpy.data.lights.new('Military softbox',type='AREA'); lightdata.energy=15000; lightdata.size=60
light=bpy.data.objects.new('Military softbox',lightdata); scene.collection.objects.link(light)
light.location=(20,-30,60); light.rotation_euler=(Vector((-5,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
camera=bpy.data.objects.new('Military fleet camera',bpy.data.cameras.new('Military fleet camera')); scene.collection.objects.link(camera)
camera.location=(65,-85,72); camera.rotation_euler=(Vector((-5,5,3))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type=next(i.identifier for i in camera.data.bl_rna.properties['type'].enum_items if i.identifier.startswith('ORTH'))
camera.data.ortho_scale=105; scene.camera=camera
scene.render.resolution_x=1100; scene.render.resolution_y=800; scene.render.resolution_percentage=100
scene.render.filepath=os.path.join(OUT,'models-preview.png')
scene.render.image_settings.file_format=next(i.identifier for i in scene.render.image_settings.bl_rna.properties['file_format'].enum_items if i.identifier=='PNG')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'military-workshop.blend'),copy=True,compress=True)
print(json.dumps({'models':list(export),'triangles':sum(len(p['indices'])//3 for v in export.values() for p in v['parts']),'output':OUT}),flush=True)
if os.environ.get('MAYHEM_SKIP_PREVIEW')!='1': bpy.ops.render.render(write_still=True)
