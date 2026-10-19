'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Game}=require('../core.js');

function seated(type='helicopter') {
  const game=new Game({seed:42});
  const craft=game.aircraft.find(value=>value.aircraftType===type && !value.npc);
  assert.ok(craft,'an accessible '+type+' must be parked at the airport');
  Object.assign(game.player,{vehicleId:craft.id,x:craft.x,y:craft.y,elevation:craft.elevation,grounded:true});
  return {game,craft};
}

test('aircraft can be entered through the game interaction and flight does not create a car body',()=>{
  const {game,craft}=seated();
  game.player.vehicleId=null;
  game.player.x=craft.x; game.player.y=craft.y;
  assert.equal(game.interact(),true);
  assert.equal(game.current,craft);
  const before=craft.elevation;
  for(let i=0;i<300;i++) game.update(1/60,{climb:true,ascend:true,jump:true});
  assert.ok(craft.elevation>before+3,'Space should lift the real player helicopter');
  assert.equal(game.vehiclePhysics.bodies.has(craft.id),false,'aircraft never become road chassis');
  assert.equal(game.player.elevation,craft.elevation);
  assert.equal(game.interact(),false,'ordinary exit is blocked while airborne');
  assert.equal(game.current,craft);
});

test('hangar saves retain component damage across reload and retrieval never duplicates an aircraft',()=>{
  const {game,craft}=seated();
  assert.equal(game.hangarAvailable,true);
  craft.health=63; craft.engineHealth=71; craft.handlingHealth=82;
  assert.equal(game.hangarStore(),true);
  assert.equal(game.hangarStore(),false);
  const id=craft.hangarId,count=game.aircraft.length;
  assert.equal(game.hangarRetrieve(id),true);
  assert.equal(game.current,craft); assert.equal(game.aircraft.length,count);
  assert.equal(craft.health,63); assert.equal(craft.engineHealth,71);
  const saved=game.exportSave(),copy=new Game({seed:42});
  assert.equal(copy.loadSave(saved),true);
  assert.equal(copy.hangar.aircraft[0].health,63);
  Object.assign(copy.player,{x:craft.x,y:craft.y,elevation:craft.elevation,grounded:true});
  assert.equal(copy.hangarRetrieve(id),true);
  assert.equal(copy.current.health,63); assert.equal(copy.current.handlingHealth,82);
  const again=copy.current;
  assert.equal(copy.hangarRetrieve(id),true); assert.equal(copy.current,again);
  copy.money=75;
  assert.equal(copy.hangarRepair(id),true); assert.equal(copy.money,0);
  assert.equal(copy.current.health,copy.current.maxHealth);
  assert.equal(copy.hangarRepair(id),false);
});

test('hangar save validation rejects unknown types and duplicate IDs while legacy saves remain usable',()=>{
  const game=new Game({seed:42});
  assert.equal(game.loadSave({version:1,money:321}),true);
  assert.equal(game.money,321); assert.deepEqual(game.hangar.aircraft,[]);
  assert.equal(game.loadSave({version:2,hangar:{aircraft:[
    {id:'air-1',aircraftType:'trainer',health:40,color:'#ffd15b'},
    {id:'air-1',aircraftType:'fighter'},
    {id:'air-2',aircraftType:'constructor'},
    {id:'__proto__',aircraftType:'trainer'},
    {id:'air-2',aircraftType:'helicopter',health:Infinity,engineHealth:-20,color:'url(evil)'}
  ]}}),true);
  assert.equal(game.hangar.aircraft.length,2);
  assert.equal(game.hangar.aircraft[0].health,40);
  assert.equal(game.hangar.aircraft[1].engineHealth,0);
  assert.equal(game.hangar.aircraft[1].color,'#ffd15b');
});

test('aerial jobs require the right craft and a stopped landing, and cannot be completed on foot',()=>{
  const {game,craft}=seated();
  assert.equal(game.startMission('airtaxi'),true);
  const first=game.mission.targets[0];
  Object.assign(craft,{x:first.x,y:first.y,elevation:first.elevation,speed:0,grounded:true});
  game.player.vehicleId=null;Object.assign(game.player,first);
  game._airMissionStep(3,first); assert.equal(game.mission.targetIndex,0);
  game.player.vehicleId=craft.id;
  craft.grounded=false; game._airMissionStep(3,first); assert.equal(game.mission.targetIndex,0);
  craft.grounded=true; game._airMissionStep(1,first); assert.equal(game.mission.targetIndex,0);
  game._airMissionStep(1.1,first); assert.equal(game.mission.targetIndex,1);
  const destination=game.mission.targets[1];
  Object.assign(craft,{x:destination.x,y:destination.y,elevation:destination.elevation,speed:0,grounded:true});
  const money=game.money;game._airMissionStep(2.1,destination);
  assert.equal(game.mission,null);assert.ok(game.money>money);
});

test('bailout deploys a controllable parachute and landing finishes without restoring aircraft health',()=>{
  const {game,craft}=seated();
  craft.elevation+=30;craft.grounded=false;craft.health=65;
  assert.equal(game.bailOut(),true);
  assert.equal(game.player.vehicleId,null);assert.equal(game.player.parachuting,true);
  const start={x:game.player.x,y:game.player.y};
  game._parachuteStep(.2,{up:true,moveAngle:Math.PI/2});
  assert.ok(game.player.y>start.y);
  for(let i=0;i<1000 && game.player.parachuting;i++) game._parachuteStep(1/60,{});
  assert.equal(game.player.parachuting,false);assert.equal(game.player.grounded,true);
  assert.equal(craft.health,65);
});

test('aircraft recovery keeps the same pilot and type, and ground garages cannot overwrite aircraft health',()=>{
  const {game,craft}=seated('policeheli');
  const id=craft.id,type=craft.aircraftType;craft.health=75;
  craft.x+=1400;craft.elevation+=50;craft.grounded=false;
  assert.equal(game.recover(),true);assert.equal(game.current,craft);assert.equal(craft.id,id);assert.equal(craft.aircraftType,type);assert.equal(craft.health,75);
  const garage=game.services.find(service=>service.id==='garage');
  Object.assign(craft,{x:garage.x,y:garage.y,elevation:game._ground(garage),grounded:true});
  const before=craft.maxHealth;
  assert.equal(game.garageAvailable,false);assert.equal(game.purchase('repair'),false);
  assert.equal(game._useService({id:'repair'}),false);assert.equal(craft.maxHealth,before);
});

test('smooth passenger trips earn a comfort bonus and rough flight reduces it without losing base pay',()=>{
  const run=rough=>{
    const {game,craft}=seated();game.startMission('airtaxi');
    const pickup=game.mission.targets[0];Object.assign(craft,{x:pickup.x,y:pickup.y,elevation:pickup.elevation,speed:0,grounded:true});
    game._airMissionStep(2.1,pickup);
    assert.equal(game.mission.stage,'passengers aboard');
    if(rough) {craft.verticalVelocity=11;craft.roll=.32;game._airMissionStep(20,game.mission.targets[1]);}
    const comfort=game.missionStats.comfort,destination=game.mission.targets[1];
    Object.assign(craft,{x:destination.x,y:destination.y,elevation:destination.elevation,verticalVelocity:0,roll:0,grounded:true,speed:0});
    const money=game.money;game._airMissionStep(2.1,destination);return {pay:game.money-money,comfort};
  };
  const smooth=run(false),rough=run(true);
  assert.equal(smooth.comfort,100);assert.ok(rough.comfort<100);assert.ok(smooth.pay>rough.pay);assert.ok(rough.pay>=220);
});

test('aircraft explosions damage nearby cars and preserve vertical separation without creating road chassis',()=>{
  const {game,craft}=seated();game.player.vehicleId=null;
  const ride=game._addCar(craft.x+80,craft.y,0,'compact','#ffd15b');
  ride.elevation=craft.elevation;game.vehiclePhysics.sync();
  const overhead=game.aviation.spawn('trainer',{x:craft.x,y:craft.y,elevation:craft.elevation+50});
  const overheadHealth=overhead.health;
  craft.exploded=true;craft.health=0;
  game._onAircraftExplosion(craft);
  assert.ok(ride.health<ride.maxHealth);assert.ok(game.vehiclePhysics.get(ride.id).velocity.y>0);
  assert.equal(overhead.health,overheadHealth);assert.equal(game.vehiclePhysics.bodies.has(craft.id),false);
});

test('wide commuter aircraft can be boarded outside their wings and exits avoid neighboring aircraft',()=>{
  const game=new Game({seed:42}),craft=game.aircraft.find(value=>value.aircraftType==='commuter');
  craft.npc=false;
  Object.assign(game.player,{vehicleId:null,x:craft.x-124.5,y:craft.y+182,elevation:craft.elevation,grounded:true});
  for(const other of game._solidVehicles()) assert.equal(game._personVehicleContact(game.player,other),null,'boarding approach clears '+other.id);
  assert.equal(game.interact(),true);assert.equal(game.current,craft);
  assert.equal(game.interact(),true);assert.equal(game.player.vehicleId,null);
  for(const other of game._solidVehicles()) assert.equal(game._personVehicleContact(game.player,other),null,'exit clears '+other.id);
  assert.equal(game.interact(),true);assert.equal(game.current,craft,'the pilot can immediately board again');
});
