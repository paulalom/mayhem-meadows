'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../vendor/cannon.cjs');
const Aircraft=require('../aircraft.js');
const VehicleStats=require('../vehicle-stats.js');
const Physics=require('../physics.js');
const {VehicleWorld,height,personContact}=require('../vehicle-physics.js');

const craft=(overrides={})=>({id:'test-aircraft',kind:'aircraft',aircraftType:'trainer',x:1150,y:1000,elevation:0,
  angle:0,pitch:0,roll:0,speed:0,vx:0,vy:0,verticalVelocity:0,visible:true,...overrides});
const car=(overrides={})=>({id:'test-car',kind:'compact',x:1000,y:1000,elevation:0,angle:0,speed:100,vx:100,vy:0,
  health:100,maxHealth:100,engineHealth:100,handlingHealth:100,...overrides});
function fixture(planes=[],cars=[],buildings=[]) {
  const game={aircraft:planes,cars,police:[],buildings,staticObjects:[],worldSize:5600};
  return {game,world:new VehicleWorld(game,VehicleStats.CAR_TYPES)};
}
function step(world,seconds) {
  const contacts=[];
  for(let time=0;time<seconds-.000001;time+=1/60)contacts.push(...world.step(1/60));
  return contacts;
}
function expectedPose(plane) {
  const q=new C.Quaternion().setFromEuler(0,-plane.angle,0)
    .mult(new C.Quaternion().setFromEuler(plane.roll,0,plane.pitch,'YZX'));
  const offset=q.vmult(new C.Vec3(0,Aircraft.getModel(plane).height/2,0));
  return {q,position:new C.Vec3(plane.x/20+offset.x,plane.elevation+offset.y,plane.y/20+offset.z)};
}
const near=(a,b)=>Math.abs(a-b)<.000001;
const sameRotation=(a,b)=>near(Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w),1);

test('parked aircraft are solid to Cannon cars and report the aircraft contact entity',()=>{
  const plane=craft(),ride=car(),{world}=fixture([plane],[ride]);
  const contacts=step(world,1.1);
  assert.ok(contacts.some(contact=>contact.entity===ride&&contact.other===plane&&contact.vehicle),'the real car solver contacts the parked wing envelope');
  assert.ok(ride.x<plane.x-Aircraft.getModel(plane).length/2,'the car cannot drive through the airframe');
  assert.deepEqual([plane.x,plane.y,plane.elevation],[1150,1000,0],'car contact cannot replace the flight controller with chassis motion');
  const body=world.get(plane.id);
  assert.equal(body.type,C.Body.KINEMATIC);assert.equal(body.mass,0);
  assert.equal(world.bodies.has(plane.id),false,'aircraft never become road command bodies');
});

test('an aircraft flyover leaves road traffic clear and never receives duplicate gravity',()=>{
  const plane=craft({elevation:12}),ride=car(),baseline=car();
  const {world}=fixture([plane],[ride]),clear=fixture([],[baseline]);
  const contacts=step(world,.8);step(clear.world,.8);
  assert.equal(contacts.some(contact=>contact.other===plane),false);
  assert.ok(near(ride.x,baseline.x)&&near(ride.vx,baseline.vx),'height separation preserves road motion');
  assert.equal(plane.elevation,12);
  assert.ok(near(world.get(plane.id).position.y,12+Aircraft.getModel(plane).height/2));
});

test('moving kinematic aircraft transfer their actual contact velocity to road cars',()=>{
  const plane=craft({angle:Math.PI}),ride=car({speed:0,vx:0}),{world}=fixture([plane],[ride]);
  let contact=false;
  for(let frame=0;frame<30;frame++) {
    plane.x-=200/60;plane.vx=-200;plane.speed=200;
    const target=plane.x;
    const hits=world.step(1/60);contact||=hits.some(hit=>hit.other===plane);
    assert.equal(plane.x,target);
  }
  assert.ok(contact&&ride.vx<-20,'the aircraft sweep pushes the parked car with its own motion');
});

test('aircraft proxy pose follows visual yaw, pitch and roll around the ground anchor',()=>{
  const plane=craft({angle:.7,pitch:.32,roll:-.45,elevation:30}),{world}=fixture([plane]);
  const body=world.get(plane.id),initial=expectedPose(plane),model=Aircraft.getModel(plane);
  assert.ok(body.position.distanceTo(initial.position)<.000001);
  assert.ok(sameRotation(body.quaternion,initial.q));
  assert.deepEqual([body.shapes[0].halfExtents.x,body.shapes[0].halfExtents.y,body.shapes[0].halfExtents.z],[model.length/40,model.height/2,model.width/40]);
  Object.assign(plane,{x:plane.x+12,y:plane.y-6,elevation:31,angle:.8,pitch:.36,roll:-.4,vx:720,vy:-360,verticalVelocity:60});
  const target=expectedPose(plane);world.step(1/60);
  assert.equal(world.get(plane.id),body,'ordinary movement preserves proxy identity');
  assert.ok(body.position.distanceTo(target.position)<.000001,'Cannon finishes at the single aviation target pose');
  assert.ok(sameRotation(body.quaternion,target.q));
  const box=new Physics.RagdollWorld()._colliders({aircraft:[plane]})[0];
  assert.ok(near(box.x,body.position.x)&&near(box.y,body.position.y)&&near(box.z,body.position.z),'ragdoll contacts share the same rotated collider centre');
  assert.deepEqual([plane.x,plane.y,plane.elevation],[1162,994,31],'Cannon does not advance aviation a second time');
  world.control(plane,{up:true});world.impulse(plane,{x:10,y:10,z:0});
  assert.equal(world.bodies.has(plane.id),false,'road commands and blasts cannot create duplicate aircraft bodies');
});

test('aircraft share shot, ceiling and rooftop support queries without blocking space below',()=>{
  const plane=craft({x:1200,y:1200,elevation:8});
  const roof={x:1060,y:1060,w:280,h:280,height:8,elevation:0};
  const {world}=fixture([plane],[],[roof]),top=8+Aircraft.getModel(plane).height;
  assert.ok(near(world.support(1200,1200,20),top),'the entire parked aircraft is a supported landing surface');
  assert.ok(near(world.support(1200,1200,8.05),8),'roof queries below the aircraft retain the building roof');
  assert.ok(near(world.ceiling(1200,1200,7.8,12),8),'an upward head sweep finds the airframe underside');
  const hit=world.firstHit({x:900,y:1200,height:9},{x:1400,y:1200,height:9});
  assert.equal(hit.body.entity,plane,'tool shots reference the aircraft entity');
  assert.equal(world.firstHit({x:900,y:1200,height:top+1},{x:1400,y:1200,height:top+1}),null,'shots over the airframe remain clear');
  assert.equal(world.firstHit({x:900,y:1200,height:9},{x:1400,y:1200,height:9},plane.id),null,'a pilot can exclude their own aircraft');
});

test('people collide with full aircraft dimensions and only at the actual airframe height',()=>{
  const plane=craft(),model=Aircraft.getModel(plane),radius=Physics.PLAYER_RADIUS;
  const wing={x:plane.x,y:plane.y+model.width/2+radius/2,elevation:0};
  assert.ok(personContact(wing,plane,radius,model),'standing bodies cannot walk through the wing envelope');
  plane.elevation=8;
  assert.equal(personContact(wing,plane,radius,model),null,'a flying aircraft does not produce a ground wall');
  assert.ok(personContact({...wing,elevation:8},plane,radius,model));
  assert.equal(height(plane),model.height);
});

test('ragdolls land on aircraft wings beyond old road vehicle dimension limits',()=>{
  const plane=craft({x:1000,y:1000}),model=Aircraft.getModel(plane),ragdolls=new Physics.RagdollWorld();
  const person={id:'wing-passenger',x:1000,y:1080,angle:0,elevation:model.height+2};
  assert.equal(ragdolls.trigger(person),true);
  const body=ragdolls.get(person.id);
  for(let frame=0;frame<150;frame++)ragdolls.step(1/120,{size:5600,aircraft:[plane]});
  assert.ok(body.joints.pelvis.y>model.height+.1,'the wide wing supports the falling articulated person');
  for(const joint of Object.values(body.joints))assert.ok(joint.y>=model.height+joint.radius-.01,'each joint clears the same solid top');
  assert.equal(ragdolls._colliders({aircraft:[{...plane,visible:false}]}).length,0,'hidden flights cannot leave ragdoll walls');
});

test('aircraft proxy lifecycle preserves active bodies through town rebuilds and cleans up hidden flights',()=>{
  const plane=craft(),{game,world}=fixture([plane]),body=world.get(plane.id);
  game.buildings=[];game.staticObjects=[];world.sync();
  assert.equal(world.get(plane.id),body);assert.ok(world.world.bodies.includes(body));
  plane.aircraftType='transportheli';world.sync();
  assert.equal(world.get(plane.id),body,'a model change updates the existing proxy');
  assert.equal(body.shapes[0].halfExtents.x,Aircraft.AIRCRAFT_TYPES.transportheli.length/40);
  plane.visible=false;world.sync();
  assert.equal(world.get(plane.id),null);assert.equal(world.world.bodies.includes(body),false);
  plane.visible=true;world.sync();
  const returned=world.get(plane.id);assert.ok(returned);
  game.aircraft=[];world.sync();
  assert.equal(world.get(plane.id),null);assert.equal(world.world.bodies.includes(returned),false);assert.equal(world.aircraftBodies.size,0);
});
