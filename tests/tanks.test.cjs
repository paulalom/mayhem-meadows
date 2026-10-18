'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const World=require('../world.js');
const Cannon=require('../vendor/cannon.cjs');
const {TankSystem,APPROVED_ROADS,MAX_SHELLS,SHELL_SPEED}=require('../tanks.js');

function fixture(){
  const nodes=[{id:'west',x:2600,y:-930},{id:'inner',x:6025,y:-930},{id:'gate',x:6025,y:-750},{id:'outside',x:6025,y:-300},{id:'ridge',x:6025,y:1500}];
  const road=(id,a,b)=>({id,a,b,width:110,points:[nodes.find(n=>n.id===a),nodes.find(n=>n.id===b)]});
  const roads=[road('base-compound-road','inner','west'),road('base-entry-road','gate','inner'),road('base-gate-road','outside','gate'),road('base-access-ridge','ridge','outside')];
  const car={id:'target',kind:'compact',x:6025,y:1000,elevation:14,angle:0,vx:0,vy:0,health:1000};
  const commands=[],damage=[],events=[];
  const game={world:{roads,roadNetwork:new World.RoadNetwork(roads,nodes),landscape:{militaryBase:{gate:{x:6025,y:-750}}},terrain:{surfaceHeight:()=>14,isWater:()=>false}},
    player:{id:'player',x:car.x,y:car.y,elevation:14,vehicleId:car.id},cars:[car],police:[],aircraft:[],buildings:[],staticObjects:[],heat:0,
    _ground:()=>14,_blockedLine:()=>false,_toast:text=>events.push(text),_sound:()=>{},_confetti:()=>{},
    _damageVehicle:(entity,amount,metadata)=>{entity.health-=amount;damage.push({entity,amount,metadata});},
    vehiclePhysics:{control:(entity,command)=>{commands.push({entity,...command});},impulse:()=>{}},railTraffic:{colliders:[],roadSpeedLimit:(car,heading,speed)=>speed}};
  Object.defineProperty(game,'current',{get:()=>game.cars.concat(game.aircraft).find(c=>c.id===game.player.vehicleId)||game.player});
  const system=new TankSystem(game);return {game,system,car,commands,damage,events};
}
const advance=(system,seconds,input={})=>{for(let i=0;i<Math.ceil(seconds*60);i++)system.step(1/60,input);};
function gunFixture(){const f=fixture();f.game._ground=()=>0;f.game.world.terrain.surfaceHeight=()=>0;const tank=f.system._dispatch();Object.assign(tank,{x:0,y:0,elevation:0,angle:0,gunCooldown:0,tankGun:{turretAngle:0,pitch:0}});Object.assign(f.car,{x:700,y:0,elevation:0});return {...f,tank};}

test('armour requires one continuous four-star minute and an announced eight-second mobilization',()=>{
  const {game,system}=fixture();game.heat=4;advance(system,59);assert.equal(system.warning,0);assert.equal(system.tanks.length,0);
  game.heat=3;advance(system,.1);assert.equal(system.fourStarTime,0);
  game.heat=4;advance(system,60.1);assert.ok(system.warning>7.8);assert.equal(system.tanks.length,0);
  advance(system,8.1);assert.equal(system.tanks.length,1);assert.equal(game.cars.includes(system.tanks[0]),true);assert.equal(system.tanks[0].kind,'tank');
  advance(system,70);assert.equal(system.tanks.length,1);assert.equal(system.events.filter(e=>e.type==='dispatch').length,1);
});

test('a four-star minute mobilizes armour on foot or in the air while the gun holds fire',()=>{
  for(const mode of ['foot','air']){
    const {game,system}=fixture();game.player.vehicleId=null;
    if(mode==='air'){game.aircraft.push({id:'plane',kind:'aircraft',aircraftType:'trainer',x:6000,y:500,elevation:80,health:160});game.player.vehicleId='plane';}
    game.heat=4;advance(system,60.1);assert.ok(system.warning>7.8);assert.equal(system.tanks.length,0);
    advance(system,8.1);assert.equal(system.tanks.length,1);advance(system,5);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
  }
});

test('a real base alarm mobilizes immediately on foot, while clearing heat cancels the alarm',()=>{
  const {game,system,events}=fixture();game.player.vehicleId=null;
  assert.equal(system.reportBaseAttack({position:{x:6025,y:-750},playerCaused:false}),false);assert.equal(game.heat,0);
  system.reportBaseAttack({position:{x:6025,y:-750},playerCaused:true});assert.equal(game.heat,4);assert.ok(events.some(e=>/base alarm/.test(e)));
  game.escapeTimer=31;game._policeSearching=true;game.police.push({id:'searching-cop',kind:'compact',x:0,y:1000,elevation:14,health:100,lastSeen:{x:0,y:0},routeTimer:8});
  const freshIncident={x:6025,y:-700};system.reportBaseAttack({position:freshIncident,playerCaused:true});
  assert.equal(game.escapeTimer,0,'a fresh base hit restarts the full escape window even when heat is already four');assert.equal(game._policeSearching,false);
  assert.deepEqual(game.police[0].lastSeen,freshIncident);assert.equal(game.police[0].routeTimer,0,'civilian patrols reroute to the newly reported base incident');
  advance(system,8.2);assert.equal(system.tanks.length,1);advance(system,5);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
  system.clearHeat();game.heat=0;assert.equal(system.baseAlarmTime,0);assert.equal(system.warning,0);assert.equal(system.tanks[0].tankPhase,'return');
});

test('no Northwatch base, obstructed spawn or nearby player means no arbitrary spawning',()=>{
  const {game,system}=fixture();system.base=null;game.heat=4;advance(system,75);assert.equal(system.tanks.length,0);
  system.base=game.world.landscape.militaryBase;game.current.x=3500;game.current.y=-930;assert.equal(system._dispatch(),null);
  game.current.x=6025;game.current.y=1000;game.buildings.push({x:3450,y:-960,w:100,h:60,elevation:14,height:8});assert.equal(system._dispatch(),null);
});

test('routes use only validated open outskirts roads and stop before a dense neighbourhood',()=>{
  const world=World.createWorld(1),game={world,cars:[],police:[],aircraft:[],buildings:world.buildings,staticObjects:world.staticObjects,player:{x:6000,y:3700},_ground:p=>world.terrain.surfaceHeight(p.x,p.y)};
  const system=new TankSystem(game),tank=system._dispatch();assert.ok(tank);assert.ok(system.roads.length>=10);
  assert.equal(system.roadIds.has('willow-green-road'),false);assert.equal(system.roadIds.has('north-spine'),false);
  system._route(tank,{x:6000,y:3700});assert.ok(tank.route.length>20);assert.ok(tank.route.every(p=>APPROVED_ROADS.includes(p.roadId)));assert.ok(tank.route.every(p=>p.y<=1500));
  system._route(tank,{x:11000,y:4000});assert.ok(tank.route.length>0);assert.ok(tank.route.every(p=>!p.roadId.startsWith('orchard')), 'base tank does not select a disconnected airport shortcut');
});

test('a clear distant perimeter checkpoint can respond at the airport without crossing Northside',()=>{
  const world=World.createWorld(1),car={id:'airport-car',kind:'compact',x:11400,y:3500,elevation:2.5,health:100};
  const game={world,cars:[car],police:[],aircraft:[],buildings:world.buildings,staticObjects:world.staticObjects,player:{vehicleId:car.id},current:car,_ground:p=>world.terrain.surfaceHeight(p.x,p.y)};
  const system=new TankSystem(game),tank=system._dispatch();assert.ok(tank);assert.ok(Math.hypot(tank.x-car.x,tank.y-car.y)>1000);
  system._route(tank,car);assert.ok(tank.route.length>0);assert.ok(tank.route.every(p=>/^(orchard-|apple-|airport-terminal)/.test(p.roadId)));
});

test('approach travel does not expire before first contact and hidden targets cannot redirect the radio report',()=>{
  const {game,system,car}=fixture();game.heat=4;game._blockedLine=()=>true;
  const tank=system._dispatch(),reported={...tank.approachPoint};advance(system,40);
  assert.equal(tank.tankPhase,'approach');assert.equal(tank.searchTime,0);
  car.x=11000;car.y=5000;advance(system,4);assert.deepEqual(tank.approachPoint,reported);assert.deepEqual(tank.destination,{x:reported.x,y:reported.y});
});

test('full track footprints reject water and steep verge edges',()=>{
  const {game,system}=fixture();const p={x:3500,y:-930,angle:0};assert.equal(system._footprintClear(p),true);
  game.world.terrain.isWater=(x,y)=>y<-950;assert.equal(system._footprintClear(p),false);
  game.world.terrain.isWater=()=>false;game._ground=p=>p.y<-950?10:14;assert.equal(system._footprintClear(p),false);
});

test('road obstacles, closed rail crossings and an off-road knock stop the real chassis command',()=>{
  const {game,system,commands,car}=fixture(),tank=system._dispatch();game.heat=4;car.x=6025;car.y=1000;
  game.railTraffic.roadSpeedLimit=()=>0;system._duty(tank,car,1/60);assert.equal(commands.at(-1).targetSpeed,0);
  game.railTraffic.roadSpeedLimit=(car,heading,speed)=>speed;game.cars.push({id:'blocker',kind:'van',x:tank.x+90,y:tank.y,elevation:14,health:100});system._duty(tank,car,1/60);assert.equal(commands.at(-1).targetSpeed,0);
  tank.y+=300;system._duty(tank,car,1/60);assert.equal(commands.at(-1).targetSpeed,0);assert.equal(tank.tankPhase,'blocked');
});

test('the Northwatch switchback starts a pivot before a long nose reaches the steep verge',()=>{
  const world=World.createWorld(1),car={id:'ridge-car',kind:'compact',x:5550,y:1150,elevation:5.68,health:100},commands=[];
  const game={world,cars:[car],police:[],aircraft:[],buildings:world.buildings,staticObjects:world.staticObjects,player:{vehicleId:car.id},current:car,heat:4,
    _ground:p=>world.terrain.surfaceHeight(p.x,p.y),vehiclePhysics:{control:(car,command)=>commands.push(command)}};
  const system=new TankSystem(game),tank=system._dispatch();Object.assign(tank,{x:6633,y:-505,elevation:world.terrain.surfaceHeight(6633,-505),angle:.107,speed:0,routeTimer:0});
  system._duty(tank,car,1/60);const command=commands.at(-1);assert.equal(command.targetSpeed,0);assert.ok(Math.abs(command.heading-tank.angle)>.9,'the stopped tank aims its chassis beyond the hairpin instead of facing its blocked old road');
});

test('turret aim turns at a bounded rate, leads moving cars and respects elevation limits',()=>{
  const {system,tank,car}=gunFixture();car.y=700;car.vx=150;system._aim(tank,car,.5);
  assert.ok(Math.abs(tank.tankGun.turretAngle-.3)<1e-9);assert.ok(tank.aimAngle<Math.PI/4);assert.equal(tank.turretAngle,tank.tankGun.turretAngle);
  car.elevation=500;system._aim(tank,car,10);assert.equal(tank.aimPitch,.35);assert.equal(tank.tankGun.pitch,.35);
});

test('cannon muzzle follows the articulated chassis on slopes and compensates its aiming elevation',()=>{
  const {system,tank,car}=gunFixture();tank.orientation={x:0,y:0,z:Math.sin(.05),w:Math.cos(.05)};
  const before=system.muzzle(tank);assert.ok(before.elevation>2.3);assert.ok(before.direction.z>.09);
  system._aim(tank,car,5);assert.ok(tank.tankGun.pitch<-.09);const after=system.muzzle(tank);assert.ok(Math.abs(after.direction.z)<.03);
  system._fire(tank,true);assert.ok(Math.abs(system.shells[0].vz-after.direction.z*SHELL_SPEED/20)<1e-9);
});

test('player camera aim uses the same chassis compensation on a pitched and rolled tank',()=>{
  const {system,tank,game}=gunFixture(),orientation=new Cannon.Quaternion().setFromEuler(.08,-.55,.1,'XYZ');
  const forward=orientation.vmult(new Cannon.Vec3(1,0,0));tank.orientation=orientation;tank.angle=Math.atan2(forward.z,forward.x);tank.tankAI=false;game.player.vehicleId=tank.id;
  const yaw=.9,pitch=.08;system._aim(tank,null,10,{aimAngle:yaw,aimPitch:pitch});const muzzle=system.muzzle(tank);
  assert.ok(Math.abs(muzzle.direction.x-Math.cos(yaw)*Math.cos(pitch))<1e-9);
  assert.ok(Math.abs(muzzle.direction.y-Math.sin(yaw)*Math.cos(pitch))<1e-9);
  assert.ok(Math.abs(muzzle.direction.z-Math.sin(pitch))<1e-9);
  const before={...muzzle.direction};system._aim(tank,null,1/60,{});const held=system.muzzle(tank).direction;
  assert.ok(Math.hypot(held.x-before.x,held.y-before.y,held.z-before.z)<1e-9,'missing camera input preserves the actual world gun direction');
});

test('aimed ballistic shells hit moving road vehicles, reload, and never tunnel through nearer thin cover',()=>{
  const {system,tank,car,game,damage}=gunFixture();car.vx=50;system._aim(tank,car,5);assert.equal(system._fire(tank,true),true);assert.equal(system._fire(tank,true),false);
  for(let i=0;i<60;i++){car.x+=car.vx/60;system._shells(1/60);}assert.equal(damage.length,1);assert.equal(damage[0].entity,car);assert.equal(damage[0].amount,75);assert.equal(damage[0].metadata.playerCaused,false);
  tank.gunCooldown=0;game.buildings.push({id:'thin-cover',x:400,y:-100,w:2,h:200,elevation:0,height:8});assert.equal(system._fire(tank,true),true);
  system._shells(1);assert.equal(damage.length,1);assert.equal(system.events.at(-1).object,'thin-cover');
});

test('shell gravity, terrain, roof height and physical fence parts constrain trajectories',()=>{
  const {system,tank,game,car,damage}=gunFixture();car.x=2000;tank.tankGun.pitch=.2;system._fire(tank,true);const shell=system.shells[0],vz=shell.vz;
  system._shells(.1);assert.ok(Math.abs(shell.vz-(vz-1.8))<1e-9);
  system.shells.length=0;game.staticObjects.push({id:'steel-fence',x:200,y:0,elevation:0,parts:[{half:[.05,2,5],offset:[0,2,0]}]});tank.gunCooldown=0;tank.tankGun.pitch=0;system._fire(tank,true);system._shells(1);assert.equal(system.events.at(-1).object,'steel-fence');assert.equal(damage.length,0);
  game.staticObjects.length=0;game.buildings.push({id:'low-roof',x:150,y:-100,w:50,h:200,elevation:0,height:1});assert.equal(system._cover({x:100,y:0,elevation:3},{x:300,y:0,elevation:3}).fraction,null);
  assert.notEqual(system._cover({x:100,y:0,elevation:3},{x:300,y:0,elevation:-1}).fraction,null);
});

test('a shell can hit an articulated tank barrel outside its chassis footprint',()=>{
  const {system,tank,game,damage}=gunFixture();tank.y=30;tank.tankGun.pitch=.0178;
  const other={id:'crosswise-tank',kind:'tank',tank:true,x:400,y:100,elevation:0,angle:0,health:600,tankGun:{turretAngle:-Math.PI/2,pitch:0}};game.cars.push(other);
  system._fire(tank,true);for(let i=0;i<30;i++)system._shells(1/60);
  assert.equal(damage[0]?.entity,other);assert.equal(damage[0].amount,75);assert.ok(Math.abs(other.y-30)>48,'the shell struck the barrel beyond the hull rectangle');
});

test('infantry and airborne aircraft are never tank gun targets',()=>{
  const {game,system,car}=fixture(),tank=system._dispatch();game.heat=4;Object.assign(car,{x:tank.x+600,y:tank.y});
  game.player.vehicleId=null;advance(system,10);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
  game.aircraft.push({id:'plane',kind:'aircraft',aircraftType:'trainer',x:tank.x+600,y:tank.y,elevation:100,health:160});game.player.vehicleId='plane';advance(system,10);assert.equal(system.events.filter(e=>e.type==='fire').length,0);
});

test('player cannon uses explicit aim, respects cover at its muzzle and bounds active projectiles',()=>{
  const {system,tank,game}=gunFixture();tank.tankAI=false;game.player.vehicleId=tank.id;
  advance(system,.1,{aimAngle:Math.PI/2,aimPitch:.1});assert.ok(tank.tankGun.turretAngle>0);assert.ok(tank.tankGun.pitch>0);
  tank.gunCooldown=0;game.buildings.push({x:20,y:-20,w:20,h:40,elevation:0,height:8});tank.tankGun={turretAngle:0,pitch:0};assert.equal(system._fire(tank,false),false);
  game.buildings.length=0;for(let i=0;i<MAX_SHELLS;i++){tank.gunCooldown=0;assert.equal(system._fire(tank,false),true);}tank.gunCooldown=0;assert.equal(system._fire(tank,false),false);assert.equal(system.shells.length,MAX_SHELLS);assert.equal(game.tankShells,system.shells);
});

test('returning chassis stand down and can be reused without replenishing armour',()=>{
  const {system,game}=fixture(),tank=system._dispatch();tank.health=430;tank.tankPhase='return';system._duty(tank,null,1/60);assert.equal(tank.tankAI,false);assert.equal(tank.tankPhase,'parked');
  assert.equal(system._dispatch(),tank);assert.equal(tank.health,430);assert.equal(system.tanks.length,1);
  game.player.vehicleId=tank.id;system._tick(1/60,{});assert.equal(tank.tankAI,false);assert.equal(system.status.phase,'borrowed');
});

test('splash damage falls off and solid cover protects another road vehicle',()=>{
  const {system,game,car,damage}=gunFixture();Object.assign(car,{x:45,y:0});const covered={id:'covered',kind:'compact',x:70,y:50,elevation:0,health:100};game.cars.push(covered);
  game.buildings.push({id:'blast-screen',x:30,y:25,w:70,h:3,elevation:0,height:5});
  system._impact({x:0,y:0,elevation:.7,npc:true,ownerId:'not-here'},null,null);
  assert.ok(damage.some(d=>d.entity===car&&d.amount>0&&d.amount<22));assert.equal(damage.some(d=>d.entity===covered),false);
});
