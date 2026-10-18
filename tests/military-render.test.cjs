'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const World=require('../world.js'),Stats=require('../vehicle-stats.js');
const context=vm.createContext({console,AbortController,MayhemCore:{CAR_TYPES:Stats.CAR_TYPES}});
for(const name of ['vendor/three.min.js','military-models.js','scene3d.js','military-render.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);
const T=context.THREE,Scene=context.MayhemScene,Render=context.MayhemMilitaryRender,assets=context.MayhemMilitaryModels;
const world=World.createWorld();
function fixture(){
  const scene=Object.create(Scene.prototype);
  Object.assign(scene,{T,scene:new T.Scene(),game:{world,cars:[],police:[],time:0},_geometries:[],_materials:new Map(),_staticParts:new Map(),_worldInfo:{},_vehicles:new Map(),_color:new T.Color()});
  scene._cube=scene._geometry(new T.BoxGeometry(1,1,1));scene._sphere=scene._geometry(new T.IcosahedronGeometry(1,1));
  scene._cone=scene._geometry(new T.ConeGeometry(1,1,7));scene._cylinder=scene._geometry(new T.CylinderGeometry(1,1,1,12));
  scene.signs=[];scene._sign=(text,x,y,z)=>{const mesh=new T.Mesh(new T.PlaneGeometry(3,2));mesh.position.set(x,y,z);scene.signs.push({text,mesh});return mesh;};
  scene.pads=[];scene._aviationPad=pad=>scene.pads.push(pad);
  return scene;
}
function truck(scene,id='base-utility-1'){
  const entity={id,kind:'van',militaryModel:'utility-truck',color:'#73806a',health:100,maxHealth:100};
  scene.game.cars.push(entity);const model=scene._vehicle(entity,false);scene._vehicles.set(entity.id,model);Render.step(scene);return {entity,model};
}

test('the seven actual Blender exports have finite indexed geometry, authored north doors and correct van bounds',()=>{
  assert.deepEqual(Object.keys(assets).sort(),['barracks','gatehouse','hangar','hq','tower','utility-truck','workshop']);
  for(const [key,asset]of Object.entries(assets)){
    const points=asset.parts.flatMap(p=>p.positions),indices=asset.parts.flatMap(p=>p.indices);
    assert.ok(points.every(Number.isFinite));assert.ok(indices.length>60);
    for(const part of asset.parts)for(const i of part.indices)assert.ok(Number.isInteger(i)&&i>=0&&i<part.positions.length/3);
    if(key!=='utility-truck'){
      const doors=asset.parts.filter(p=>/door|shutter/i.test(p.name));assert.ok(doors.length>0,key+' has a north facing entrance');
      for(const door of doors)assert.ok(door.positions.filter((_,i)=>i%3===2).reduce((a,b)=>a+b,0)<0);
    }
  }
  const source=assets['utility-truck'];assert.equal(source.bounds.length*20,Stats.CAR_TYPES.van.length);assert.equal(source.bounds.width*20,Stats.CAR_TYPES.van.width);
  for(const part of source.parts)for(let i=0;i<part.positions.length;i+=3){assert.ok(Math.abs(part.positions[i])<=1.3751);assert.ok(part.positions[i+1]>=0&&part.positions[i+1]<=1.7001);assert.ok(Math.abs(part.positions[i+2])<=.8001);}
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/military/manifest.json'),'utf8'));
  for(const [key,value]of Object.entries(assets))assert.equal(manifest.models[key].triangles,value.parts.reduce((n,p)=>n+p.indices.length/3,0));
});

test('base rendering matches all building volumes, keeps the entry open, flattens headings and reuses cached resources',()=>{
  const scene=fixture();Render.render(scene);const base=world.militaryBase;
  assert.equal(scene._military.buildings.length,base.buildings.length);assert.equal(scene.pads.length,2);assert.equal(scene._worldInfo.military.fenceGap,7.5);
  for(const b of base.buildings){const rendered=scene._military.buildings.find(x=>x.id===b.id),source=assets[b.militaryModel];
    assert.equal(rendered.scale[0]*source.bounds.length,b.w/20);assert.equal(rendered.scale[1]*source.bounds.height,b.height);assert.equal(rendered.scale[2]*source.bounds.width,b.h/20);
  }
  for(const label of ['09','27']){const sign=scene.signs.find(x=>x.text===label).mesh;sign.updateMatrixWorld(true);const normal=new T.Vector3(0,0,1).applyQuaternion(sign.quaternion);assert.ok(normal.y>.9999,'runway label lies on ground');}
  scene._bakeStatics();scene.scene.updateMatrixWorld(true);
  const ray=new T.Raycaster(new T.Vector3(base.gate.x/20,base.gate.elevation+1,base.gate.y/20+4),new T.Vector3(0,0,-1),0,8);
  assert.equal(ray.intersectObjects(scene.scene.children,true).length,0,'rendered fence and raised arms leave the physical access gap clear');
  const counts=[scene._geometries.length,scene._materials.size,scene.signs.length];Render.render(scene);Render.step(scene);assert.deepEqual([scene._geometries.length,scene._materials.size,scene.signs.length],counts);
});

test('utility trucks preserve rolling wheels and damage/effects, repaint in place, and retire without disposing shared source buffers',()=>{
  const scene=fixture(),a=truck(scene),b=truck(scene,'base-utility-2');
  assert.equal(a.model.wheels.length,4);for(const wheel of a.model.wheels)assert.equal(wheel.visible,true);
  assert.equal(a.model.shell.visible,false);assert.equal(a.model.military.visual.visible,true);assert.ok(a.model.effects.group);
  const geometry=a.model.military.mesh.geometry,buffer=geometry.attributes.color.array,initial=Array.from(buffer),count=scene._geometries.length;
  a.entity.color='#e7b546';Render.step(scene);assert.equal(a.model.military.mesh.geometry,geometry);assert.equal(geometry.attributes.color.array,buffer);assert.notDeepEqual(Array.from(buffer),initial);
  const repainted=Array.from(buffer);a.entity.health=25;a.entity.burning=true;a.entity.fireTime=3;Render.step(scene);assert.notDeepEqual(Array.from(buffer),repainted);assert.ok(a.model.military.visual.scale.y<1);
  for(let i=0;i<120;i++)Render.step(scene);assert.equal(scene._geometries.length,count,'frames never recreate meshes or buffers');
  const shared=scene._military.models.get('utility-truck').parts.map(p=>p.geometry);let sourceDisposed=false;for(const geo of shared)geo.addEventListener('dispose',()=>{sourceDisposed=true;});
  scene._retireVehicle(a.entity.id,a.model);Render.step(scene);assert.equal(sourceDisposed,false);assert.equal(scene._military.trucks.has(a.entity.id),false);assert.equal(scene._military.trucks.has(b.entity.id),true);
});
