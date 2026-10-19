'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SoldierSystem,MAX_SOLDIERS,ROUND_SPEED,MUZZLE_HEIGHT}=require('../soldiers.js');
const Physics=require('../physics.js');
const advance=(system,seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)system.step(1/60);};
function fixture(count=1){
  const peds=Array.from({length:count},(_,i)=>({id:'ped-'+i,district:'military',x:0,y:i*40,elevation:0,angle:0,homeX:0,homeY:i*40,pace:24,stunned:0,pathId:'guard-path',pathIndex:1,pathDirection:1}));
  const game={peds,cars:[],police:[],aircraft:[],heat:0,graceTimer:0,buildings:[],staticObjects:[],pedPaths:[{id:'guard-path',points:[{x:0,y:0},{x:0,y:180}]}],
    player:{id:'player',x:300,y:0,elevation:0,composure:100,vehicleId:null},ragdolls:new Map(),_reportedLocation:{x:300,y:0},
    world:{bounds:{minX:-2000,minY:-2000,maxX:2000,maxY:2000},militaryBase:{bounds:{x:-1500,y:-1500,w:3000,h:3000},gate:{x:1000,y:0},runways:[],taxiways:[],aprons:[]},terrain:{isWater:()=>false,surfaceHeight:()=>0}},
    _ground:()=>0,_blockedLine:()=>false,_sound:()=>{},_confetti:()=>{},moveCalls:[],damage:[],caught:0,
    _move(person,dx,dy,radius){this.moveCalls.push(radius);person.x+=dx;person.y+=dy;return false;},
    _damageVehicle(entity,amount,metadata){entity.health-=amount;this.damage.push({amount,metadata});},_caught(){this.caught++;this.heat=0;},
    vehiclePhysics:{firstHit:()=>null},railTraffic:{pedestrianBlocked:()=>false}};
  Object.defineProperty(game,'current',{get:()=>game.cars.find(c=>c.id===game.player.vehicleId)||game.player});
  return {game,system:new SoldierSystem(game),guard:peds[0]};
}

test('the original base personnel become six soldiers without changing their identity or population',()=>{
  const {game,system}=fixture(6),before=game.peds.map(p=>({id:p.id,x:p.x,y:p.y}));
  assert.equal(system.soldiers.length,6);assert.strictEqual(game.soldiers,system.soldiers);assert.strictEqual(game.soldierRounds,system.rounds);
  assert.deepEqual(game.peds.map(p=>({id:p.id,x:p.x,y:p.y})),before);
  assert.ok(game.peds.every(p=>p.soldier&&p.militaryUnit&&p.baseId==='military'&&p.role==='guard'));
});

test('peaceful guards physically patrol their original paths and do not raise heat or fire',()=>{
  const {game,system,guard}=fixture();advance(system,3);
  assert.ok(guard.y>60&&guard.y<85);assert.equal(game.heat,0);assert.equal(system.rounds.length,0);assert.equal(guard.soldierPhase,'patrol');
  assert.ok(game.moveCalls.length>100);assert.ok(game.moveCalls.every(radius=>radius===Physics.NPC_RADIUS));
  game.heat=3;advance(system,3);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
});

test('bounded navigation walks around a real footprint instead of through it',()=>{
  const {game,system,guard}=fixture();game.pedPaths=[];game.buildings=[{x:80,y:-55,w:90,h:110,height:4}];
  let wentAround=false;for(let i=0;i<600;i++){system._walk(guard,{x:260,y:0},45,1/60);if(Math.abs(guard.y)>60)wentAround=true;
    assert.equal(guard.x>80-Physics.NPC_RADIUS&&guard.x<170+Physics.NPC_RADIUS&&Math.abs(guard.y)<55+Physics.NPC_RADIUS,false);
  }
  assert.ok(wentAround);assert.ok(Math.hypot(guard.x-260,guard.y)<12);assert.ok(system.events.every(e=>!e.nodes||e.nodes<=901));
});

test('soldiers refuse water, excessive grades, airfield movement areas and closed rail crossings',()=>{
  const {game,system,guard}=fixture();game.world.terrain.isWater=()=>true;game.world.terrain.waterLevel=0;assert.equal(system._pointClear({x:10,y:0}),false);
  game.world.terrain.isWater=()=>false;game._ground=p=>p.x>2?4:0;assert.equal(system._pointClear({x:0,y:0}),false);
  game._ground=()=>0;system.movementAreas.push({x:40,y:-40,w:120,h:80});assert.equal(system._pointClear({x:100,y:0}),false);
  system.movementAreas.length=0;game.railTraffic.pedestrianBlocked=()=>true;system._walk(guard,{x:40,y:0},40,.1);assert.equal(guard.x,0);assert.equal(game.moveCalls.length,0);
});

test('legacy apron personnel leave physically through the nearest safe edge before patrolling',()=>{
  const {game,system,guard}=fixture(),apron={x:-100,y:-100,w:200,h:200};system.movementAreas.push(apron);guard.egressArea=apron;
  const start={x:guard.x,y:guard.y};advance(system,5);assert.equal(guard.egressArea,null);assert.ok(Math.hypot(guard.x-start.x,guard.y-start.y)>110);
  assert.ok(game.moveCalls.length>100);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
});

test('four-star soldiers acquire only visible local ground targets, turn their weapon and fire finite bursts',()=>{
  const {game,system,guard}=fixture();guard.aimAngle=Math.PI;game.heat=4;advance(system,.4);
  assert.equal(system.events.filter(e=>e.type==='fire').length,0);assert.ok(guard.aimAngle<Math.PI&&guard.aimAngle>1.9);
  advance(system,4);const shots=system.events.filter(e=>e.type==='fire');assert.ok(shots.length>=3&&shots.length<=6);assert.ok(shots[3]?.time-shots[2]?.time>2);
  assert.ok(game.player.composure<100);assert.equal(game.militarySoldierSeen,true);assert.equal(guard.soldierPhase,'engage');
  assert.ok(system.rounds.every(r=>Math.hypot(r.vx,r.vy)<=ROUND_SPEED+.01));
});

test('search follows the last actual sighting and does not track a concealed player',()=>{
  const {game,system,guard}=fixture();game.heat=4;advance(system,.1);const last={...guard.lastKnown};
  game._blockedLine=()=>true;game.player.x=700;game.player.y=700;advance(system,3);
  assert.deepEqual(guard.lastKnown,last);assert.equal(game.militarySoldierSeen,false);assert.equal(guard.soldierPhase,'search');
  const shots=system.events.filter(e=>e.type==='fire').length;advance(system,3);assert.equal(system.events.filter(e=>e.type==='fire').length,shots);
  advance(system,24);assert.equal(guard.lastKnown,null);assert.equal(guard.soldierPhase,'patrol');
});

test('a confirmed base attack calls guards to its reported point but covered and airborne targets cannot be fired at',()=>{
  const {game,system,guard}=fixture();assert.equal(system.reportBaseAttack({playerCaused:false}),false);assert.equal(game.heat,0);
  system.reportBaseAttack({playerCaused:true,position:{x:500,y:80}});assert.equal(game.heat,4);assert.deepEqual(guard.lastKnown,{x:500,y:80});
  game._blockedLine=()=>true;advance(system,3);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
  game._blockedLine=()=>false;const craft={id:'flying',kind:'aircraft',x:300,y:0,elevation:50,health:100,grounded:false};game.cars=[craft];game.player.vehicleId=craft.id;
  advance(system,3);assert.equal(system.events.filter(e=>e.type==='fire').length,0);assert.equal(game.militarySoldierSeen,false);
});

test('the nearest solid vehicle or person absorbs a swept round, including friendly soldiers',()=>{
  const {game,system,guard}=fixture(2);game.heat=4;const friendly=system.soldiers[1];friendly.x=150;friendly.y=0;friendly.stunned=100;
  system.rounds.push({ownerId:guard.id,x:0,y:0,height:1,vx:ROUND_SPEED,vy:0,vh:0,life:1,damage:2.4});advance(system,.2);
  assert.equal(game.player.composure,100);assert.equal(system.rounds.length,0);assert.equal(game.player.lastIncomingFireAt,undefined);
  friendly.y=100;const car={id:'cover',kind:'van',x:140,y:0,elevation:0,health:100};game.cars=[car];
  game.vehiclePhysics.firstHit=(a,b)=>a.x<=120&&b.x>=120?{x:120,y:0,height:1,body:{entity:car}}:null;
  system.rounds.push({ownerId:guard.id,x:0,y:0,height:1,vx:ROUND_SPEED,vy:0,vh:0,life:1,damage:2.4});advance(system,.2);
  assert.equal(game.player.composure,100);assert.equal(car.health,100);assert.equal(game.damage.length,0,'NPC fire does not damage military or civilian cover');
});

test('terrain absorbs rounds before a more distant vehicle hit',()=>{
  const {game,system,guard}=fixture();game.heat=4;const target={id:'target-car',kind:'van',x:300,y:0,elevation:0,health:100};game.cars.push(target);game.player.vehicleId=target.id;
  game._ground=p=>p.x>=65&&p.x<90?2:0;game.vehiclePhysics.firstHit=(a,b)=>a.x<=100&&b.x>=100?{x:100,y:0,height:1,body:{entity:target}}:null;
  system.rounds.push({ownerId:guard.id,x:60,y:0,height:1,vx:ROUND_SPEED,vy:0,vh:0,life:1,damage:2.4});system.step(1/60);
  assert.equal(target.health,100);assert.equal(system.rounds.length,0);assert.equal(game.player.lastIncomingFireAt,undefined);
});

test('NPC hits carry no player attribution, share a damage cap, respect grace and can catch the player',()=>{
  const {game,system,guard}=fixture();game.heat=4;
  const inject=()=>{for(let i=0;i<20;i++)system.rounds.push({ownerId:guard.id,x:290,y:0,height:1,vx:ROUND_SPEED,vy:0,vh:0,life:1,damage:2.4});};
  game.time=123;inject();system.step(1/60);assert.ok(game.player.composure>=89.999);assert.ok(game.player.composure<100);assert.equal(game.player.lastIncomingFireAt,123);
  game.graceTimer=2;game.time=124;const composure=game.player.composure;inject();system.step(1/60);assert.equal(game.player.composure,composure);assert.equal(game.player.lastIncomingFireAt,123);
  game.graceTimer=0;const car={id:'driven',kind:'compact',x:300,y:0,elevation:0,health:100};game.cars=[car];game.player.vehicleId=car.id;
  game.vehiclePhysics.firstHit=(a,b)=>({x:300,y:0,height:1,body:{entity:car}});system._damageCredit=10;inject();system.step(1/60);
  assert.ok(car.health<100);assert.ok(game.damage.every(hit=>hit.metadata.playerCaused===false&&hit.metadata.source==='soldier-round'));
  assert.equal(game.player.lastIncomingFireAt,123,'vehicle hits do not suppress on-foot recovery');
  game.player.vehicleId=null;game.cars=[];game.vehiclePhysics.firstHit=()=>null;game.player.composure=1;system._damageCredit=10;inject();system.step(1/60);assert.equal(game.caught,1);
});

test('stunned, ragdolled, removed and transported soldiers cannot move or fire',()=>{
  const {game,system,guard}=fixture();game.heat=4;guard.stunned=10;advance(system,1);assert.equal(game.moveCalls.length,0);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
  guard.stunned=0;game.ragdolls.set(guard.id,{});advance(system,1);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
  game.ragdolls.delete(guard.id);guard.transportedBy='truck';advance(system,1);assert.equal(guard.soldierPhase,'riding');assert.equal(system.events.filter(e=>e.type==='fire').length,0);
  game.peds=[];advance(system,.1);assert.equal(system.soldiers.length,0);assert.strictEqual(game.soldiers,system.soldiers);assert.equal(game.militarySoldierSeen,false);
});

test('rifle impacts still delay recovery when the shared damage budget is exhausted',()=>{
  const {game,system,guard}=fixture();game.heat=4;game.time=12;game.player.composure=50;system._damageCredit=0;
  system.rounds.push({ownerId:guard.id,x:290,y:0,height:1,vx:ROUND_SPEED,vy:0,vh:0,life:1,damage:2.4});
  system._rounds(1/60);
  assert.equal(game.player.composure,50);assert.equal(game.player.lastIncomingFireAt,12);
  assert.equal(system.rounds.length,0);
});

test('squads have bounded population, safe physical exits and boarding, and retire only offscreen',()=>{
  const {game,system}=fixture(6),truck={id:'transport',kind:'van',x:400,y:300,elevation:0,speed:0,upright:true};game.cars=[truck];
  const squad=system.createSquad({id:'squad',truckId:truck.id,position:truck,count:4});assert.equal(squad.length,4);assert.ok(squad.every(s=>s.transportedBy===truck.id));
  const second=system.createSquad({truckId:'other',position:truck,count:4});assert.equal(second.length,4);assert.equal(system.soldiers.length,MAX_SOLDIERS);assert.equal(system.createSquad({truckId:'overflow',position:truck}).length,0);
  game.buildings.push({x:440,y:270,w:30,h:60});assert.equal(system.disembark(squad[0],{x:450,y:300}),false);
  truck.speed=20;assert.equal(system.disembark(squad[0],{x:400,y:350}),false);truck.speed=0;
  assert.equal(system.disembark(squad[0],{x:400,y:350}),true);assert.equal(squad[0].transportedBy,null);
  assert.equal(system.disembark(squad[1],{x:400,y:350}),false,'soldiers cannot overlap while leaving');
  truck.upright=false;assert.equal(system.disembark(squad[1],{x:400,y:250}),false);assert.equal(system.disembark(squad[1],{x:450,y:300},{emergency:true}),false);
  truck.verticalVelocity=2;assert.equal(system.disembark(squad[1],{x:400,y:250},{emergency:true}),false);truck.verticalVelocity=0;
  assert.equal(system.disembark(squad[1],{x:400,y:250},{emergency:true}),true,'a settled tipped truck permits only a physically clear emergency exit');truck.upright=true;
  squad[0].x=900;assert.equal(system.embark(squad[0],truck),false);squad[0].x=400;squad[0].y=350;assert.equal(system.embark(squad[0],truck),true);
  assert.equal(system.retireSquad(truck.id),false);game.player.x=-1500;game.player.y=-1500;assert.equal(system.retireSquad(truck.id),true);assert.equal(system.soldiers.length,10);
});

test('clearing heat stops guns immediately, removes live rounds and returns guards to duty',()=>{
  const {game,system,guard}=fixture();game.heat=4;advance(system,1.1);assert.ok(guard.lastKnown);
  const squad=system.createSquad({truckId:'remote-truck',position:{x:100,y:500}});system.disembark(squad[0],{x:100,y:550});
  game.heat=0;system.clearHeat();assert.equal(system.rounds.length,0);assert.equal(guard.lastKnown,null);assert.equal(guard.soldierPhase,'patrol');assert.equal(squad[0].soldierPhase,'return');
  const shots=system.events.filter(e=>e.type==='fire').length;advance(system,2);assert.equal(system.events.filter(e=>e.type==='fire').length,shots);assert.equal(game.militarySoldierSeen,false);
  assert.equal(MUZZLE_HEIGHT,1);
});

test('returning soldiers must physically reach a clear door and cannot board through a thin wall',()=>{
  const {game,system}=fixture(0),truck={id:'transport',kind:'van',x:400,y:300,elevation:0,speed:0,upright:true};game.cars=[truck];
  const [soldier]=system.createSquad({truckId:truck.id,position:truck,count:1});assert.equal(system.disembark(soldier,{x:400,y:350}),true);
  soldier.x=400;soldier.y=380;soldier.returnPoint={x:400,y:347};assert.equal(system.embark(soldier,truck),false,'being close to the truck is insufficient before reaching its door');
  soldier.y=369;game.buildings.push({x:380,y:357,w:40,h:2});assert.equal(system.embark(soldier,truck),false,'a two-unit wall blocks the short walk to the door');
  game.buildings=[];let ignored=null;game.vehiclePhysics.firstHit=(a,b,id)=>{ignored=id;return {x:400,y:358,height:.45,source:{kind:'fence'}};};assert.equal(system.embark(soldier,truck),false);assert.equal(ignored,truck.id,'the exact low ray ignores the carrier hull');
  game.vehiclePhysics.firstHit=()=>null;game.peds.push({id:'door-blocker',x:400,y:347,elevation:0});assert.equal(system.embark(soldier,truck),false,'another standing person occupies the door');game.peds.pop();
  truck.elevation=4;assert.equal(system.embark(soldier,truck),false,'a vehicle launched above the door cannot be boarded from below');truck.elevation=0;
  truck.verticalVelocity=2;assert.equal(system.embark(soldier,truck),false);truck.verticalVelocity=0;
  assert.equal(system.embark(soldier,truck),true);
});

test('unreachable local goals back off, retry after the interval and react immediately to a changed goal',()=>{
  const {game,system,guard}=fixture();game.pedPaths=[];game.buildings=[{x:15,y:-800,w:100,h:1600}];
  const route=system._route.bind(system);let calls=0;system._route=(...args)=>{calls++;return route(...args);};
  const walk=(seconds,goal)=>{for(let i=0;i<Math.ceil(seconds*60);i++){system.time+=1/60;system._walk(guard,goal,40,1/60);}};
  walk(1,{x:80,y:0});assert.equal(calls,1);assert.equal(guard.nav.length,0);assert.equal(guard.x,0);
  walk(.6,{x:80,y:0});assert.equal(calls,2,'an unreachable goal is retried after the 1.5-second interval');
  walk(1/60,{x:-100,y:0});assert.equal(calls,3,'a different destination does not wait for the old backoff');assert.ok(guard.x<0);
  walk(1/60,{x:80,y:0});assert.equal(calls,4);game.buildings=[];
  walk(1,{x:80,y:0});assert.equal(calls,4);walk(.7,{x:80,y:0});assert.equal(calls,5);assert.ok(guard.x>0,'the next scheduled retry discovers that the obstacle was removed');
});

test('a persistent physical collision gets one immediate replan followed by a bounded wait',()=>{
  const {game,system,guard}=fixture();let calls=0;const route=system._route.bind(system);system._route=(...args)=>{calls++;return route(...args);};game._move=()=>true;
  for(let i=0;i<60;i++){system.time+=1/60;system._walk(guard,{x:100,y:0},40,1/60);}
  assert.equal(calls,2);assert.equal(guard.x,0);
});
