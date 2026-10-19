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
function samePart(shape,part) {
  if(part.shape==='cylinder') {
    assert.ok(shape instanceof C.Cylinder,'the rotor uses a thin swept disc');
    assert.equal(shape.radiusTop,part.half[0]);assert.equal(shape.radiusBottom,part.half[0]);
    assert.equal(shape.height,part.half[1]*2);
  } else assert.deepEqual([shape.halfExtents.x,shape.halfExtents.y,shape.halfExtents.z],part.half);
}

test('parked aircraft are solid to Cannon cars and report the aircraft contact entity',()=>{
  const plane=craft(),ride=car(),{world}=fixture([plane],[ride]);
  const contacts=step(world,1.1);
  assert.ok(contacts.some(contact=>contact.entity===ride&&contact.other===plane&&contact.vehicle),'the real car solver contacts the parked airframe');
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

test('Cannon cars can drive through empty aircraft corners and below helicopter rotors',()=>{
  for(const [aircraftType,x,z] of [['fighter',5,3],['helicopter',0,3],['transportheli',0,4]]) {
    const plane=craft({aircraftType}),ride=car({x:plane.x+x*20,y:plane.y+z*20}),baseline={...ride};
    const {world}=fixture([plane],[ride]),clear=fixture([],[baseline]);
    const contacts=step(world,.6);step(clear.world,.6);
    assert.equal(contacts.some(contact=>contact.other===plane),false,aircraftType+' leaves the visible route clear');
    assert.ok(near(ride.x,baseline.x)&&near(ride.y,baseline.y)&&near(ride.vx,baseline.vx),aircraftType+' has no invisible box pushing the car');
  }
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
  for(const aircraftType of Object.keys(Aircraft.AIRCRAFT_TYPES)) {
    const plane=craft({aircraftType,angle:.7,pitch:.32,roll:-.45,elevation:30}),{world}=fixture([plane]);
    const body=world.get(plane.id),initial=expectedPose(plane),model=Aircraft.getModel(plane);
    assert.ok(body.position.distanceTo(initial.position)<.000001);
    assert.ok(sameRotation(body.quaternion,initial.q));
    const parts=Physics.aircraftParts(plane);
    assert.ok(parts.length>1,'the collider follows separate airframe pieces');
    assert.equal(body.shapes.length,parts.length);
    for(let i=0;i<parts.length;i++) {
      samePart(body.shapes[i],parts[i]);
      assert.deepEqual([body.shapeOffsets[i].x,body.shapeOffsets[i].y,body.shapeOffsets[i].z],[parts[i].offset[0],parts[i].offset[1]-model.height/2,parts[i].offset[2]]);
    }
    Object.assign(plane,{x:plane.x+12,y:plane.y-6,elevation:31,angle:.8,pitch:.36,roll:-.4,vx:720,vy:-360,verticalVelocity:60});
    const target=expectedPose(plane);world.step(1/60);
    assert.equal(world.get(plane.id),body,'ordinary movement preserves proxy identity');
    assert.ok(body.position.distanceTo(target.position)<.000001,'Cannon finishes at the single aviation target pose');
    assert.ok(sameRotation(body.quaternion,target.q));
    const boxes=new Physics.RagdollWorld()._colliders({aircraft:[plane]});
    assert.equal(boxes.length,body.shapes.length);
    for(let i=0;i<boxes.length;i++) {
      const center=body.quaternion.vmult(body.shapeOffsets[i]).vadd(body.position),box=boxes[i];
      assert.ok(near(box.x,center.x)&&near(box.y,center.y)&&near(box.z,center.z),'each ragdoll piece shares the rotated Cannon centre');
      assert.deepEqual([box.hx,box.hy,box.hz],parts[i].half);
    }
    assert.deepEqual([plane.x,plane.y,plane.elevation],[1162,994,31],'Cannon does not advance aviation a second time');
    world.control(plane,{up:true});world.impulse(plane,{x:10,y:10,z:0});
    assert.equal(world.bodies.has(plane.id),false,'road commands and blasts cannot create duplicate aircraft bodies');
  }
});

test('aircraft shots, ceilings and rooftop support follow actual wing heights and empty corners',()=>{
  const plane=craft({aircraftType:'fighter',x:1200,y:1200,elevation:8});
  const roof={x:1060,y:1060,w:280,h:280,height:8,elevation:0};
  const {world}=fixture([plane],[],[roof]),wing={x:1140,y:1260},corner={x:1300,y:1260};
  const top=world.support(wing.x,wing.y,20),bottom=world.ceiling(wing.x,wing.y,8.1,12);
  assert.ok(top>9.5&&top<9.8,'the wing supports at its visible height rather than the tail fin height');
  assert.ok(bottom>9.3&&bottom<9.6,'an upward head sweep finds the elevated wing underside');
  assert.ok(near(world.support(wing.x,wing.y,8.05),8),'roof queries below the aircraft retain the building roof');
  assert.ok(near(world.support(corner.x,corner.y,20),8),'empty nose-side space retains the building roof');
  assert.equal(world.ceiling(corner.x,corner.y,8.1,14),Infinity,'the aircraft does not create an empty-corner ceiling');
  const from={x:1100,y:wing.y,height:9.5},to={x:1200,y:wing.y,height:9.5};
  const hit=world.firstHit(from,to);
  assert.ok(hit,'the visible wing intercepts shots');
  assert.equal(hit.body.entity,plane,'tool shots reference the aircraft entity');
  assert.equal(world.firstHit({...from,height:8.8},{...to,height:8.8}),null,'shots below the wing remain clear');
  assert.equal(world.firstHit({...from,height:13},{...to,height:13}),null,'shots over the airframe remain clear');
  assert.equal(world.firstHit({x:1290,y:corner.y,height:9.5},{x:1310,y:corner.y,height:9.5}),null,'shots through empty corners remain clear');
  assert.equal(world.firstHit(from,to,plane.id),null,'a pilot can exclude their own aircraft');
});

test('people collide with every aircraft fuselage only at the actual airframe height',()=>{
  for(const aircraftType of Object.keys(Aircraft.AIRCRAFT_TYPES)) {
    const plane=craft({aircraftType}),model=Aircraft.getModel(plane),person={x:plane.x,y:plane.y,elevation:0};
    assert.ok(personContact(person,plane,Physics.PLAYER_RADIUS,model),aircraftType+' has a solid fuselage');
    plane.elevation=8;
    assert.equal(personContact(person,plane,Physics.PLAYER_RADIUS,model),null,aircraftType+' flyover leaves ground walkers clear');
    assert.ok(personContact({...person,elevation:8},plane,Physics.PLAYER_RADIUS,model));
    assert.equal(height(plane),model.height);
  }
});

test('people can approach aircraft through empty corners and walk below high rotors',()=>{
  const clearPoints=[['fighter',5,3],['helicopter',0,3],['news',0,3],['policeheli',0,3],['transportheli',0,4]];
  for(const [aircraftType,x,z] of clearPoints)for(const angle of [0,.7,Math.PI/2]) {
    const plane=craft({aircraftType,angle}),c=Math.cos(angle),s=Math.sin(angle);
    const person={x:plane.x+(x*c-z*s)*20,y:plane.y+(x*s+z*c)*20,elevation:0};
    assert.equal(personContact(person,plane,Physics.PLAYER_RADIUS,Aircraft.getModel(plane)),null,aircraftType+' has no ground wall in empty space at yaw '+angle);
  }
  const plane=craft({aircraftType:'fighter'}),wing={x:plane.x-60,y:plane.y+60,elevation:0};
  assert.ok(personContact(wing,plane,Physics.PLAYER_RADIUS,Aircraft.getModel(plane)),'a low fighter wing still blocks a standing person');
  const heli=craft({aircraftType:'helicopter'}),rotor={x:heli.x,y:heli.y+60,elevation:2};
  assert.ok(personContact(rotor,heli,Physics.PLAYER_RADIUS,Aircraft.getModel(heli)),'the high rotor remains solid at its actual height');
});

test('ragdolls land on aircraft wings beyond old road vehicle dimension limits',()=>{
  const plane=craft({x:1000,y:1000}),model=Aircraft.getModel(plane),ragdolls=new Physics.RagdollWorld();
  const person={id:'wing-passenger',x:1000,y:1080,angle:0,elevation:model.height+2};
  assert.equal(ragdolls.trigger(person),true);
  const body=ragdolls.get(person.id);
  for(let frame=0;frame<150;frame++)ragdolls.step(1/120,{size:5600,aircraft:[plane]});
  assert.ok(body.joints.pelvis.y>2.5&&body.joints.pelvis.y<3.5,'the wide wing supports at its visible height below the tail fin');
  const lowest=Math.min(...Object.values(body.joints).map(joint=>joint.y-joint.radius));
  assert.ok(lowest>2.4&&lowest<2.5,'the ragdoll rests on the wing instead of the full-envelope top');
  for(const joint of Object.values(body.joints))assert.ok(joint.y>=2.425+joint.radius-.02,'each joint clears the visible wing top');
  assert.equal(ragdolls._colliders({aircraft:[{...plane,visible:false}]}).length,0,'hidden flights cannot leave ragdoll walls');
});

test('ragdolls below helicopter rotors fall through clear air onto the ground',()=>{
  const plane=craft({aircraftType:'helicopter',x:1000,y:1000}),ragdolls=new Physics.RagdollWorld();
  const person={id:'below-rotor',x:1000,y:1060,angle:0,elevation:1.4};
  assert.equal(ragdolls.trigger(person),true);
  const body=ragdolls.get(person.id);
  for(let frame=0;frame<180;frame++)ragdolls.step(1/120,{size:5600,aircraft:[plane]});
  assert.ok(body.joints.pelvis.y<1,'the rotor does not create an invisible raised platform underneath it');
  assert.ok(Math.abs(body.joints.pelvis.z-person.y/20)<1,'the empty footprint does not push the ragdoll sideways');
});

test('aircraft proxy lifecycle preserves active bodies through town rebuilds and cleans up hidden flights',()=>{
  const plane=craft(),{game,world}=fixture([plane]),body=world.get(plane.id);
  game.buildings=[];game.staticObjects=[];world.sync();
  assert.equal(world.get(plane.id),body);assert.ok(world.world.bodies.includes(body));
  plane.aircraftType='transportheli';world.sync();
  assert.equal(world.get(plane.id),body,'a model change updates the existing proxy');
  const parts=Physics.aircraftParts(plane);
  assert.ok(parts.length>1);assert.equal(body.shapes.length,parts.length);
  for(let i=0;i<parts.length;i++)samePart(body.shapes[i],parts[i]);
  plane.visible=false;world.sync();
  assert.equal(world.get(plane.id),null);assert.equal(world.world.bodies.includes(body),false);
  plane.visible=true;world.sync();
  const returned=world.get(plane.id);assert.ok(returned);
  game.aircraft=[];world.sync();
  assert.equal(world.get(plane.id),null);assert.equal(world.world.bodies.includes(returned),false);assert.equal(world.aircraftBodies.size,0);
});
