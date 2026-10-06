'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Game}=require('../core.js');
const {MUZZLE_HEIGHT,PERSON_HEIGHT,PLAYER_RADIUS}=require('../physics.js');
const {makeFlatGame}=require('./helpers/flat-game.cjs');
const advance=(game,seconds,input={})=>{for(let elapsed=0;elapsed<seconds-1e-8;elapsed+=1/60)game.update(1/60,input);};
const near=(actual,expected,tolerance=.025)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} is near ${expected}`);

function sampledTerrain(sample) {
  const count=65,step=50,heights=new Float32Array(count*count);
  for(let row=0;row<count;row++)for(let col=0;col<count;col++)heights[row*count+col]=sample(col*step/20,row*step/20);
  const heightAt=(x,y)=>{
    const gx=Math.max(0,Math.min(count-1,x/step)),gy=Math.max(0,Math.min(count-1,y/step));
    const col=Math.min(count-2,Math.floor(gx)),row=Math.min(count-2,Math.floor(gy)),u=gx-col,v=gy-row;
    const a=heights[row*count+col],b=heights[row*count+col+1],c=heights[(row+1)*count+col],d=heights[(row+1)*count+col+1];
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  };
  const normalAt=(x,y)=>{
    const delta=.01,dx=(heightAt(x+delta,y)-heightAt(x-delta,y))*20/(2*delta),dz=(heightAt(x,y+delta)-heightAt(x,y-delta))*20/(2*delta),length=Math.hypot(dx,1,dz);
    return{x:-dx/length,y:1/length,z:-dz/length};
  };
  return{count,step,heights,heightAt,surfaceHeight:heightAt,normalAt,surfaceNormalAt:normalAt,waterLevel:0,isWater:()=>false};
}

function terrainGame(sample=()=>12) {
  const game=makeFlatGame(),terrain=sampledTerrain(sample);
  game.terrain=game.world.terrain=terrain;game.buildings=[];game.staticObjects=[];game.peds=[];game.police=[];
  for(const point of game.services)point.elevation=game._ground(point);
  game.player.elevation=game._ground(game.player);game.vehiclePhysics.sync();
  for(const car of game.cars)game.vehiclePhysics.reset(car);
  return game;
}

test('hill walking follows the surface and a held Space jumps once above local ground',()=>{
  const game=terrainGame((x,z)=>10+.12*x+.08*z);game.cars=[];
  const start={...game.player};advance(game,2,{right:true});
  near(game.player.x-start.x,310,.0001);assert.ok(game.player.elevation>start.elevation+1.8);near(game.player.elevation,game._ground(game.player));assert.equal(game.player.grounded,true);
  game.drainEvents();let apex=0;
  for(let frame=0;frame<120;frame++){game.update(1/60,{jump:true});apex=Math.max(apex,game.player.elevation-game._ground(game.player));}
  assert.ok(apex>1.3&&apex<1.5,'the familiar jump height is measured above the hill');near(game.player.elevation,game._ground(game.player));assert.equal(game.player.grounded,true);
  assert.equal(game.drainEvents().filter(event=>event.name==='jump').length,1,'holding Space does not auto-jump');
  game.update(1/60,{});game.update(1/60,{jump:true});assert.equal(game.player.grounded,false);assert.ok(game.player.verticalVelocity>6);
});

test('raised garage entry, collection, repair tape and exits use grounded height rather than sea level',()=>{
  const game=terrainGame(),car=game.cars[0];game.cars=[car];game.money=2000;
  assert.equal(game.interact(),true);Object.assign(car,{x:900,y:900});game.vehiclePhysics.reset(car);
  Object.assign(game.player,{x:car.x,y:car.y,elevation:car.elevation});
  assert.equal(game.garageAvailable,true);car.health=40;car.engineHealth=45;
  assert.equal(game.garageStore(),true);const id=car.garageId;
  assert.equal(game.garageRetrieve(id),true);near(car.elevation,12);assert.equal(car.health,40);assert.equal(car.engineHealth,45);
  assert.equal(game.usePocket('repairTape'),true);assert.equal(car.health,95);assert.equal(car.engineHealth,100);
  car.elevation=15;car.grounded=false;assert.equal(game.garageAvailable,false);assert.equal(game.interact(),false);
  game.vehiclePhysics.reset(car);assert.equal(game.interact(),true);assert.equal(game.player.vehicleId,null);near(game.player.elevation,12);assert.equal(game.player.grounded,true);
});

test('raised buildings and props collide only within their actual height volumes',()=>{
  const game=terrainGame();game.cars=[];
  game.buildings=[{x:1080,y:1050,w:100,h:100,elevation:12,height:4,angle:.3}];
  game.staticObjects=[{kind:'bench',x:1250,y:1080,elevation:12,parts:[{half:[.7,.1,.3],offset:[0,.5,0]}]}];
  assert.equal(game._isFree(1120,1080,PLAYER_RADIUS,12),false);assert.equal(game._isFree(1120,1080,PLAYER_RADIUS,8),true);
  assert.equal(game._isFree(1250,1080,PLAYER_RADIUS,12),false);assert.equal(game._isFree(1250,1080,PLAYER_RADIUS,14),true);
  assert.equal(game._blockedLine({x:1000,y:1080,elevation:12},{x:1200,y:1080,elevation:12}),true);
  assert.equal(game._blockedLine({x:1000,y:1080,elevation:7},{x:1200,y:1080,elevation:7}),false);
  assert.equal(game._blockedLine({x:1000,y:1080,elevation:17},{x:1200,y:1080,elevation:17}),false);
});

test('Party Cannon muzzle and terrain impact stay relative to raised land, with real crowd hits',()=>{
  const game=terrainGame();game.cars=[];game.inventory.unlocked.push('cannon');game.inventory.equipped='cannon';game.inventory.ammo.cannon=3;
  Object.assign(game.player,{x:1080,y:1080,elevation:12});
  const ped={id:'hill-resident',x:1230,y:1080,elevation:12,angle:0,homeX:1230,homeY:1080,pace:0,stunned:0,bubbleTimer:0};game.peds=[ped];
  game.action(0,{pitch:0});near(game.projectiles[0].height,12+MUZZLE_HEIGHT,1e-10);advance(game,.3);
  assert.equal(game.projectiles.length,0);assert.ok(game.physics.get(ped.id));assert.equal(game.heat,1);
  game.peds=[];game.ragdolls.clearAll?.();game._actionCooldown=0;game.particles=[];
  game.action(0,{pitch:-.4});advance(game,.1);assert.equal(game.projectiles.length,0);assert.ok(game.particles.some(particle=>Math.abs(particle.height-12.12)<1e-10));
});

test('a hillside foundation blocks people and toy shots below the raised wall base',()=>{
  const game=terrainGame();game.cars=[];
  const building={x:1150,y:1030,w:120,h:100,elevation:16,height:4,foundationBottom:11.88,angle:.1};game.buildings=[building];game.vehiclePhysics.sync();
  assert.equal(game._isFree(1200,1080,PLAYER_RADIUS,12),false,'the low corner still has a solid plinth');
  assert.equal(game._isFree(1200,1080,PLAYER_RADIUS,9),true,'a volume completely below its bottom stays clear');
  assert.equal(game._blockedLine({x:1080,y:1080,elevation:12},{x:1320,y:1080,elevation:12}),true);
  Object.assign(game.player,{x:1080,y:1080,elevation:12});game.inventory.unlocked.push('cannon');game.inventory.equipped='cannon';game.inventory.ammo.cannon=1;
  game.action(0,{pitch:0});advance(game,.15);assert.equal(game.projectiles.length,0,'a level shot hits the foundation rather than entering the building');
});

test('recovery and capture restore sampled feet height while preserving persistent progress',()=>{
  const game=terrainGame((x,z)=>5+.05*x+.03*z);game.money=300;game.upgrades.boost=2;game.acceptMission('delivery');game.heat=2;
  Object.assign(game.player,{x:440,y:500,elevation:40,verticalVelocity:-8,grounded:false});const save=game.exportSave();
  game.recover();near(game.player.elevation,game._ground(game.player));assert.equal(game.player.verticalVelocity,0);assert.equal(game.heat,2);assert.equal(game.money,300);assert.ok(game.mission);
  game._caught();assert.equal(game.player.x,game.world.start.player.x);assert.equal(game.player.y,game.world.start.player.y);near(game.player.elevation,game._ground(game.player));assert.equal(game.money,250);assert.equal(game.upgrades.boost,2);assert.ok(game.mission);
  assert.deepEqual(Object.keys(game.exportSave()),Object.keys(save));assert.equal(JSON.stringify(game.exportSave()).includes('elevation'),false);
});

test('submerged cars return to a nearby dry road after a short delay without losing progress',()=>{
  const game=terrainGame((x)=>x<35?-4:3),car=game.cars[0];game.cars=[car];game.terrain.isWater=(x)=>x<700;
  game.player.vehicleId=car.id;game.money=430;game.heat=2;game.completed=3;Object.assign(car,{x:540,y:900});game.vehiclePhysics.reset(car);
  game.drainEvents();advance(game,.5);assert.ok(car.x<700,'a splash gets a short physical sinking delay');
  advance(game,.2);assert.ok(car.x>=700);assert.ok(game.network.project(car).distance<20);near(car.elevation,game._ground(car));near(car.speed,0,.01);near(car.verticalVelocity,0,.05);
  assert.equal(game.money,430);assert.equal(game.heat,2);assert.equal(game.completed,3);assert.equal(game.player.vehicleId,car.id);near(game.player.elevation,car.elevation);
  assert.equal(game.drainEvents().filter(event=>event.text==='Splash! Back to the road.').length,1);
});

test('on-foot water recovery waits while paused and does not trigger above a real bridge deck',()=>{
  const game=terrainGame(()=>-4);game.cars=[];game.terrain.isWater=()=>true;
  const bridge={id:'bridge-fixture',bridge:true,width:104,points:[{x:400,y:1080,elevation:2},{x:1600,y:1080,elevation:4}]};
  game.roads=[bridge];game.terrain.surfaceHeight=(x,y)=>x>=400&&x<=1600&&Math.abs(y-1080)<=84?2+(x-400)/600:-4;
  game.terrain.surfaceNormalAt=(x,y)=>game.terrain.surfaceHeight(x,y)>0?{x:-1/Math.hypot(30,1),y:30/Math.hypot(30,1),z:0}:{x:0,y:1,z:0};
  game.player.elevation=game._ground(game.player);game.vehiclePhysics.sync();advance(game,1.2);
  near(game.player.elevation,game._ground(game.player));assert.ok(game.player.elevation>2);assert.equal(game.player.waterTimer||0,0);assert.ok(!game.drainEvents().some(event=>event.text==='Splash! Back to the road.'));
  Object.assign(game.player,{x:540,y:900,elevation:-4,grounded:true});game.update(0);game.update(NaN);assert.equal(game.player.waterTimer||0,0);
  advance(game,.7);assert.equal(game._dry(game.player),true);near(game.player.elevation,game._ground(game.player));assert.ok(game.drainEvents().some(event=>event.text==='Splash! Back to the road.'));
});

test('actual terrain starts all gameplay entities and campaign targets on their shared surface',()=>{
  const game=new Game({seed:42});assert.ok(game.terrain);assert.equal(game.world.size,12000);
  near(game.player.elevation,game._ground(game.player),1e-9);assert.equal(game.interact(),true);
  for(const entity of [...game.cars,...game.peds,...game.police])assert.ok(Math.abs(entity.elevation-game._ground(entity))<.3,entity.id+' starts at local ground');
  for(const type of ['delivery','dash','party']){game.abandonMission();game.acceptMission(type);for(const target of game.mission.targets)near(target.elevation,game._ground(target),1e-9);}
});
