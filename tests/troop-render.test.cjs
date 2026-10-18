'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Stats=require('../vehicle-stats.js');
const context=vm.createContext({console,AbortController,MayhemCore:{CAR_TYPES:Stats.CAR_TYPES}});
for(const name of ['vendor/three.min.js','troop-models.js','scene3d.js','troops-render.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);
const T=context.THREE,Scene=context.MayhemScene,Render=context.MayhemTroopRender,assets=context.MayhemTroopModels;
function fixture(){
  const scene=Object.create(Scene.prototype);
  Object.assign(scene,{T,scene:new T.Scene(),game:{peds:[],cars:[],police:[],time:0,soldierRounds:[]},_geometries:[],_materials:new Map(),_vehicles:new Map(),_residents:new Map(),_color:new T.Color(),_bodyFor:()=>null});
  scene._cube=scene._geometry(new T.BoxGeometry(1,1,1));scene._sphere=scene._geometry(new T.IcosahedronGeometry(1,1));
  scene._cone=scene._geometry(new T.ConeGeometry(1,1,7));scene._cylinder=scene._geometry(new T.CylinderGeometry(1,1,1,12));return scene;
}
function soldier(scene,id='soldier-render-1'){
  const entity={id,soldier:true,color:'#78866a',x:2500,y:-1200,elevation:14,angle:.4,aimAngle:.4,aimPitch:0,stunned:0};
  const model=Render.createSoldier(scene,entity);scene.game.peds.push(entity);scene._residents.set(id,model);
  model.group.position.set(entity.x/20,entity.elevation,entity.y/20);model.group.rotation.y=-entity.angle;Render.step(scene);return {entity,model};
}
function truck(scene,id='troop-truck-render-1'){
  const entity={id,kind:'truck',militaryModel:'troop-truck',modelId:'northwatch-carrier',color:'#78866a',health:300,maxHealth:300,x:2700,y:-1000,elevation:14,angle:0,speed:0};
  const model=Render.createVehicle(scene,entity);scene.game.cars.push(entity);scene._vehicles.set(id,model);Render.step(scene);return {entity,model};
}
function near(a,b,tolerance=1e-6){assert.ok(Math.abs(a-b)<tolerance,a+' differs from '+b);}

test('Blender troop geometry has finite indexed meshes, an articulated soldier and a physically sized six-wheel truck',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/troops/manifest.json'),'utf8'));
  assert.match(manifest.blenderVersion,/^\d+\.\d+/);assert.equal(manifest.license,'MIT');assert.equal(manifest.fictional,true);
  assert.ok(fs.statSync(path.join(__dirname,'../assets/troops/northwatch-troops.blend')).size>30000);
  for(const [name,asset]of Object.entries(assets)){assert.equal(manifest.models[name].parts,asset.parts.length);assert.equal(manifest.models[name].triangles,asset.parts.reduce((n,p)=>n+p.indices.length/3,0));}
  for(const asset of Object.values(assets))for(const part of asset.parts){
    assert.equal(part.positions.length%3,0);assert.equal(part.indices.length%3,0);assert.ok(part.positions.every(Number.isFinite));
    for(const i of part.indices)assert.ok(Number.isInteger(i)&&i>=0&&i<part.positions.length/3);
  }
  const s=assets.soldier.metadata,t=assets.truck.metadata;
  for(const group of ['hips','torso','head','leftArm','rightArm','leftLeg','rightLeg','weapon']){assert.ok(s.groupPivots[group]);assert.ok(assets.soldier.parts.some(p=>p.group===group));}
  near(s.groupPivots.hips[1]+s.groupPivots.torso[1]+s.groupPivots.weapon[1],1);near(s.muzzle[0],.78);
  assert.equal(t.wheelPositions.length,6);assert.equal(t.seats.length,4);near(t.centerHeight,1.4);near(t.wheelRadius,.46);
  near(t.bounds.length,5.8);near(t.bounds.width,2.4);assert.ok(assets.truck.parts.some(p=>p.paint),'truck repaint panels are explicitly authored');
  if(Stats.CAR_TYPES.truck){near(t.bounds.length*20,Stats.CAR_TYPES.truck.length);near(t.bounds.width*20,Stats.CAR_TYPES.truck.width);}
  const scene=fixture(),{model}=soldier(scene);model.group.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(model.group);near(bounds.max.y-bounds.min.y,s.height,1e-4);
});

test('soldiers preserve the generic person API while their independent yaw and pitch place the weapon on the real muzzle',()=>{
  const scene=fixture(),{entity,model}=soldier(scene),m=assets.soldier.metadata;
  assert.equal(model.group.scale.x,1,'Blender character scaling is already baked into the export');
  for(const heading of [-2,.4,2.2])for(const aim of [-2.7,0,1.9])for(const pitch of [-.3,0,.5]){
    entity.angle=heading;entity.aimAngle=aim;entity.aimPitch=pitch;model.group.rotation.y=-heading;Render.step(scene);model.group.updateMatrixWorld(true);
    const muzzle=model.soldier.rig.weapon.localToWorld(new T.Vector3(...m.muzzle));
    near(muzzle.x,entity.x/20+Math.cos(aim)*.78*Math.cos(pitch));near(muzzle.z,entity.y/20+Math.sin(aim)*.78*Math.cos(pitch));near(muzzle.y,entity.elevation+1+.78*Math.sin(pitch));
    for(const limb of ['leftLeg','rightLeg','leftArm','rightArm'])assert.ok(model[limb]?.isGroup);
  }
});

test('soldier gait follows movement, seated poses suppress fire, and stun or ragdoll never leaves a floating weapon',()=>{
  const scene=fixture(),{entity,model}=soldier(scene),rig=model.soldier.rig;
  scene.game.time=.1;Render.step(scene);near(model.leftLeg.rotation.z,0);
  entity.x+=8;entity.lastShotTime=.11;scene.game.time=.14;Render.step(scene);
  assert.notEqual(model.leftLeg.rotation.z,0);near(model.leftLeg.rotation.z,-model.rightLeg.rotation.z);assert.equal(model.soldier.flash.visible,true);assert.ok(rig.weapon.position.x<0);
  entity.transportedBy='troop-truck-render-1';entity.soldierPhase='riding';entity.elevation=14.52;scene.game.time=.15;Render.step(scene);
  assert.equal(model.group.visible,true);assert.equal(model.soldier.flash.visible,false);assert.equal(rig.torso.rotation.y,0);assert.ok(Math.abs(model.leftLeg.rotation.z)>.9);
  near(rig.leftShin.rotation.z,-Math.PI/2);near(rig.rightShin.rotation.z,-Math.PI/2);near(model.group.position.y+rig.hips.position.y,15.2);
  entity.transportedBy=null;entity.stunned=2;scene.game.time=.16;Render.step(scene);assert.equal(model.soldier.flash.visible,false);near(model.leftLeg.rotation.z,0);
  scene._bodyFor=()=>({joints:{}});Render.step(scene);assert.equal(model.group.visible,false);
  scene._bodyFor=()=>null;entity.stunned=0;entity.aimAngle=NaN;entity.aimPitch=Infinity;scene.game.time=1;Render.step(scene);
  assert.equal(model.group.visible,true);assert.ok(Number.isFinite(rig.torso.rotation.y));assert.ok(Number.isFinite(rig.weapon.rotation.z));near(rig.weapon.position.x,0);
});

test('seated troops follow the full carrier pose without creating extra cosmetic passengers',()=>{
  const scene=fixture(),carrier=truck(scene),rider=soldier(scene),q=new T.Quaternion().setFromEuler(new T.Euler(.18,-.8,.1));
  Object.assign(carrier.entity,{angle:.8,orientation:{x:q.x,y:q.y,z:q.z,w:q.w}});rider.entity.transportedBy=carrier.entity.id;
  for(const facing of [-Math.PI/2,Math.PI/2]){
    rider.entity.angle=carrier.entity.angle+facing;Render.step(scene);
    const expected=q.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-facing));
    assert.ok(Math.abs(rider.model.group.quaternion.dot(expected))>.999999,'each bench faces the crew inwards in the tilted carrier');
  }
  assert.equal(scene._troopRender.soldiers.size,1);
  const meshes=scene.scene.children.length;Render.step(scene);assert.equal(scene.scene.children.length,meshes);
});

test('troop carriers roll all six wheels, retain damage and fire, repaint in place and retire only their owned buffers',()=>{
  const scene=fixture(),a=truck(scene),b=truck(scene,'troop-truck-render-2');
  assert.equal(a.model.wheels.length,6);near(a.model.visual.position.y,-1.4);
  const hull=a.model.truck.animated.get('hull').geometry,buffer=hull.attributes.color.array,original=Float32Array.from(buffer);
  a.entity.speed=100;scene.game.time=.2;Render.step(scene);for(const wheel of a.model.wheels)assert.notEqual(wheel.rotation.z,0);
  a.entity.color='#efbd63';scene._paintVehicle(a.model,a.entity.color);Render.step(scene);assert.equal(hull.attributes.color.array,buffer);assert.notDeepEqual(buffer,original);
  const repaint=Float32Array.from(buffer);a.entity.health=80;a.entity.burning=true;a.entity.fireTime=3;scene._damageVehicle(a.model,a.entity);scene._vehicleEffects(a.model,a.entity);Render.step(scene);
  assert.notDeepEqual(buffer,repaint);assert.equal(a.model.effects.group.visible,true);
  let sourceDisposed=false,otherDisposed=false,ownDisposed=false;
  for(const source of scene._troopRender.source.truck.groups.values())source.geometry.addEventListener('dispose',()=>{sourceDisposed=true;});
  b.model.truck.animated.get('hull').geometry.addEventListener('dispose',()=>{otherDisposed=true;});hull.addEventListener('dispose',()=>{ownDisposed=true;});
  scene._retireVehicle(a.entity.id,a.model);Render.step(scene);assert.equal(ownDisposed,true);assert.equal(sourceDisposed,false);assert.equal(otherDisposed,false);assert.equal(scene._troopRender.trucks.has(a.entity.id),false);assert.equal(scene._troopRender.trucks.has(b.entity.id),true);
});

test('troop rigs and live projectile tracers reuse their geometry, including after soldier retirement',()=>{
  const scene=fixture(),a=soldier(scene),b=soldier(scene,'soldier-render-2');truck(scene);
  scene.game.soldierRounds.push({x:2540,y:-1200,height:15,vx:500,vy:100,vh:3});Render.step(scene);
  assert.equal(scene._troopRender.rounds.count,1);assert.equal(scene._troopRender.rounds.visible,true);
  const matrix=new T.Matrix4(),position=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3();scene._troopRender.rounds.getMatrixAt(0,matrix);matrix.decompose(position,rotation,scale);
  near(position.x,127);near(position.y,15);near(position.z,-60);
  const direction=new T.Vector3(1,0,0).applyQuaternion(rotation),expected=new T.Vector3(500,60,100).normalize();assert.ok(direction.distanceTo(expected)<1e-6,'tracer pitch converts the real metre-per-second vertical velocity');
  const geometries=scene._geometries.length,materials=scene._materials.size,rounds=scene._troopRender.rounds;
  for(let i=0;i<180;i++){scene.game.time+=1/60;a.entity.x+=.2;Render.step(scene);}
  assert.equal(scene._geometries.length,geometries);assert.equal(scene._materials.size,materials);assert.equal(scene._troopRender.rounds,rounds);
  let disposed=false;for(const source of scene._troopRender.source.soldier.groups.values())source.geometry.addEventListener('dispose',()=>{disposed=true;});
  Render.retireSoldier(scene,a.entity.id,a.model);scene._residents.delete(a.entity.id);scene.game.peds=scene.game.peds.filter(p=>p!==a.entity);scene.game.soldierRounds.length=0;Render.step(scene);
  assert.equal(scene._troopRender.soldiers.has(a.entity.id),false);assert.equal(scene._troopRender.soldiers.has(b.entity.id),true);assert.equal(disposed,false);assert.equal(rounds.visible,false);
});
