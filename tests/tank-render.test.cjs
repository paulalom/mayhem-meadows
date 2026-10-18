'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Stats=require('../vehicle-stats.js');
const context=vm.createContext({console,AbortController,MayhemCore:{CAR_TYPES:Stats.CAR_TYPES}});
for(const name of ['vendor/three.min.js','tank-models.js','scene3d.js','tanks-render.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);
const T=context.THREE,Scene=context.MayhemScene,Render=context.MayhemTankRender,asset=context.MayhemTankModels;
function fixture(){
  const scene=Object.create(Scene.prototype);
  Object.assign(scene,{T,scene:new T.Scene(),game:{cars:[],police:[],time:0,tankShells:[]},_geometries:[],_materials:new Map(),_vehicles:new Map(),_color:new T.Color()});
  scene._cube=scene._geometry(new T.BoxGeometry(1,1,1));scene._sphere=scene._geometry(new T.IcosahedronGeometry(1,1));
  scene._cone=scene._geometry(new T.ConeGeometry(1,1,7));scene._cylinder=scene._geometry(new T.CylinderGeometry(1,1,1,12));
  return scene;
}
function tank(scene,id='tank-render-1'){
  const entity={id,kind:'tank',color:'#7e9270',health:450,maxHealth:450,colliderHeight:2.6,x:2200,y:-1000,elevation:14,angle:.4,speed:0,turretAngle:.4,gunPitch:0};
  const model=Render.createVehicle(scene,entity);scene._vehicles.set(id,model);scene.game.cars.push(entity);
  model.group.position.set(entity.x/20,entity.elevation+model.centerHeight,entity.y/20);model.group.rotation.y=-entity.angle;Render.step(scene);
  return {entity,model};
}
function near(a,b,tolerance=1e-6){assert.ok(Math.abs(a-b)<tolerance,a+' differs from '+b);}

test('the original editable Blender export has indexed meshes, independent pivots and matching muzzle metadata',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/tanks/manifest.json'),'utf8'));
  assert.match(manifest.blenderVersion,/^\d+\.\d+/);assert.equal(manifest.license,'MIT');assert.equal(manifest.fictional,true);
  assert.ok(fs.statSync(path.join(__dirname,'../assets/tanks/northwatch-tank.blend')).size>30000);
  assert.deepEqual(Array.from(new Set(asset.parts.map(p=>p.group))).sort(),['cannon','hull','tread','turret','wheel']);
  assert.equal(manifest.parts,asset.parts.length);assert.equal(manifest.triangles,asset.parts.reduce((n,p)=>n+p.indices.length/3,0));
  for(const part of asset.parts){assert.ok(part.positions.every(Number.isFinite));assert.equal(part.positions.length%3,0);assert.equal(part.indices.length%3,0);for(const i of part.indices)assert.ok(Number.isInteger(i)&&i>=0&&i<part.positions.length/3);}
  for(const part of asset.parts.filter(p=>p.group==='hull'))for(let i=0;i<part.positions.length;i+=3){assert.ok(Math.abs(part.positions[i])<=2.6);assert.ok(Math.abs(part.positions[i+2])<=1.2);assert.ok(part.positions[i+1]>=0&&part.positions[i+1]<=1.4);}
  const m=asset.metadata;near(m.turretPivot[1]+m.gunPivot[1],2.05);near(m.gunPivot[0]+m.muzzle[0],4);
  if(Stats.CAR_TYPES.tank){near(m.bounds.length*20,Stats.CAR_TYPES.tank.length);near(m.bounds.width*20,Stats.CAR_TYPES.tank.width);}
  const physics=Stats.TANK_GEOMETRY;
  if(physics){
    for(let i=0;i<3;i++){near(m.turretPivot[i],physics.turretPivot[i]);near(m.turretBounds[i]/2,physics.turretHalf[i]);}
    near(m.hull.height/2,physics.centerHeight);near(m.gunPivot[0],physics.gunPivot[0]);near(m.turretPivot[1]+m.gunPivot[1],physics.gunPivot[1]);near(m.barrelLength,physics.barrelLength);
  }
});

test('the rotating and elevating visible cannon lands on the simulated muzzle at every heading',()=>{
  const scene=fixture(),{entity,model}=tank(scene),metadata=asset.metadata;
  for(const hull of [-2,.4,2.2])for(const yaw of [-2.8,0,1.8])for(const pitch of [-.1,.2,.5]){
    entity.angle=hull;entity.turretAngle=yaw;entity.gunPitch=pitch;model.group.rotation.y=-hull;Render.step(scene);model.group.updateMatrixWorld(true);
    const muzzle=model.tank.cannon.localToWorld(new T.Vector3(...metadata.muzzle));
    const distance=metadata.gunPivot[0]+metadata.muzzle[0]*Math.cos(pitch);
    near(muzzle.x,entity.x/20+Math.cos(yaw)*distance);near(muzzle.z,entity.y/20+Math.sin(yaw)*distance);
    near(muzzle.y,entity.elevation+2.05+metadata.muzzle[0]*Math.sin(pitch));
  }
});

test('tracks and road wheels turn independently, guns recoil and flash, shells render and resources remain stable',()=>{
  const scene=fixture(),{entity,model}=tank(scene),tankVisual=model.tank;
  const trackBefore=Float32Array.from(tankVisual.treadMesh.instanceMatrix.array),wheelBefore=Float32Array.from(tankVisual.wheelMesh.instanceMatrix.array);
  entity.speed=130;entity.angle+=.2;entity.lastShotTime=.1;scene.game.time=.16;scene.game.tankShells.push({x:2300,y:-1000,elevation:16.1,vx:100,vy:0});Render.step(scene);
  assert.notDeepEqual(tankVisual.treadMesh.instanceMatrix.array,trackBefore);assert.notDeepEqual(tankVisual.wheelMesh.instanceMatrix.array,wheelBefore);
  assert.notEqual(tankVisual.travel[0],tankVisual.travel[1]);assert.equal(tankVisual.flash.visible,true);assert.ok(tankVisual.cannon.position.x<asset.metadata.gunPivot[0]);
  assert.equal(scene._tankRender.shells.count,1);assert.equal(scene._tankRender.shells.visible,true);
  const count=scene._geometries.length,materials=scene._materials.size;
  for(let i=0;i<120;i++){scene.game.time+=1/60;Render.step(scene);}
  assert.equal(scene._geometries.length,count);assert.equal(scene._materials.size,materials);assert.equal(tankVisual.flash.visible,false);near(tankVisual.cannon.position.x,asset.metadata.gunPivot[0]);
  for(let i=0;i<500;i++){
    const p=Render.treadPosition(asset.metadata,i*.11);assert.ok(Number.isFinite(p.rotation));assert.ok(p.y>=asset.metadata.trackCenterHeight-asset.metadata.trackRadius-1e-9);assert.ok(p.y<=asset.metadata.trackCenterHeight+asset.metadata.trackRadius+1e-9);
  }
});

test('tank armour keeps existing damage, fire, repaint and retirement without disposing another tank',()=>{
  const scene=fixture(),a=tank(scene),b=tank(scene,'tank-render-2'),hull=a.model.tank.animated.get('hull');
  const original=Float32Array.from(hull.geometry.attributes.color.array);
  a.entity.health=100;a.entity.burning=true;a.entity.fireTime=3;scene._damageVehicle(a.model,a.entity);scene._vehicleEffects(a.model,a.entity);Render.step(scene);
  assert.notDeepEqual(hull.geometry.attributes.color.array,original);assert.equal(a.model.effects.group.visible,true);
  a.entity.health=450;a.entity.burning=false;a.entity.color='#e4b348';scene._paintVehicle(a.model,a.entity.color);scene._damageVehicle(a.model,a.entity);Render.step(scene);
  assert.notDeepEqual(hull.geometry.attributes.color.array,original);assert.equal(a.model.group.visible,true);
  let sharedDisposed=false;for(const source of scene._tankRender.groups.values())source.geometry.addEventListener('dispose',()=>{sharedDisposed=true;});
  const bGeometry=b.model.tank.animated.get('hull').geometry;let bDisposed=false;bGeometry.addEventListener('dispose',()=>{bDisposed=true;});
  scene._retireVehicle(a.entity.id,a.model);Render.step(scene);
  assert.equal(scene._tankRender.models.has(a.entity.id),false);assert.equal(scene._tankRender.models.has(b.entity.id),true);assert.equal(sharedDisposed,false);assert.equal(bDisposed,false);
});
