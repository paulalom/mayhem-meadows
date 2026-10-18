'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({console,AbortController});
for(const file of ['vendor/three.min.js','aircraft-models.js','scene3d.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
const T=context.THREE,Scene=context.MayhemScene;
function fixture(){
  const scene=Object.create(Scene.prototype);
  Object.assign(scene,{T,game:{aircraft:[],player:{},cars:[],police:[],time:0},scene:new T.Scene(),_geometries:[],_materials:new Map(),_aircraft:new Map(),_aircraftGeometries:new Map(),_vehicles:new Map(),_residents:new Map(),_buildingVolumes:[],_color:new T.Color(),_dummy:new T.Object3D(),reducedMotion:true});
  scene._cube=scene._geometry(new T.BoxGeometry(1,1,1));scene._sphere=scene._geometry(new T.IcosahedronGeometry(1,1));scene._cylinder=scene._geometry(new T.CylinderGeometry(1,1,1,12));scene._cone=scene._geometry(new T.ConeGeometry(1,1,7));
  return scene;
}
function craft(type,role){return {id:role,kind:'aircraft',aircraftType:type,militaryRole:role,militaryResponse:true,gunFiring:true,visible:true,x:1000,y:1000,elevation:45,angle:0,health:200,maxHealth:200,engineHealth:100,throttle:.7,flightPhase:'chase'};}
test('military roles add authored cannons to existing airframes and flashes point forward or starboard',()=>{
  const scene=fixture(),jet=craft('fighter','interceptor'),heli=craft('transportheli','gunship');scene.game.aircraft=[jet,heli];scene._aircraftStep(0);
  for(const entity of [jet,heli]) {
    const model=scene._aircraft.get(entity.id),gun=model.militaryArmament;
    assert.ok(gun.group.children.some(mesh=>mesh.name==='Impact cannon breech'));assert.equal(gun.muzzle.visible,true);
    model.group.updateMatrixWorld(true);const point=gun.muzzle.getWorldPosition(new T.Vector3()).sub(model.group.position);
    if(entity===jet){assert.ok(point.x>6.4&&point.x<6.7);assert.ok(Math.abs(point.z)<.3);}
    else {assert.ok(point.z>2.2&&point.z<2.4);assert.ok(Math.abs(point.x)<.4);}
    assert.ok(point.y>1.7&&point.y<1.9);assert.ok(model.parts.length>20,'the original Blender fleet remains visible');
    entity.visible=false;scene._aircraftStep(0);assert.equal(gun.muzzle.visible,false);
    entity.visible=true;entity.militaryResponse=false;scene._aircraftStep(0);assert.equal(gun.group.visible,false);
  }
});
test('duty changes and replacement units reuse cannon geometry and dispose only owned materials',()=>{
  const scene=fixture(),jet=craft('fighter','interceptor');scene.game.aircraft=[jet];scene._aircraftStep(0);
  const model=scene._aircraft.get(jet.id),gun=model.militaryArmament,geometries=scene._geometries.length;
  let sharedDisposed=false;gun.group.children.find(m=>m.name==='Impact cannon breech').geometry.addEventListener('dispose',()=>{sharedDisposed=true;});
  for(let i=0;i<30;i++){jet.militaryResponse=i%2===0;jet.gunFiring=i%3===0;scene._aircraftStep(1/60);}
  assert.equal(model.militaryArmament,gun);assert.equal(scene._geometries.length,geometries);
  let disposed=0;for(const entry of model.materials)entry.material.addEventListener('dispose',()=>disposed++);
  scene.game.aircraft=[];scene._aircraftStep(0);assert.equal(disposed,model.materials.length);assert.equal(sharedDisposed,false);
  scene.game.aircraft=[craft('fighter','interceptor')];scene._aircraftStep(0);assert.equal(scene._geometries.length,geometries);
});
