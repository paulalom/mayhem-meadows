'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const World=require('../world.js');
const Cannon=require('../vendor/cannon.cjs');
const Stats=require('../vehicle-stats.js');
const {VehicleWorld}=require('../vehicle-physics.js');
const {TransportSystem,SEATS}=require('../military-transport.js');
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function fixture(){
  const nodes=[{id:'west',x:2600,y:-930},{id:'inner',x:6025,y:-930},{id:'gate',x:6025,y:-750},{id:'outside',x:6025,y:-300},{id:'town',x:6025,y:1800}];
  const road=(id,a,b,width=110)=>({id,a,b,width,points:[nodes.find(n=>n.id===a),nodes.find(n=>n.id===b)]});
  const roads=[road('base-compound-road','west','inner'),road('base-entry-road','inner','gate'),road('base-gate-road','gate','outside'),road('base-access-north','outside','town')];
  const commands=[],toasts=[],soldiers=[],unloads=[],retired=[];
  let exitAllowed=true;
  const game={world:{roads,roadNetwork:new World.RoadNetwork(roads,nodes),militaryBase:{gate:{x:6025,y:-750}},terrain:{surfaceHeight:()=>14,isWater:()=>false}},
    player:{id:'player',x:6025,y:1500,elevation:14,vehicleId:null},heat:0,cars:[],police:[],aircraft:[],peds:[],buildings:[],staticObjects:[],_reportedLocation:{x:6025,y:1500},
    _ground:()=>14,_blockedLine:()=>false,_toast:text=>toasts.push(text),vehiclePhysics:{control:(entity,command)=>commands.push({entity,...command})},
    railTraffic:{colliders:[],roadSpeedLimit:(entity,heading,speed)=>speed}};
  Object.defineProperty(game,'current',{get:()=>game.cars.find(c=>c.id===game.player.vehicleId)||game.player});
  game.soldierTraffic={soldiers,
    createSquad:({id,truckId,position,count})=>Array.from({length:count},(_,i)=>{const soldier={id:id+'-'+i,soldier:true,role:'response',squadId:id,truckId,transportedBy:truckId,soldierPhase:'riding',x:position.x,y:position.y};soldiers.push(soldier);game.peds.push(soldier);return soldier;}),
    disembark:(soldier,point)=>{if(!exitAllowed||soldiers.some(s=>s!==soldier&&!s.transportedBy&&dist(s,point)<20))return false;Object.assign(soldier,point,{transportedBy:null,soldierPhase:'advance'});unloads.push({soldier,point});return true;},
    embark:(soldier,truck)=>{if(dist(soldier,truck)>=100||Math.abs(truck.speed)>=8||soldier.stunned>0)return false;soldier.transportedBy=truck.id;soldier.soldierPhase='riding';return true;},
    retireSquad:truckId=>{retired.push(truckId);const crew=soldiers.filter(s=>s.truckId===truckId);if(crew.some(s=>dist(s,game.current)<1100))return false;for(const soldier of crew){soldiers.splice(soldiers.indexOf(soldier),1);game.peds.splice(game.peds.indexOf(soldier),1);}return true;}};
  const system=new TransportSystem(game);
  return {game,system,commands,toasts,soldiers,unloads,retired,setExitAllowed:value=>{exitAllowed=value;}};
}
function advance(system,seconds){for(let i=0;i<Math.ceil(seconds*60);i++)system.step(1/60);}

test('four stars announce a six-second truck response with four new soldiers, without draining base guards',()=>{
  const f=fixture();f.game.peds.push({id:'base-sentry',soldier:true,role:'guard',x:3000,y:-1200});
  f.game.heat=3;advance(f.system,20);assert.equal(f.system.trucks.length,0);assert.equal(f.toasts.length,0);
  f.game.heat=4;advance(f.system,.1);assert.equal(f.system.status.phase,'mobilising');assert.ok(f.system.warning>5.8);assert.match(f.toasts[0],/6 seconds/);
  advance(f.system,5.8);assert.equal(f.system.trucks.length,0);advance(f.system,.2);
  const truck=f.system.trucks[0];assert.ok(truck);assert.equal(truck.kind,'truck');assert.equal(truck.health,240);assert.equal(f.game.cars.includes(truck),true);
  assert.equal(f.soldiers.length,4);assert.equal(f.game.peds.length,5);assert.ok(f.soldiers.every(s=>s.transportedBy===truck.id));
  advance(f.system,20);assert.equal(f.system.events.filter(e=>e.type==='dispatch').length,1);
});

test('base alarms mobilize at once, while lower heat or garage service cancels the pending dispatch',()=>{
  const f=fixture();assert.equal(f.system.reportBaseAttack({playerCaused:false}),false);assert.equal(f.game.heat,0);
  assert.equal(f.system.reportBaseAttack({playerCaused:true,position:{x:6000,y:-800}}),true);assert.equal(f.game.heat,4);
  advance(f.system,6.1);assert.equal(f.system.trucks.length,1);assert.deepEqual(f.system.trucks[0].incident,{x:6000,y:-800});
  const cancelled=fixture();cancelled.game.heat=4;advance(cancelled.system,3);cancelled.game.heat=0;cancelled.system.clearHeat();advance(cancelled.system,8);
  assert.equal(cancelled.system.trucks.length,0);assert.equal(cancelled.system.warning,0);assert.equal(cancelled.system.alarmTime,0);
});

test('dispatch uses an unobstructed physical base checkpoint and never creates a truck beside the player',()=>{
  const f=fixture();f.game.player.x=3900;f.game.player.y=-930;assert.equal(f.system._dispatch(),null);
  f.game.player.x=6025;f.game.player.y=1500;f.game.buildings.push({x:3500,y:-1100,w:1000,h:340,height:8});assert.equal(f.system._dispatch(),null);
  f.game.buildings=[];const truck=f.system._dispatch();assert.ok(truck);assert.equal(truck.x,3900);assert.ok(dist(truck,f.game.player)>700);
  f.system.base=null;f.system.clearHeat();f.game.heat=4;f.system.trucks.length=0;f.game.cars.length=0;advance(f.system,20);assert.equal(f.system.trucks.length,0);
});

test('validated actual roads connect Northwatch to the city without routing across an airstrip or garden',()=>{
  const world=World.createWorld(42),game={world,cars:[],peds:[],player:{x:6000,y:3950},buildings:world.buildings,staticObjects:world.staticObjects,_ground:p=>world.terrain.surfaceHeight(p.x,p.y)};
  const system=new TransportSystem(game),truck=system._dispatch();assert.ok(truck);assert.ok(system.roads.length>70);
  system._route(truck,{x:6000,y:3950});assert.ok(truck.route.length>250);assert.ok(truck.route.some(p=>p.roadId==='north-spine'));
  assert.ok(truck.route.every(p=>system.roadIds.has(p.roadId)&&p.width>=90));assert.ok(truck.route.every(p=>!/runway|taxiway|apron/i.test(p.roadId)));
});

test('hidden movement never replaces the radio report and a real driver sighting updates it',()=>{
  const f=fixture(),truck=f.system._dispatch();f.game.heat=4;f.game._blockedLine=()=>true;
  const incident={...truck.incident};f.game.player.x=8000;f.game.player.y=5000;advance(f.system,8);
  assert.deepEqual(truck.incident,incident);assert.deepEqual(truck.destination,incident);assert.equal(truck.lastSeen,null);assert.equal(f.game.militaryTransportSeen,false);
  f.game._blockedLine=()=>false;Object.assign(f.game.player,{x:truck.x+800,y:truck.y});advance(f.system,.1);
  assert.equal(f.game.militaryTransportSeen,true);assert.deepEqual(truck.lastSeen,{x:f.game.player.x,y:f.game.player.y,elevation:14});assert.deepEqual(f.game._reportedLocation,truck.lastSeen);
});

test('a four-star dispatch without a stored report snapshots the current incident once',()=>{
  const f=fixture();delete f.game._reportedLocation;f.game.heat=4;f.game._blockedLine=()=>true;
  const initial={...f.game.current};advance(f.system,6.1);const truck=f.system.trucks[0];assert.ok(truck);
  assert.deepEqual(truck.incident,initial,'direct or story heat still gives the carrier a useful initial destination');
  f.game.player.x=9000;f.game.player.y=6000;advance(f.system,4);
  assert.deepEqual(truck.incident,initial);assert.deepEqual(truck.destination,{x:initial.x,y:initial.y});assert.equal(truck.lastSeen,null);
});

test('the driver cannot see through actual fences, vehicles or a ridge and ignores its own cab',()=>{
  const f=fixture(),truck=f.system._dispatch();Object.assign(f.game.player,{x:truck.x+800,y:truck.y});let ignored=null;
  f.game.vehiclePhysics.firstHit=(a,b,id)=>{ignored=id;return {source:{id:'base-fence'}};};assert.equal(f.system._seen(truck,f.game.player),false);assert.equal(ignored,truck.id);
  f.game.vehiclePhysics.firstHit=()=>({body:{entity:{id:'parked-van'}}});assert.equal(f.system._seen(truck,f.game.player),false);
  f.game.vehiclePhysics.firstHit=()=>({body:{entity:f.game.player}});assert.equal(f.system._seen(truck,f.game.player),true);
  f.game.vehiclePhysics.firstHit=()=>null;f.game._ground=p=>p.x>truck.x+300&&p.x<truck.x+400?25:14;assert.equal(f.system._seen(truck,f.game.player),false);
  f.game._ground=()=>14;assert.equal(f.system._seen(truck,f.game.player),true);f.game.graceTimer=2;assert.equal(f.system._seen(truck,f.game.player),false);
});

test('parked aircraft clearance uses the complete airframe rather than a compact car footprint',()=>{
  const f=fixture(),point={x:3900,y:-930,angle:0};f.game.aircraft.push({id:'parked-trainer',kind:'aircraft',aircraftType:'trainer',x:3900,y:-860,elevation:14,angle:0});
  assert.ok(f.system._model(f.game.aircraft[0]).width>100);assert.equal(f.system._clear(point,false),false);
  f.game.aircraft[0].elevation=80;assert.equal(f.system._clear(point,false),true);
});

test('carriers stop for physical traffic and railway events, but roll through a sharp wheeled turn',()=>{
  const f=fixture(),truck=f.system._dispatch();f.game.heat=4;
  f.game.railTraffic.roadSpeedLimit=()=>0;f.system._duty(truck,1/60);assert.equal(f.commands.at(-1).targetSpeed,0);
  f.game.railTraffic.roadSpeedLimit=(entity,heading,speed)=>speed;f.game.cars.push({id:'stopped-van',kind:'van',x:truck.x+100,y:truck.y,elevation:14});
  f.system._duty(truck,1/60);assert.equal(f.commands.at(-1).targetSpeed,0);f.game.cars.pop();
  truck.route=[{x:truck.x,y:truck.y+35,angle:Math.PI/2},{x:truck.x,y:truck.y+150,angle:Math.PI/2}];truck.routeTimer=4;truck.destination={...truck.incident};
  f.system._duty(truck,1/60);assert.ok(f.commands.at(-1).targetSpeed>0);assert.ok(f.commands.at(-1).heading>1.3);assert.equal(f.commands.at(-1).brake,false);
  truck.y+=200;f.system._duty(truck,1/60);assert.equal(f.commands.at(-1).targetSpeed,0);assert.equal(f.system.status.phase,'blocked');
});

test('the real ridge hairpin uses a clear physical three-point turn and reverse still obeys crossings',()=>{
  const world=World.createWorld(42),commands=[],game={world,cars:[],peds:[],heat:4,player:{x:5550,y:1150,elevation:5.68},_reportedLocation:{x:5550,y:1150},
    buildings:world.buildings,staticObjects:world.staticObjects,_ground:p=>world.terrain.surfaceHeight(p.x,p.y),vehiclePhysics:{control:(entity,command)=>commands.push(command)},
    railTraffic:{roadSpeedLimit:(entity,heading,speed)=>speed}};
  const system=new TransportSystem(game),truck=system._dispatch();Object.assign(truck,{x:6619.6,y:-458.41,angle:.7527,elevation:world.terrain.surfaceHeight(6619.6,-458.41),speed:0});
  system._duty(truck,1/60);assert.ok(truck.turnManeuver);assert.equal(commands.at(-1).targetSpeed,-30);assert.ok(commands.at(-1).heading<truck.angle);
  game.railTraffic.roadSpeedLimit=()=>0;system._duty(truck,1/60);assert.equal(commands.at(-1).targetSpeed,0);assert.equal(commands.at(-1).brake,true);
  system.clearHeat();assert.equal(truck.turnManeuver,null,'standing down cancels the old incident maneuver');
});

test('a real wheeled carrier reverses direction on a narrow road with rolling shifts and no departure or pivot',()=>{
  const nodes=[{id:'a',x:500,y:1000},{id:'b',x:5000,y:1000}],roads=[{id:'base-compound-road',a:'a',b:'b',width:110,points:nodes}];
  const game={world:{roads,roadNetwork:new World.RoadNetwork(roads,nodes),militaryBase:{gate:{x:3900,y:1000}}},worldSize:5600,cars:[],police:[],peds:[],buildings:[],staticObjects:[],player:{x:4500,y:3500},_ground:()=>0,heat:0};
  const system=new TransportSystem(game),truck=system._dispatch();Object.assign(truck,{x:2500,y:1000,angle:0,elevation:0,home:{x:2000,y:1000,angle:0},truckPhase:'return'});
  game.vehiclePhysics=new VehicleWorld(game,Stats.CAR_TYPES);let previous={x:truck.x,y:truck.y,angle:truck.angle},travelled=0;
  for(let tick=0;tick<60*60&&truck.truckPhase!=='parked';tick++){
    system.step(1/60);game.vehiclePhysics.step(1/60);const moved=dist(truck,previous);travelled+=moved;
    assert.ok(moved<5);assert.ok(system.network.nearestRoad(truck).distance<65);
    if(Math.abs(truck.speed)<.1)assert.ok(Math.abs(Math.atan2(Math.sin(truck.angle-previous.angle),Math.cos(truck.angle-previous.angle)))<.01,'stopped wheels do not pivot the chassis');
    previous={x:truck.x,y:truck.y,angle:truck.angle};
  }
  assert.equal(truck.truckPhase,'parked');assert.ok(dist(truck,truck.home)<90);assert.ok(travelled>500);assert.ok(system.events.filter(event=>event.type==='turn-shift').length>=2);
  assert.equal(truck.health,240);assert.ok(truck.grounded&&truck.upright);
});

test('safe disembarkation waits for the stopped chassis, serializes doors and queues a blocked crew',()=>{
  const f=fixture(),truck=f.system._dispatch();f.game.heat=4;Object.assign(truck,{x:6025,y:1100,speed:20});
  f.system._duty(truck,1/60);assert.equal(f.unloads.length,0);assert.equal(f.commands.at(-1).targetSpeed,0);
  truck.speed=0;f.setExitAllowed(false);f.system._duty(truck,1/60);assert.equal(truck.truckPhase,'deployed');assert.equal(f.unloads.length,0);advance(f.system,1);assert.equal(f.unloads.length,0);
  f.setExitAllowed(true);advance(f.system,.1);assert.equal(f.unloads.length,1);advance(f.system,.2);assert.equal(f.unloads.length,1);advance(f.system,1.4);assert.equal(f.unloads.length,4);
  assert.equal(f.soldiers.filter(s=>s.transportedBy).length,0);assert.ok(f.unloads.every(exit=>dist(exit.point,truck)>=47));
  for(let i=0;i<f.unloads.length;i++)for(let j=0;j<i;j++)assert.ok(dist(f.unloads[i].point,f.unloads[j].point)>=20);
});

test('bench seats retain each rider index and follow a pitched, rolled physical truck pose',()=>{
  const f=fixture(),truck=f.system._dispatch();truck.orientation=new Cannon.Quaternion().setFromEuler(.2,-.6,.12);
  const first=f.soldiers[0],second=f.soldiers[1],v=new Cannon.Vec3(SEATS[1][0]/20,.52-1.4,SEATS[1][1]/20),expected=truck.orientation.vmult(v);
  f.system.syncPassengers();const before={x:second.x,y:second.y,elevation:second.elevation};first.transportedBy=null;f.system.syncPassengers();
  assert.equal(second.x,before.x);assert.equal(second.y,before.y);assert.ok(Math.abs(second.x-(truck.x+expected.x*20))<1e-8);
  assert.ok(Math.abs(second.y-(truck.y+expected.z*20))<1e-8);assert.ok(Math.abs(second.elevation-(truck.elevation+1.4+expected.y))<1e-8);assert.equal(second.grounded,false);
});

test('returning soldiers physically reboard a stopped carrier before it drives home',()=>{
  const f=fixture(),truck=f.system._dispatch();Object.assign(truck,{x:6025,y:1000,truckPhase:'deployed',deployed:true});
  for(const soldier of f.soldiers){soldier.transportedBy=null;soldier.x=truck.x-80;soldier.y=truck.y;}
  f.soldiers[0].stunned=5;f.game.heat=0;f.system.clearHeat();assert.equal(truck.truckPhase,'reboard');f.system._duty(truck,1/60);
  assert.equal(f.commands.at(-1).targetSpeed,0);assert.equal(truck.truckPhase,'reboard');assert.equal(f.soldiers.filter(s=>s.transportedBy).length,3);
  f.soldiers[0].stunned=0;f.system._duty(truck,1/60);assert.equal(truck.truckPhase,'return');f.system._duty(truck,1/60);assert.ok(Math.abs(f.commands.at(-1).targetSpeed)>0);
  Object.assign(truck,truck.home,{speed:0});f.system._duty(truck,1/60);assert.equal(truck.troopAI,false);assert.equal(truck.truckPhase,'parked');
  truck.health=180;const reused=f.system._dispatch();assert.equal(reused,truck);assert.equal(truck.health,180);assert.equal(f.soldiers.length,4);
});

test('commandeering preserves the body and never applies AI controls to the player truck',()=>{
  const f=fixture(),truck=f.system._dispatch();f.game.player.vehicleId=truck.id;truck.speed=80;const before={x:truck.x,y:truck.y,health:truck.health};
  f.commands.length=0;advance(f.system,.1);assert.equal(truck.troopAI,false);assert.equal(f.commands.filter(command=>command.entity===truck).length,0);assert.equal(f.unloads.length,0);
  assert.deepEqual({x:truck.x,y:truck.y,health:truck.health},before);truck.speed=0;advance(f.system,2);assert.equal(f.unloads.length,4);assert.equal(f.system.status.phase,'borrowed');
});

test('wrecked passengers exit safely, replacement cadence is bounded and cleanup cannot erase a nearby chassis',()=>{
  const f=fixture();f.game.heat=4;advance(f.system,6.1);const first=f.system.trucks[0];Object.assign(f.game.player,{x:first.x+300,y:first.y});first.health=0;f.setExitAllowed(false);advance(f.system,2);
  assert.equal(first.troopAI,false);assert.equal(f.unloads.length,0);assert.equal(f.system.trucks.length,1);
  f.setExitAllowed(true);advance(f.system,2);assert.equal(f.unloads.length,4);assert.equal(f.system.trucks.length,1);
  // The player is nearby: a physical wreck and its squad remain reviewable.
  f.game.player.x=first.x+300;f.game.player.y=first.y;f.system._cleanup();assert.equal(f.system.trucks.includes(first),true);
  f.game.player.x=6025;f.game.player.y=1500;f.system._cleanup();assert.equal(f.system.trucks.includes(first),false);assert.equal(f.soldiers.length,0);
  advance(f.system,80);assert.equal(f.system.events.filter(e=>e.type==='dispatch').length,1);advance(f.system,20);assert.equal(f.system.events.filter(e=>e.type==='dispatch').length,2);
});

test('one active carrier and at most two live chassis remain possible when trucks are borrowed',()=>{
  const f=fixture(),first=f.system._dispatch();assert.equal(f.system._dispatch(),null);first.troopAI=false;first.truckPhase='borrowed';f.game.player.vehicleId=first.id;
  f.game.player.vehicleId=null;Object.assign(f.game.player,{x:6025,y:1500});first.x=3000;const second=f.system._dispatch();assert.ok(second);assert.notEqual(first,second);
  second.troopAI=false;second.truckPhase='borrowed';assert.equal(f.system._dispatch(),null);assert.equal(f.system.trucks.length,2);assert.equal(f.soldiers.length,8);
});
