"""Author Northwatch toy soldiers and a troop carrier in real Blender.

Run: blender --background --python tools/export-troops.py
Both workshops are new scenes. An existing scene is never erased.
Meshes use metres, X forward, Y up, Z right, with origins at ground level.
The soldier's 1.462 metre helmet height includes the game's 0.86 scale.
"""
import bpy, bmesh, json, math, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'troops')
os.makedirs(OUT, exist_ok=True)
materials = {}
workshops = []


def coord(v):
    x, y, z = v
    return (x, -z, y)


def material(color):
    if color not in materials:
        rgb = [int(color[i:i+2], 16)/255 for i in (0, 2, 4)]
        mat = bpy.data.materials.new('Northwatch '+color)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*[v/12.92 if v < .04045 else ((v+.055)/1.055)**2.4 for v in rgb], 1)
        bsdf.inputs['Roughness'].default_value = .78
        mat.diffuse_color = (*rgb, 1)
        materials[color] = mat
    return materials[color]


def workshop(name, metadata):
    global scene, collection, parts, pivots
    scene = bpy.data.scenes.new(name+' Workshop')
    bpy.context.window.scene = scene
    scene.world = bpy.data.worlds.new(name+' Sky')
    scene.world.use_nodes = True
    sky = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    sky.inputs[0].default_value = (.29, .36, .37, 1)
    sky.inputs[1].default_value = .65
    collection = bpy.data.collections.new('Editable '+name)
    scene.collection.children.link(collection)
    parts, pivots = [], {}
    for group, position in metadata['groupPivots'].items():
        obj = bpy.data.objects.new(group+' Pivot', None)
        collection.objects.link(obj)
        obj.empty_display_type = 'ARROWS'
        obj.empty_display_size = .18
        obj.location = coord(position)
        parent = metadata['groupParents'].get(group)
        if parent:
            obj.parent = pivots[parent]
        pivots[group] = obj
    workshops.append({'scene': scene, 'collection': collection, 'parts': parts, 'pivots': pivots, 'metadata': metadata})


def mesh(name, vertices, faces, color, group='hull', paint=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([coord(v) for v in vertices], [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    data.materials.append(material(color))
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.parent = pivots[group]
    obj['color'] = '#'+color
    obj['group'] = group
    obj['paint'] = paint
    parts.append(obj)
    return obj


def box(name, center, size, color, group='hull', paint=False):
    x, y, z = center
    a, b, c = [v/2 for v in size]
    vertices = [(x+sx*a, y+sy*b, z+sz*c) for sx, sy, sz in
                [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    return mesh(name, vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)], color, group, paint)


def cylinder(name, center, radius, length, color, group='hull', axis='x', sides=12, paint=False):
    vertices = []
    for end in [-length/2, length/2]:
        for i in range(sides):
            a = i*math.tau/sides
            p = (end, radius*math.sin(a), radius*math.cos(a)) if axis == 'x' else (radius*math.cos(a), radius*math.sin(a), end)
            vertices.append(tuple(center[k]+p[k] for k in range(3)))
    return mesh(name, vertices, [tuple(range(sides-1,-1,-1)),tuple(range(sides,sides*2))]+
                [(j,(j+1)%sides,(j+1)%sides+sides,j+sides) for j in range(sides)], color, group, paint)


def beam(name, start, end, width, depth, color, group):
    a, b = Vector(start), Vector(end)
    along = (b-a).normalized()
    reference = Vector((0,1,0)) if abs(along.z) > .9 else Vector((0,0,1))
    across = along.cross(reference).normalized()
    normal = along.cross(across).normalized()
    verts = [tuple(p+across*s*width/2+normal*t*depth/2) for p in [a,b] for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    return mesh(name, verts, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)], color, group)


soldier_meta = {
    'name': 'Northwatch Guard', 'height': 1.462, 'characterScaleBaked': .86,
    'bounds': {'length': 1.077, 'width': .62, 'height': 1.462},
    'groupPivots': {'hips':[0,.68,0], 'torso':[0,.08,0], 'head':[0,.44,0],
                    'leftArm':[0,.36,-.22], 'rightArm':[0,.36,.22],
                    'leftLeg':[0,-.04,-.105], 'rightLeg':[0,-.04,.105],
                    'leftShin':[0,-.28,0], 'rightShin':[0,-.28,0], 'weapon':[0,.24,0]},
    'groupParents': {'hips':None, 'torso':'hips', 'head':'torso', 'leftArm':'torso',
                     'rightArm':'torso', 'leftLeg':'hips', 'rightLeg':'hips',
                     'leftShin':'leftLeg', 'rightShin':'rightLeg', 'weapon':'torso'},
    'muzzle':[.78,0,0], 'muzzleHeight':1, 'seatedHipHeight':.68,
}
workshop('Northwatch Guard', soldier_meta)

# A compact, readable toy soldier with a fitted vest, helmet and ready rifle.
box('Uniform pelvis', (0,-.012,0), (.27,.17,.35), '718564', 'hips')
box('Utility belt', (.015,.068,0), (.31,.045,.37), '435849', 'hips')
box('Belt buckle', (.179,.068,0), (.025,.037,.065), 'c3bd94', 'hips')
for side in [-1,1]:
    box('Belt utility pouch', (.10,.015,side*.188), (.14,.12,.055), 'a0a078', 'hips')
box('Olive uniform torso', (0,.19,0), (.28,.39,.39), '82936c', 'torso')
box('Front protective vest', (.155,.185,0), (.075,.335,.37), '526b53', 'torso')
box('Vest collar', (.08,.37,0), (.2,.045,.285), '435b4b', 'torso')
for side in [-1,0,1]:
    box('Vest equipment pocket', (.202,.13,side*.115), (.045,.15,.09), 'a3a077', 'torso')
box('Northwatch vest patch', (.203,.285,0), (.016,.075,.12), 'dfdab0', 'torso')
box('Vest patch green bar', (.214,.285,0), (.01,.025,.12), '647c5a', 'torso')
box('Compact backpack', (-.205,.19,0), (.14,.31,.31), '687d59', 'torso')
box('Backpack flap', (-.285,.28,0), (.024,.085,.3), 'a0a57a', 'torso')
box('Backpack roll', (-.20,.375,0), (.17,.075,.33), 'b3ad83', 'torso')
for side in [-1,1]:
    box('Backpack shoulder strap', (.044,.31,side*.17), (.255,.045,.035), 'b6af87', 'torso')

box('Face and head', (0,.065,0), (.235,.23,.245), 'd7b992', 'head')
box('Nose', (.13,.067,0), (.035,.055,.052), 'bd9973', 'head')
for side in [-1,1]:
    box('Toy eye', (.12,.11,side*.067), (.012,.026,.026), '293d39', 'head')
    box('Helmet chin strap', (.015,-.012,side*.128), (.17,.023,.012), '596951', 'head')
box('Smile', (.122,.017,0), (.013,.016,.069), '7f644f', 'head')
helmet_vertices = []
for height, radius in [(.13,.18),(.205,.16),(.262,.052)]:
    helmet_vertices.extend((radius*math.cos(i*math.tau/12), height, radius*math.sin(i*math.tau/12)) for i in range(12))
helmet_faces = [tuple(range(11,-1,-1)), tuple(range(24,36))]
helmet_faces += [(layer*12+j,layer*12+(j+1)%12,(layer+1)*12+(j+1)%12,(layer+1)*12+j) for layer in range(2) for j in range(12)]
mesh('Faceted protective helmet', helmet_vertices, helmet_faces, '687e59', 'head')
box('Helmet front brim', (.164,.132,0), (.1,.028,.30), '82946a', 'head')
box('Helmet identification patch', (.172,.194,0), (.012,.037,.084), 'e0dcb7', 'head')

for group in ['leftLeg','rightLeg']:
    shin_group = group.replace('Leg','Shin')
    box('Uniform thigh '+group, (0,-.14,0), (.215,.28,.16), '778a64', group)
    box('Uniform shin '+group, (.012,-.128,0), (.175,.265,.145), '6d805e', shin_group)
    box('Knee pad '+group, (.115,-.008,0), (.065,.125,.16), '4c6550', shin_group)
    box('Boot '+group, (.067,-.29,0), (.33,.14,.17), '344c42', shin_group)
    box('Boot sole '+group, (.067,-.352,0), (.34,.016,.18), '243b34', shin_group)
    box('Boot toe '+group, (.22,-.287,0), (.03,.06,.15), '50604c', shin_group)

for group, elbow, hand in [('leftArm',(.14,-.16,.015),(.44,-.12,.16)),
                            ('rightArm',(.025,-.20,-.01),(.21,-.135,-.17))]:
    beam('Upper sleeve '+group, (0,0,0), elbow, .155,.16,'7f916b',group)
    beam('Bent forearm '+group, elbow,hand,.12,.13,'8b9a71',group)
    box('Shoulder guard '+group, (.01,-.025,0), (.17,.10,.18), '5b7353',group)
    box('Gloved hand '+group, hand, (.13,.095,.10), '4c6350',group)

# This deliberately stylised carbine has an ochre toy muzzle and no real insignia.
box('Rifle stock', (.045,0,0), (.21,.12,.09), '9d9b74', 'weapon')
box('Rifle receiver', (.265,.01,0), (.26,.095,.09), '344d43', 'weapon')
box('Rifle grip', (.23,-.075,0), (.065,.125,.075), '52674f', 'weapon')
box('Rifle magazine', (.345,-.075,0), (.055,.12,.075), '5d7054', 'weapon')
box('Rifle handguard', (.46,.004,0), (.16,.083,.085), '81916a', 'weapon')
cylinder('Rifle barrel', (.64,0,0), .026,.28,'344d43','weapon',sides=8)
cylinder('Ochre toy muzzle', (.765,0,0), .036,.03,'d9b16c','weapon',sides=8)
box('Rifle sight rail', (.31,.074,0), (.21,.027,.04), '293f37','weapon')
box('Rifle front sight', (.69,.04,0), (.022,.07,.025), '293f37','weapon')

truck_meta = {
    'name':'Northwatch Carrier', 'modelId':'northwatch-carrier',
    'bounds': {'length':5.8,'width':2.4,'height':2.8}, 'centerHeight':1.4,
    'groupPivots': {'hull':[0,0,0], 'wheel':[0,0,0]},
    'groupParents': {'hull':None,'wheel':None},
    'wheelRadius':.46, 'wheelPositions':[[x,.46,z] for x in [-1.95,-.75,1.85] for z in [-1,1]],
    'seats':[{'x':x,'y':1.2,'z':z} for z in [-.65,.65] for x in [-1.15,-.35]],
    'seatRootHeight':.52, 'bedFloorHeight':1.03,
}
workshop('Northwatch Carrier', truck_meta)

# Six wheels and a short overhang make the carrier visibly distinct from civilian vans.
box('Ladder chassis', (0,.70,0), (5.55,.25,1.50), '344c40')
for z in [-.62,.62]:
    box('Chassis rail', (-.1,.60,z), (5.4,.22,.14),'293e37')
for x in [-1.95,-.75,1.85]:
    cylinder('Driven axle', (x,.46,0), .10,2.05,'455d49',axis='z',sides=8)
box('Bed load floor', (-1.05,1.03,0), (3.22,.18,2.25),'8b9870',paint=True)
box('Rear tailgate', (-2.64,1.28,0), (.10,.45,2.27),'718663',paint=True)
box('Rear bumper', (-2.83,.71,0), (.14,.20,2.32),'3f5747')
for z in [-1.095,1.095]:
    box('Cargo bed side', (-1.05,1.32,z), (3.22,.45,.10),'7c8e68',paint=True)
    box('Cargo top rail', (-1.05,1.57,z), (3.23,.09,.12),'b6b28b')
    for x in [-2.34,-1.45,-.55,.35]:
        box('Bed side reinforcement', (x,1.32,z*1.05), (.085,.44,.04),'566f51')
for z in [-.75,.75]:
    box('Troop bench', (-.77,1.18,z), (2.52,.10,.40),'b8ae7c')
    box('Troop bench back', (-.77,1.48,z*1.26), (2.5,.42,.08),'8f9468')
    for x in [-1.8,.2]:
        box('Bench leg', (x,1.10,z), (.08,.15,.28),'53694e')

# Raised canvas edges leave the four bench seats and transported soldiers visible.
roof_profile = [(-1.10,2.40),(-.86,2.66),(-.47,2.80),(.47,2.80),(.86,2.66),(1.10,2.40)]
vertices = [(x,y,z) for x in [-2.65,.55] for z,y in roof_profile]
mesh('Canvas canopy roof', vertices, [(j,j+1,j+7,j+6) for j in range(5)], 'a4a67c')
for z in [-1.10,1.10]:
    box('Canvas rolled side', (-1.05,2.37,z), (3.2,.16,.14),'a4a67c')
    for x in [-2.52,-1.0,.42]:
        box('Canopy post', (x,1.99,z), (.055,.82,.055),'526b50')
        box('Canvas fastening strap', (x,2.37,z*1.07), (.045,.2,.025),'586c50')
for x in [-2.52,-1.0,.42]:
    for i in range(len(roof_profile)-1):
        a,b=roof_profile[i],roof_profile[i+1]
        beam('Canopy bowed frame', (x,a[1]-.045,a[0]), (x,b[1]-.045,b[0]),.04,.04,'667b56','hull')

box('Cab lower body', (1.55,1.16,0), (2.2,.55,2.13),'7c9067',paint=True)
box('Cab back', (.62,1.80,0), (.16,1.23,2.12),'6c835e',paint=True)
box('Cab windshield surround', (2.08,2.0,0), (.10,.94,2.11),'8b9b70',paint=True)
box('Front windshield', (2.139,2.10,0), (.022,.53,1.83),'86a4a0')
box('Windshield center bar', (2.157,2.10,0), (.026,.56,.06),'4c6650')
for side in [-1,1]:
    z=side*1.078
    box('Cab door', (1.31,1.62,z), (1.44,.77,.055),'7c9067',paint=True)
    box('Door window', (1.38,2.15,z*1.018), (1.19,.51,.022),'8caaa3')
    box('Door window rear trim', (.775,2.13,z*1.04), (.055,.61,.035),'4e684f')
    box('Door handle', (.83,1.84,z*1.048), (.18,.04,.035),'c0bd95')
    box('Boarding step', (1.15,.88,z), (1.42,.10,.21),'435c48')
    box('Mirror stalk', (2.04,2.22,side*1.14), (.08,.08,.12),'435c48')
    box('Mirror', (2.05,2.24,side*1.17), (.18,.18,.06),'bdd0c3')
    box('Northwatch door patch', (1.20,1.65,z*1.048), (.32,.23,.014),'e0dcb5')
    box('Door patch olive bar', (1.20,1.65,z*1.06), (.32,.065,.014),'70865d')
box('Cab roof', (1.36,2.51,0), (1.65,.14,2.22),'8e9d73',paint=True)
box('Short bonnet', (2.48,1.55,0), (.70,.52,2.06),'7c9067',paint=True)
box('Bonnet top', (2.47,1.83,0), (.73,.055,2.08),'9ba87d',paint=True)
box('Front radiator', (2.846,1.48,0), (.025,.50,1.22),'344c42')
for z in [-.48,-.32,-.16,0,.16,.32,.48]:
    box('Radiator slat', (2.864,1.48,z), (.016,.43,.04),'8e9d78')
box('Front bumper', (2.83,.91,0), (.14,.19,2.32),'3f5747')
for z in [-.86,.86]:
    cylinder('Headlamp', (2.864,1.48,z),.13,.03,'e8dca8',sides=12)
    box('Rear lamp', (-2.703,1.10,z),(.025,.12,.16),'bd6c4f')
for x in [-1.95,-.75,1.85]:
    for side in [-1,1]:
        box('Wheel mudguard', (x,1.0,side*1.025), (1.04,.10,.29),'596f53',paint=True)
box('Rear registration plate', (-2.705,.98,0),(.02,.14,.47),'dedbb5')
for z in [-.15,0,.15]:
    box('Rear plate stencil', (-2.719,.98,z),(.01,.06,.035),'526a4e')

# One authored wheel is instanced six times by the runtime and preview.
cylinder('All terrain tire', (0,0,0),.46,.38,'2d453b','wheel',axis='z',sides=16)
cylinder('Wheel rim', (0,0,.194),.285,.025,'708462','wheel',axis='z',sides=12,paint=True)
cylinder('Wheel hub', (0,0,.214),.125,.04,'a9ad86','wheel',axis='z',sides=12)
for i in range(8):
    angle=i*math.tau/8
    cylinder('Rim bolt', (.205*math.cos(angle),.205*math.sin(angle),.212),.022,.015,'ccd0a7','wheel',axis='z',sides=6)
for i in range(16):
    angle=i*math.tau/16
    obj=box('Raised tire tread', (.425*math.cos(angle),.425*math.sin(angle),0),(.06,.075,.40),'3e5545','wheel')
    center=Vector(coord((.425*math.cos(angle),.425*math.sin(angle),0)))
    for vertex in obj.data.vertices:
        offset=vertex.co-center
        # Rotate each small tread around its own center, not the wheel center.
        ca,sa=math.cos(angle),math.sin(angle)
        vertex.co=center+Vector((offset.x*ca-offset.z*sa,offset.y,offset.x*sa+offset.z*ca))


def export_workshop(work):
    result={'metadata':work['metadata'],'parts':[]}
    for obj in work['parts']:
        data=obj.data
        data.calc_loop_triangles()
        positions=[]
        for vertex in data.vertices:
            p=obj.matrix_local @ vertex.co
            positions.extend(round(value,5) for value in (p.x,p.z,-p.y))
        result['parts'].append({'name':obj.name,'group':obj['group'],'color':obj['color'],
                                'positions':positions,'indices':[i for t in data.loop_triangles for i in t.vertices],
                                'paint':bool(obj['paint'])})
    return result


bundle={'soldier':export_workshop(workshops[0]),'truck':export_workshop(workshops[1])}
with open(os.path.join(ROOT,'troop-models.js'),'w',encoding='utf-8',newline='\n') as file:
    file.write('/* Original fictional Blender toy soldiers and troop truck: tools/export-troops.py. Metres, X forward, Y up, Z right. */\n(function(root){\n"use strict";root.MayhemTroopModels=')
    file.write(json.dumps(bundle,separators=(',',':')))
    file.write(';\nif(typeof module!=="undefined"&&module.exports)module.exports=root.MayhemTroopModels;\n})(globalThis);\n')
manifest={'author':'Mayhem Meadows','license':'MIT','fictional':True,'source':'northwatch-troops.blend',
          'generator':'../../tools/export-troops.py','units':'metres','blenderVersion':bpy.app.version_string,
          'coordinates':'X forward, Y up, Z right; roots on ground; local articulation pivots',
          'models':{key:{'metadata':model['metadata'],'parts':len(model['parts']),
                        'triangles':sum(len(p['indices'])//3 for p in model['parts'])} for key,model in bundle.items()}}
with open(os.path.join(OUT,'manifest.json'),'w',encoding='utf-8',newline='\n') as file:
    json.dump(manifest,file,indent=2)
    file.write('\n')

# Runtime wheel sources are hidden; the editable truck has six linked instances.
truck_work=workshops[1]
for x,y,z in truck_meta['wheelPositions']:
    for source in [p for p in truck_work['parts'] if p['group']=='wheel']:
        obj=source.copy()
        obj.data=source.data
        truck_work['collection'].objects.link(obj)
        obj.parent=truck_work['pivots']['hull']
        obj.location=coord((x,y,z))
        if z<0:
            obj.rotation_euler.z=math.pi
for source in [p for p in truck_work['parts'] if p['group']=='wheel']:
    source.hide_render=True
    source.hide_set(True)


def preview(work, filename, target, camera, ortho):
    preview_scene=work['scene']
    bpy.context.window.scene=preview_scene
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.012))
    plane=bpy.context.object
    plane.name='Workshop display floor'
    plane.data.materials.append(material('d8d6bc'))
    camera_data=bpy.data.cameras.new(filename+' Camera')
    camera_obj=bpy.data.objects.new(filename+' Camera',camera_data)
    preview_scene.collection.objects.link(camera_obj)
    camera_obj.location=coord(camera)
    camera_obj.rotation_euler=(Vector(coord(target))-camera_obj.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type='ORTHO'
    camera_data.ortho_scale=ortho
    preview_scene.camera=camera_obj
    for name,location,power,size in [('Key',(5,8,4),1300,7),('Fill',(-4,5,-4),950,5)]:
        light_data=bpy.data.lights.new(filename+name,'AREA')
        light_data.energy=power
        light_data.shape='DISK'
        light_data.size=size
        light_obj=bpy.data.objects.new(filename+name,light_data)
        preview_scene.collection.objects.link(light_obj)
        light_obj.location=coord(location)
        light_obj.rotation_euler=(Vector(coord(target))-light_obj.location).to_track_quat('-Z','Y').to_euler()
    preview_scene.render.engine='BLENDER_EEVEE'
    preview_scene.render.resolution_x=1200
    preview_scene.render.resolution_y=1000
    preview_scene.render.resolution_percentage=100
    preview_scene.render.image_settings.file_format='PNG'
    preview_scene.render.filepath=os.path.join(OUT,filename+'.png')
    preview_scene.view_settings.view_transform='Standard'
    preview_scene.view_settings.look='Medium High Contrast'
    preview_scene.render.film_transparent=False
    bpy.ops.render.render(write_still=True)


preview(workshops[0],'soldier-preview',(.1,.76,0),(3.3,2.3,3.3),2.12)
preview(workshops[1],'truck-preview',(0,1.3,0),(8,6.5,8),8.1)
bpy.context.window.scene=workshops[0]['scene']
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'northwatch-troops.blend'))
print('Northwatch troops exported:',{key:{'parts':len(model['parts']),'triangles':sum(len(p['indices'])//3 for p in model['parts'])} for key,model in bundle.items()})
