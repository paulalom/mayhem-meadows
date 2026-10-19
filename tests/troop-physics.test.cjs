'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../vendor/cannon.cjs');
const Stats = require('../vehicle-stats.js');
const Physics = require('../physics.js');
const { VehicleWorld, personContact, height } = require('../vehicle-physics.js');
const { AircraftSystem } = require('../aircraft.js');

const truck = (overrides = {}) => ({ id:'carrier', kind:'truck', modelId:'northwatch-carrier', x:1000, y:1000,
  angle:0, elevation:0, speed:0, vx:0, vy:0, health:240, maxHealth:240, engineHealth:100, handlingHealth:100, ...overrides });
function fixture(ride = truck(), extras = {}) {
  const game = { cars:[ride], police:[], peds:[], buildings:[], staticObjects:[], worldSize:5600,
    player:{id:'player',x:500,y:500,elevation:0,composure:100}, world:{}, _ground:()=>0, ...extras };
  const physics = new VehicleWorld(game, Stats.CAR_TYPES); game.vehiclePhysics=physics;
  return {ride,game,physics};
}
function advance(f, seconds, command, observe = () => {}) {
  f.physics.sync(); const impacts=[];
  for(let tick=0;tick<Math.round(seconds*60);tick++) {
    if(command)f.physics.control(f.ride,typeof command==='function'?command(f.ride):command);
    impacts.push(...f.physics.step(1/60)); observe();
  }
  return impacts;
}
function distanceToBox(point,box) {
  const m=box.basis,d=[point.x-box.x,point.y-box.y,point.z-box.z];
  const local=[d[0]*m[0]+d[1]*m[3]+d[2]*m[6],d[0]*m[1]+d[1]*m[4]+d[2]*m[7],d[0]*m[2]+d[1]*m[5]+d[2]*m[8]];
  return Math.hypot(...local.map((v,i)=>Math.max(0,Math.abs(v)-[box.hx,box.hy,box.hz][i])));
}

test('Carrier uses its own model and a full-height heavy dynamic chassis',()=>{
  const f=fixture(), model=Stats.getModel(f.ride),body=f.physics.get(f.ride.id);
  assert.equal(model.id,'northwatch-carrier'); assert.equal(model.maxHealth,240);
  assert.equal(model.maxSpeed,215); assert.equal(model.acceleration,180); assert.equal(model.handling,1.25);
  assert.equal(model.durability,1.8); assert.equal(model.engineDurability,1.6);
  assert.equal(body.type,C.Body.DYNAMIC); assert.equal(body.mass,2450); assert.equal(body.shapes.length,1);
  assert.deepEqual(body.shapes[0].halfExtents,new C.Vec3(2.9,1.4,1.2)); assert.equal(height(f.ride),2.8);
  assert.equal(f.ride.colliderHeight,2.8); assert.ok(Math.abs(body.position.y-1.406)<.00001);
  assert.equal(Stats.getModel({kind:'van'}).id,'mirth-party-wagon'); assert.equal(Stats.getModel({kind:'tank'}).height,2.6);
});

test('truck accelerates, brakes, reverses and makes a rolling hairpin without tank-style pivots',()=>{
  const f=fixture(); advance(f,3,{up:true});
  assert.ok(f.ride.x>1400); assert.ok(f.ride.speed>205&&f.ride.speed<216);
  advance(f,2,{targetSpeed:0,heading:0,brake:true}); assert.ok(Math.abs(f.ride.speed)<1);
  const parkedAngle=f.ride.angle; advance(f,1,{targetSpeed:0,heading:Math.PI});
  assert.ok(Math.abs(f.ride.angle-parkedAngle)<.03,'road wheels cannot turn a stationary truck');
  advance(f,1.5,{down:true}); assert.ok(f.ride.speed< -90);
  advance(f,2,{targetSpeed:0,heading:0,brake:true});
  f.ride.x=1000;f.ride.y=1000;f.ride.angle=0;f.ride.speed=f.ride.vx=f.ride.vy=0;f.physics.reset(f.ride);
  let maxSpeed=0; advance(f,12,{targetSpeed:65,heading:Math.PI},()=>{maxSpeed=Math.max(maxSpeed,Math.abs(f.ride.speed));});
  assert.ok(Math.abs(Math.atan2(Math.sin(f.ride.angle-Math.PI),Math.cos(f.ride.angle-Math.PI)))<.2,'a rolling truck completes a 180-degree turn');
  assert.ok(maxSpeed>60); assert.ok(f.ride.x<1000); assert.ok(f.ride.upright&&f.ride.grounded);
});

test('long truck chassis follows actual base-access terrain and holds position on its grade',()=>{
  const world=require('../world.js').createWorld(),road=world.roads.find(r=>r.id==='base-access-ridge');
  const a=road.points[5],b=road.points.at(-1),angle=Math.atan2(b.y-a.y,b.x-a.x);
  const ride=truck({x:a.x,y:a.y,angle,elevation:world.terrain.surfaceHeight(a.x,a.y)});
  const f=fixture(ride,{terrain:world.terrain,bounds:world.bounds,worldSize:world.size,roads:world.roads,buildings:world.buildings,staticObjects:world.staticObjects});
  f.physics.reset(ride); const start={x:ride.x,y:ride.y,elevation:ride.elevation};let gap=0;
  const impacts=advance(f,3,{targetSpeed:95,heading:angle},()=>{gap=Math.max(gap,Math.abs(ride.elevation-world.terrain.surfaceHeight(ride.x,ride.y)));});
  assert.ok(Math.hypot(ride.x-start.x,ride.y-start.y)>230); assert.ok(ride.elevation>start.elevation+.3);
  assert.ok(gap<.25);assert.equal(impacts.length,0);assert.ok(ride.upright&&ride.grounded);
  f.physics.reset(ride);const parked={x:ride.x,y:ride.y};advance(f,2);
  assert.ok(Math.hypot(ride.x-parked.x,ride.y-parked.y)<1);
});

test('truck contacts transfer momentum to cars and stop against buildings and thin base fences',()=>{
  const car={id:'civilian',kind:'compact',x:1140,y:1000,angle:0,elevation:0,speed:0,vx:0,vy:0,health:100};
  const ride=truck({speed:150,vx:150}),f=fixture(ride,{cars:[ride,car],buildings:[{x:1450,y:800,w:100,h:400,height:6}]});
  let displaced=false;const hits=advance(f,5,{up:true},()=>{displaced ||= car.x>1180;});
  assert.ok(displaced);assert.ok(hits.some(hit=>hit.other===car));assert.ok(f.ride.x<1410,'solid wall cannot be driven through');
  const fence=fixture(truck({speed:125,vx:125}),{staticObjects:[{kind:'military-fence',x:1170,y:1000,elevation:0,parts:[{half:[.08,1.25,4],offset:[0,1.25,0]}]}]});
  assert.ok(advance(fence,2,{up:true}).some(hit=>hit.prop?.kind==='military-fence'));
  assert.ok(fence.ride.x<1125);
});

test('truck meets real tank, train and aircraft solids with its tall body',()=>{
  const tank={id:'warden',kind:'tank',x:1180,y:1000,angle:0,elevation:0,speed:0,vx:0,vy:0,health:600,tankGun:{turretAngle:0,pitch:0}};
  const ride=truck({speed:100,vx:100}),pair=fixture(ride,{cars:[ride,tank]});
  assert.ok(advance(pair,2,{up:true}).some(hit=>hit.other===tank));
  for(const kind of ['aircraft','train']) {
    const other=kind==='aircraft'?{id:'airframe',kind,aircraftType:'trainer',x:1200,y:1000,angle:0,elevation:2,health:160,visible:true}:
      {id:'train',kind,x:1200,y:1000,angle:0,elevation:0,active:true,railModel:{length:190,width:62,height:3.8}};
    const f=fixture(truck({speed:100,vx:100}),kind==='aircraft'?{aircraft:[other]}:{railTraffic:{colliders:[other]}});
    const hits=advance(f,2,{up:true});assert.ok(hits.some(hit=>hit.other===other),`${kind} participates in physical truck contacts`);
    const gear=kind==='aircraft'?Physics.aircraftParts(other).find(part=>part.name==='main wheel'):null;
    const obstacleX=gear?other.x+(gear.offset[0]-gear.half[0])*20:other.x-other.railModel.length/2;
    assert.ok(f.ride.x+Stats.getModel(f.ride).length/2<=obstacleX+2,
      'the truck stops at the actual solid; an elevated tail leaves space below it');
  }
});

test('truck roof, aimed cover rays, standing people and falling joints share its full-height box',()=>{
  const f=fixture(),ray=z=>f.physics.firstHit({x:1000,y:900,height:z},{x:1000,y:1100,height:z});
  assert.equal(ray(2.65).body.entity,f.ride,'raised troop compartment shields aimed rifle fire');assert.equal(ray(2.9),null);
  assert.ok(Math.abs(f.physics.support(1000,1000,5)-2.806)<.02);
  assert.ok(personContact({id:'soldier',x:1055,y:1000,elevation:0},f.ride,Physics.NPC_RADIUS,Stats.CAR_TYPES.truck));
  assert.ok(personContact({id:'soldier',x:1055,y:1000,elevation:2},f.ride,Physics.NPC_RADIUS,Stats.CAR_TYPES.truck),'jumping person meets tall cargo body');
  const world=new Physics.RagdollWorld(),person={id:'falling-soldier',x:1000,y:1000,angle:0};world.trigger(person,{x:.2,z:.1},{height:4});
  const body=world.get(person.id),box=world._colliders({cars:[f.ride]})[0];assert.equal(box.hy,1.4);
  let contact=false;
  for(let tick=0;tick<240;tick++) {
    world.step(Physics.STEP,{cars:[f.ride]});
    for(const joint of Object.values(body.joints)) {const gap=distanceToBox(joint,box);contact ||= gap<joint.radius+.025;assert.ok(gap>=joint.radius-.003);}
  }
  assert.ok(contact,'ragdoll joints land on the truck roof');
});

test('aircraft rounds and airframe sweeps hit the tall truck while transported soldiers stay inside its armor',()=>{
  const f=fixture(),knocked=[];f.game._damageVehicle=(target,amount)=>{target.health-=amount;};f.game._knockDown=target=>{knocked.push(target.id);return true;};
  const rider={id:'rider',soldier:true,transportedBy:f.ride.id,x:1000,y:970,elevation:1.5,angle:0};f.game.peds=[rider];
  const aviation=new AircraftSystem(f.game,{spawn:false});
  aviation.aircraftProjectiles.push({id:'roof-round',x:1000,y:900,elevation:2.65,vx:0,vy:200,vz:0,life:2,ownerId:'pilot',damage:8,npc:false});
  aviation._projectiles(1);assert.equal(f.ride.health,232);assert.deepEqual(knocked,[]);
  f.game.cars=[];f.physics.sync();rider.elevation=0;
  aviation.aircraftProjectiles.push({id:'passenger-round',x:1000,y:900,elevation:1,vx:0,vy:200,vz:0,life:2,ownerId:'pilot',damage:8,npc:false});
  aviation._projectiles(1);assert.deepEqual(knocked,[]);assert.equal(aviation.aircraftProjectiles.length,1,'passenger is not an independently targetable standing person');
  assert.equal(personContact(rider,f.ride,Physics.NPC_RADIUS,Stats.CAR_TYPES.truck),null);
  const ragdolls=new Physics.RagdollWorld();assert.equal(ragdolls.trigger(rider,{x:3,y:4}),false);assert.equal(ragdolls.get(rider.id),undefined);
  f.game.cars=[f.ride];f.physics.sync();const plane=aviation.spawn('trainer',{x:1250,y:1000,angle:0,elevation:2.1},{speed:200,vz:0});
  const before={x:750,y:1000,elevation:2.1};aviation._collide(plane,before);
  assert.ok(plane.speed<0,'low airborne aircraft cannot pass through the high cargo compartment');assert.ok(f.ride.health<232);
});

test('aircraft rounds use the real pitched truck hull rather than a flat car footprint',()=>{
  const q=new C.Quaternion().setFromEuler(0,0,Math.PI/4);
  const shot=(x,z)=>{
    const f=fixture(truck({elevation:3,orientation:{x:q.x,y:q.y,z:q.z,w:q.w}}));f.game._damageVehicle=(target,amount)=>{target.health-=amount;};
    const aviation=new AircraftSystem(f.game,{spawn:false});
    aviation.aircraftProjectiles.push({id:'pitched-hull-round',x,y:900,elevation:z,vx:0,vy:200,vz:0,life:2,ownerId:'pilot',damage:8,npc:false});
    const physical=f.physics.firstHit({x,y:900,height:z},{x,y:1100,height:z});aviation._projectiles(1);
    return {physical,health:f.ride.health};
  };
  const high=shot(1030,6.2);assert.ok(high.physical);assert.equal(high.health,232,'raised truck corner catches a round above its yaw-only roof');
  const voidSpace=shot(1050,3.2);assert.equal(voidSpace.physical,null);assert.equal(voidSpace.health,240,'air beneath a pitched corner does not take damage');
});
