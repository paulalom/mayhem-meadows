'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../vendor/cannon.cjs');
const Stats = require('../vehicle-stats.js');
const Physics = require('../physics.js');
const { VehicleWorld, personContact, height } = require('../vehicle-physics.js');

const tank = (overrides = {}) => ({ id:'warden', kind:'tank', modelId:'northwatch-warden', x:1000, y:1000,
  angle:0, elevation:0, speed:0, vx:0, vy:0, health:600, maxHealth:600, engineHealth:100, handlingHealth:100,
  tankGun:{ turretAngle:0, pitch:0 }, ...overrides });
const fixture = (ride = tank(), extras = {}) => {
  const game = { cars:[ride], police:[], buildings:[], staticObjects:[], worldSize:5600, ...extras };
  return { ride, game, physics:new VehicleWorld(game, Stats.CAR_TYPES) };
};
function advance(f, seconds, command, observe = () => {}) {
  f.physics.sync();
  const impacts = [];
  for (let i=0;i<Math.round(seconds*60);i++) {
    if (command) f.physics.control(f.ride, typeof command === 'function' ? command(f.ride) : command);
    impacts.push(...f.physics.step(1/60)); observe();
  }
  return impacts;
}
function distanceToSolid(point, box) {
  const m=box.basis, d=[point.x-box.x,point.y-box.y,point.z-box.z];
  const local=[d[0]*m[0]+d[1]*m[3]+d[2]*m[6],d[0]*m[1]+d[1]*m[4]+d[2]*m[7],d[0]*m[2]+d[1]*m[5]+d[2]*m[8]];
  return Math.hypot(...local.map((v,i)=>Math.max(0,Math.abs(v)-[box.hx,box.hy,box.hz][i])));
}

test('Warden stats create a heavy low-centred articulated dynamic tank, preserving civilian models', () => {
  const f=fixture(), body=f.physics.get(f.ride.id), stats=Stats.getModel(f.ride);
  assert.equal(stats.id,'northwatch-warden'); assert.equal(stats.length,104); assert.equal(stats.width,48);
  assert.equal(stats.maxSpeed,125); assert.equal(stats.maxHealth,600); assert.equal(stats.durability,4);
  assert.equal(body.type,C.Body.DYNAMIC); assert.equal(body.mass,5250); assert.equal(body.shapes.length,3);
  assert.deepEqual(body.shapes[0].halfExtents,new C.Vec3(2.6,.7,1.2));
  assert.ok(Math.abs(body.position.y-.706)<.00001); assert.equal(height(f.ride),2.6);
  assert.equal(Stats.getModel({kind:'van'}).id,'mirth-party-wagon');
  assert.equal(Stats.getModel({kind:'sports'}).maxSpeed,370);
});

test('tracks accelerate within their limit, reverse, brake, and pivot while stopped', () => {
  const f=fixture(); advance(f,3,{up:true});
  assert.ok(f.ride.x>1270,'real forces move the hull forward');
  assert.ok(f.ride.speed>115&&f.ride.speed<126,'the tracked drivetrain respects its lower road speed');
  advance(f,2,{targetSpeed:0,heading:0});
  assert.ok(Math.abs(f.ride.speed)<1);
  const start={x:f.ride.x,y:f.ride.y}; advance(f,1.6,{targetSpeed:0,heading:Math.PI/2});
  assert.ok(f.ride.angle>.8,'differential tracks turn an otherwise stationary chassis');
  assert.ok(Math.hypot(f.ride.x-start.x,f.ride.y-start.y)<3);
  advance(f,1.2,{down:true}); assert.ok(f.ride.speed< -50,'the physical chassis can reverse');
  assert.ok(f.ride.upright&&f.ride.grounded);
});

test('gun yaw and pitch rotate solid turret/barrel contacts without filling space beneath them', () => {
  const f=fixture(), p=f.physics, hit=(a,b)=>p.firstHit(a,b);
  assert.equal(hit({x:1070,y:990,height:2.05},{x:1070,y:1010,height:2.05}).body.entity,f.ride,'barrel stops an aimed shot');
  assert.equal(hit({x:1070,y:990,height:.75},{x:1070,y:1010,height:.75}),null,'walking height below overhanging barrel stays clear');
  assert.equal(personContact({x:1070,y:1000,elevation:0},f.ride,Physics.PLAYER_RADIUS,Stats.CAR_TYPES.tank),null);
  assert.ok(personContact({x:1049,y:1000,elevation:0},f.ride,Physics.PLAYER_RADIUS,Stats.CAR_TYPES.tank),'standing people meet the hull');
  assert.ok(Math.abs(p.support(1070,1000,5)-2.15)<.02);
  assert.ok(Math.abs(p.support(1040,1018,5)-1.406)<.02,'hull deck is lower than the turret roof');
  f.ride.tankGun.turretAngle=Math.PI/2; p.sync();
  assert.equal(hit({x:1070,y:990,height:2.05},{x:1070,y:1010,height:2.05}),null,'old barrel location clears after rotation');
  assert.equal(hit({x:990,y:1070,height:2.05},{x:1010,y:1070,height:2.05}).body.entity,f.ride);
  f.ride.tankGun.pitch=.3; p.sync();
  assert.equal(hit({x:990,y:1070,height:2.05},{x:1010,y:1070,height:2.05}),null,'pitched barrel leaves its neutral line');
  const barrel=Physics.tankBoxes(f.ride).find(b=>b.part==='barrel');
  const probe=p.firstHit({x:barrel.x*20-10,y:barrel.z*20,height:barrel.y},{x:barrel.x*20+10,y:barrel.z*20,height:barrel.y});
  assert.equal(probe.body.entity,f.ride,'projectile sweeps meet the elevated aimed barrel');
});

test('a tank transfers momentum to cars and is stopped by solid walls and perimeter fencing', () => {
  const car={id:'compact',kind:'compact',x:1130,y:1000,angle:0,speed:0,vx:0,vy:0,health:100};
  const f=fixture(tank({speed:125,vx:125}),{cars:[],buildings:[{x:1400,y:800,w:100,h:400,height:6}]});
  f.game.cars=[f.ride,car]; f.physics.sync();
  let moved=false, wall=false; const impacts=advance(f,5,{up:true},()=>{moved ||= car.x>1160; wall ||= f.ride.x>1300&&f.ride.vx<5;});
  assert.ok(moved,'the heavier tank pushes an ordinary car through actual contact impulses');
  assert.ok(impacts.some(i=>i.other===car)); assert.ok(wall,'a solid building arrests the tank');
  assert.ok(f.ride.x<1400-45,'the hull cannot cross a building wall');
  const fence=fixture(tank({speed:125,vx:125}),{staticObjects:[{kind:'military-fence',x:1150,y:1000,elevation:0,parts:[{half:[.08,1.25,4],offset:[0,1.25,0]}]}]});
  const fenceHits=advance(fence,2,{up:true});
  assert.ok(fenceHits.some(i=>i.prop?.kind==='military-fence')); assert.ok(fence.ride.x<1110,'thin base fencing remains a physical boundary');
});

test('Cannon resolves an elevated car against the barrel while a ground car can pass beneath the overhang', () => {
  function cross(elevation) {
    const ride=tank(), car={id:'crossing',kind:'compact',x:1074,y:970,angle:Math.PI/2,elevation,speed:100,vx:0,vy:100,health:100};
    const f=fixture(ride,{cars:[ride,car]});
    const impacts=advance(f,.65);
    return {car,impacts};
  }
  const below=cross(0), raised=cross(.9);
  assert.ok(below.car.y>1025,'ground car crosses under the actual elevated barrel');
  assert.equal(below.impacts.filter(i=>i.other).length,0,'empty under-barrel space creates no phantom vehicle contact');
  assert.ok(raised.impacts.some(i=>i.other),'an airborne chassis actually contacts the overhanging gun');
});

test('tipped tank hull, turret and elevated gun retain matching Cannon and articulated-body poses', () => {
  const q=new C.Quaternion().setFromEuler(.28,-.5,.2);
  const f=fixture(tank({elevation:4,angle:.5,orientation:{x:q.x,y:q.y,z:q.z,w:q.w},tankGun:{turretAngle:1.1,pitch:.25}}));
  advance(f,1/60);
  const body=f.physics.get(f.ride.id), boxes=Physics.tankBoxes(f.ride);
  for (let i=0;i<boxes.length;i++) {
    const actual=body.quaternion.vmult(body.shapeOffsets[i]).vadd(body.position), box=boxes[i];
    assert.ok(Math.hypot(actual.x-box.x,actual.y-box.y,actual.z-box.z)<1e-9,'each compound centre uses the same ground anchor and chassis pose');
    const orientation=body.quaternion.mult(body.shapeOrientations[i]);
    const forward=orientation.vmult(new C.Vec3(1,0,0));
    assert.ok(Math.hypot(forward.x-box.basis[0],forward.y-box.basis[3],forward.z-box.basis[6])<1e-9,'aimed solid axes match after hull pitch and roll');
  }
});

test('the actual graded outskirts road supports sustained tank driving and parked recovery', () => {
  const world=require('../world.js').createWorld(), road=world.roads.find(r=>r.id==='base-access-ridge');
  const a=road.points[5], b=road.points.at(-1), angle=Math.atan2(b.y-a.y,b.x-a.x);
  const ride=tank({x:a.x,y:a.y,angle,elevation:world.terrain.surfaceHeight(a.x,a.y),tankGun:{turretAngle:angle,pitch:0}});
  const f=fixture(ride,{terrain:world.terrain,bounds:world.bounds,worldSize:world.size,roads:world.roads,buildings:world.buildings,staticObjects:world.staticObjects});
  f.physics.reset(ride); const start={x:ride.x,y:ride.y,elevation:ride.elevation}; let gap=0;
  const impacts=advance(f,3,{targetSpeed:95,heading:angle},()=>{gap=Math.max(gap,Math.abs(ride.elevation-world.terrain.surfaceHeight(ride.x,ride.y)));});
  assert.ok(Math.hypot(ride.x-start.x,ride.y-start.y)>230,'tank climbs the real access-road formation');
  assert.ok(gap<.2,'hull remains on the graded terrain'); assert.equal(impacts.length,0);
  assert.ok(ride.elevation>start.elevation+.3); assert.ok(ride.upright&&ride.grounded);
  f.physics.reset(ride); const parked={x:ride.x,y:ride.y}; advance(f,2);
  assert.ok(Math.hypot(ride.x-parked.x,ride.y-parked.y)<1,'parked tracks hold on the outskirts grade');
});

test('fallen people use the same separate hull and aimed gun solids as projectile and vehicle contacts', () => {
  const ride=tank({tankGun:{turretAngle:.65,pitch:.2}}), world=new Physics.RagdollWorld();
  const person={id:'roof-fall',x:1000,y:1000,angle:0}; world.trigger(person,{x:1,z:.2},{height:3});
  const body=world.get(person.id), boxes=world._colliders({cars:[ride]});
  assert.equal(boxes.length,3); assert.deepEqual(boxes.map(b=>b.part),['hull','turret','barrel']);
  let contact=false;
  for (let i=0;i<300;i++) {
    world.step(Physics.STEP,{cars:[ride]});
    for (const joint of Object.values(body.joints)) for (const box of boxes) {
      const clearance=distanceToSolid(joint,box); contact ||= clearance<joint.radius+.025;
      assert.ok(clearance>=joint.radius-.003,'joint spheres stay outside each articulated solid');
      assert.ok(Number.isFinite(joint.x)&&Number.isFinite(joint.y)&&Number.isFinite(joint.z));
    }
  }
  assert.ok(contact,'falling joints actually reach the tank');
});

test('standing-person broadphase includes the gun tip when a jumping player reaches its height', () => {
  const f=fixture(), person={id:'player',x:1074,y:1000,elevation:1.2}, {Game}=require('../core.js');
  const context={player:person,vehiclePhysics:f.physics};
  assert.ok(Game.prototype._personVehicleContact.call(context,person,f.ride,Physics.PLAYER_RADIUS),'a jumping player meets the overhanging barrel beyond the hull radius');
  person.elevation=0;
  assert.equal(Game.prototype._personVehicleContact.call(context,person,f.ride,Physics.PLAYER_RADIUS),null,'the broader candidate search still leaves ground clearance beneath the gun');
});

test('aircraft rounds hit the posed turret and barrel, preserve under-barrel clearance, and respect nearer cover and owners', () => {
  const {AircraftSystem}=require('../aircraft.js');
  function shoot({from,to,gun={turretAngle:0,pitch:0},buildings=[],ownerId='shooter',physical=true}) {
    const f=fixture(tank({tankGun:gun}),{buildings});
    Object.assign(f.game,{world:{},player:{id:'player',x:400,y:400,elevation:0},_ground:()=>0,_damageVehicle:(target,amount)=>{target.health-=amount;}});
    if(physical)f.game.vehiclePhysics=f.physics;
    const aviation=new AircraftSystem(f.game,{spawn:false});
    aviation.aircraftProjectiles.push({id:'tank-test-round',...from,vx:to.x-from.x,vy:to.y-from.y,vz:to.elevation-from.elevation,life:2,ownerId,npc:false,damage:8});
    aviation._projectiles(1);
    return {ride:f.ride,rounds:aviation.aircraftProjectiles};
  }
  for(const physical of [true,false]) {
    assert.equal(shoot({physical,from:{x:1000,y:900,elevation:2},to:{x:1000,y:1100,elevation:2}}).ride.health,592,'turret shots count above the old car collider');
    assert.equal(shoot({physical,from:{x:1074,y:980,elevation:2.05},to:{x:1074,y:1020,elevation:2.05}}).ride.health,592,'an overhanging barrel stops an aircraft round');
    assert.equal(shoot({physical,gun:{turretAngle:Math.PI/2,pitch:0},from:{x:980,y:1074,elevation:2.05},to:{x:1020,y:1074,elevation:2.05}}).ride.health,592,'turret rotation moves its projectile collider');
    const below=shoot({physical,from:{x:1074,y:980,elevation:.75},to:{x:1074,y:1020,elevation:.75}});
    assert.equal(below.ride.health,600); assert.equal(below.rounds.length,1,'empty space beneath the gun does not stop rounds');
    const covered=shoot({physical,from:{x:1000,y:900,elevation:2},to:{x:1000,y:1100,elevation:2},buildings:[{x:990,y:940,w:20,h:20,height:4}]});
    assert.equal(covered.ride.health,600); assert.equal(covered.rounds.length,0,'nearer cover intercepts before any tank solid');
    assert.equal(shoot({physical,from:{x:1000,y:1000,elevation:1},to:{x:1200,y:1000,elevation:1},ownerId:'warden'}).ride.health,600,'the firing chassis is ignored');
  }
});
