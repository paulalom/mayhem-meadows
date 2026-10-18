'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../vendor/cannon.cjs'),T=require('../trains.js'),Stats=require('../vehicle-stats.js'),Physics=require('../physics.js');
const {VehicleWorld,height,personContact}=require('../vehicle-physics.js');
function fixture(rail){const car={id:'car',kind:'compact',x:1000,y:1000,elevation:0,angle:0,speed:100,vx:100,vy:0,health:100,engineHealth:100,handlingHealth:100};const game={cars:[car],police:[],buildings:[],staticObjects:[],worldSize:5600,railTraffic:{colliders:[rail]}};return {car,world:new VehicleWorld(game,Stats.CAR_TYPES)};}
const train=(extra={})=>({id:'train',kind:'train',railModel:T.MODELS.passenger,x:1180,y:1000,elevation:0,angle:0,pitch:0,roll:0,vx:0,vy:0,speed:0,visible:true,active:true,...extra});
test('actual car solver contacts train bodies without converting them into road vehicles',()=>{const rail=train(),{car,world}=fixture(rail);let hit=false;for(let i=0;i<100;i++)hit||=world.step(1/60).some(c=>c.entity===car&&c.other===rail);assert.ok(hit);assert.equal(world.get(rail.id).type,C.Body.KINEMATIC);assert.equal(world.bodies.has(rail.id),false);assert.equal(rail.x,1180);assert.ok(car.x<rail.x-T.MODELS.passenger.length/2);});
test('moving trains push a road car with their controlled velocity and remain on the rails',()=>{const rail=train({angle:Math.PI}),{car,world}=fixture(rail);car.speed=car.vx=0;let hit=false;for(let i=0;i<60;i++){rail.x-=120/60;rail.vx=-120;const x=rail.x;hit||=world.step(1/60).some(c=>c.other===rail);assert.equal(rail.x,x);}assert.ok(hit);assert.ok(car.vx<-15);assert.equal(rail.elevation,0);});
test('closed crossing barriers are physical and remove their body when raised',()=>{const gate=train({kind:'rail-gate',railModel:{length:200,width:6,height:.18},x:1090,angle:Math.PI/2,elevation:1}),{car,world}=fixture(gate);let hit=false;for(let i=0;i<80;i++)hit||=world.step(1/60).some(c=>c.other===gate);assert.ok(hit);assert.ok(car.x<1090);gate.active=gate.visible=false;world.step(1/60);assert.equal(world.get(gate.id),null);});
test('standing people and ragdolls use the full train envelope and bridge height separation',()=>{const rail=train({pitch:.04,elevation:2}),person={x:1180,y:1000,elevation:2};assert.equal(height(rail),2.71);assert.ok(personContact(person,rail,8,rail.railModel));assert.equal(personContact({...person,elevation:6},rail,8,rail.railModel),null);const ragdolls=new Physics.RagdollWorld(),boxes=ragdolls._colliders({railVehicles:[rail]});assert.equal(boxes.length,1);assert.ok(Math.abs(boxes[0].hx-4.25)<1e-9);});

test('Cannon road traffic brakes for a real scheduled crossing and resumes without hitting arms or trains',()=>{
  const layout=require('../world.js').createWorld().railway,game={world:{railway:layout,terrain:{heightAt:()=>0},sidewalkWidth:18},cars:[],police:[],peds:[],aircraft:[],buildings:[],staticObjects:[],worldSize:12000};
  const system=game.railTraffic=new T.TrainSystem(game);for(const s of system.services.slice(1))s.next=1e8;
  const gate=system.gates[0];game.peds=[{x:gate.x,y:gate.y}];while(gate.state==='open')system.step(1/60);
  const c=Math.cos(gate.angle),s=Math.sin(gate.angle),car={id:'road-test',kind:'compact',x:gate.x-c*(gate.halfLength+300),y:gate.y-s*(gate.halfLength+300),angle:gate.angle,speed:0,vx:0,vy:0,health:100,engineHealth:100,handlingHealth:100};game.cars=[car];
  const world=new VehicleWorld(game,Stats.CAR_TYPES);let stopped=false,resumed=false;
  for(let i=0;i<60*65;i++){world.sync();system.step(1/60);world.control(car,{targetSpeed:system.roadSpeedLimit(car,gate.angle,90),heading:gate.angle});const hits=world.step(1/60);assert.equal(hits.some(hit=>hit.other?.railModel),false,'road vehicle remains outside physical rail traffic');const along=(car.x-gate.x)*c+(car.y-gate.y)*s;
    if(gate.state!=='open'&&Math.abs(car.speed)<1&&along<-gate.halfLength&&along>-gate.halfLength-90){stopped=true;game.peds=[];}
    if(stopped&&gate.state==='open'&&along>gate.halfLength+100)resumed=true;
  }
  assert.ok(stopped);assert.ok(resumed);
});

test('Blender mesh bounds fit the physical train cars and retain authored geometry',()=>{
  const models=require('../train-models.js'),manifest=require('../assets/trains/manifest.json');assert.equal(Object.keys(models).length,3);
  for(const [type,source]of Object.entries(models)){const envelope=T.MODELS[type];assert.ok(source.parts.length>20);let triangles=0;for(const part of source.parts){assert.equal(part.indices.length%3,0);triangles+=part.indices.length/3;for(let i=0;i<part.positions.length;i+=3){assert.ok(Math.abs(part.positions[i])<=envelope.length/40+.001);assert.ok(part.positions[i+1]>=-.001&&part.positions[i+1]<=envelope.height+.001);assert.ok(Math.abs(part.positions[i+2])<=envelope.width/40+.001);}}assert.equal(triangles,manifest.models[type].triangles);}
});
