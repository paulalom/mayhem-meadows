'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const World=require('../world.js'),T=require('../trains.js');
const layoutWorld=World.createWorld();
function fixture(){const game={world:layoutWorld,cars:[],police:[],peds:[],aircraft:[]};const system=new T.TrainSystem(game);game.railTraffic=system;return {game,system};}
function advance(system,seconds,inspect){for(let i=0;i<seconds*60;i++){const before=system.services.map(s=>({front:s.front,leg:s.leg,route:s.route}));system.step(1/60);if(inspect)inspect(before,i);}}
function overlap(a,b){const dx=b.x-a.x,dy=b.y-a.y;for(const angle of [a.angle,a.angle+Math.PI/2,b.angle,b.angle+Math.PI/2]){const x=Math.cos(angle),y=Math.sin(angle),radius=car=>Math.abs(Math.cos(car.angle)*x+Math.sin(car.angle)*y)*car.railModel.length/2+Math.abs(-Math.sin(car.angle)*x+Math.cos(car.angle)*y)*car.railModel.width/2;if(Math.abs(dx*x+dy*y)>=radius(a)+radius(b))return false;}return true;}

test('one hour of timetabled trains reaches all destinations, uses all seven tracks and protects complete consists',()=>{
  const {system}=fixture(),tracks=new Set(),arrivals=new Set(),crossed=new Set();let simultaneous=0;
  advance(system,3600,(before,tick)=>{
    for(let i=0;i<system.services.length;i++){const train=system.services[i],old=before[i];if(train.state==='running'){
      for(const part of train.route.segments)if(train.front>=part.start&&train.front-train.length<=part.end)tracks.add(part.id);
      for(const block of train.route.blocks)if(train.front>=block.start&&train.front-train.length<=block.end+60)assert.equal(system.reservations.get(block.id),train.id,block.id+' stays reserved through tail clearance');
      for(const hit of train.route.crossings)if(old.route===train.route&&old.front<hit.start&&train.front>=hit.start){const gate=system.gates.find(g=>g.id===hit.id);assert.equal(gate.state,'closed');assert.equal(gate.progress,1);assert.equal(gate.occupied,false);crossed.add(hit.id);}
    }if(train.state==='dwell')arrivals.add(train.track);}
    if(tick%15===0){const cars=system.cars.filter(c=>c.visible);if(new Set(cars.map(c=>c.serviceId)).size>1)simultaneous++;for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++)if(cars[a].serviceId!==cars[b].serviceId)assert.equal(overlap(cars[a],cars[b]),false,'separate consists never overlap');}
  });
  assert.deepEqual([...tracks].sort(),layoutWorld.railway.tracks.map(t=>t.id).sort());assert.equal(arrivals.size,4);assert.equal(crossed.size,system.gates.length);assert.ok(simultaneous>100);
  for(const service of system.services)assert.ok(service.completed>=Math.floor((3600-service.offset-300)/service.interval)+1,'each departure due early enough finishes its return trip');
  const departures=system.events.filter(e=>e.type==='depart'&&e.leg==='inbound');assert.ok(Math.max(...departures.map(e=>e.delay))<2);assert.equal(system.events.some(e=>e.type==='slot-skipped'),false);
  for(const service of system.services){const events=system.events.filter(e=>e.service===service.id);assert.ok(events.some(e=>e.type==='arrive'&&e.destination===service.destination));assert.ok(events.some(e=>e.type==='complete'&&e.destination==='Northport (off map)'));}
  for(const gate of system.gates){const states=system.events.filter(e=>e.type==='crossing'&&e.crossing===gate.id).map(e=>e.state);for(const state of ['warning','closing','closed','clearing','opening','open'])assert.ok(states.includes(state),gate.roadId+' '+state);}
  assert.equal(system.events.some(e=>e.type==='crossing'&&layoutWorld.railway.crossings.find(c=>c.id===e.crossing)?.kind==='overpass'),false);
});

test('reversal changes leading cab without moving the parked cars or changing their identities',()=>{
  const {system}=fixture();for(const s of system.services.slice(1))s.next=1e8;let parked;
  advance(system,125,()=>{const train=system.services[0];if(train.state==='dwell')parked=train.cars.map(c=>({x:c.x,y:c.y,angle:c.angle}));if(parked&&train.leg==='outbound'&&train.front<train.length+1){train.cars.forEach((c,i)=>{assert.ok(Math.hypot(c.x-parked[i].x,c.y-parked[i].y)<1);assert.ok(Math.abs(Math.sin(c.angle-parked[i].angle))<.01);});}});
  assert.ok(parked);assert.equal(system.services[0].leg,'outbound');
});

test('occupied road crossing warns with arms up, holds the train, then clears after its final car',()=>{
  const {game,system}=fixture();for(const s of system.services.slice(1))s.next=1e8;
  const train=system.services[0],hit=system.routes[train.id].inbound.crossings[0],gate=system.gates.find(g=>g.id===hit.id);
  game.cars.push({id:'obstruction',kind:'compact',x:gate.x,y:gate.y,elevation:game.world.terrain.heightAt(gate.x,gate.y)});
  advance(system,90);assert.equal(gate.state,'warning');assert.equal(gate.progress,0);assert.ok(train.front<hit.start);assert.equal(train.speed,0);
  game.cars.length=0;let entered=false,tail=false;advance(system,100,()=>{if(train.leg==='inbound'&&train.front>=hit.start&&train.front-train.length<=hit.end){entered=true;assert.equal(gate.state,'closed');}if(entered&&train.front-train.length>hit.end+85)tail=true;});
  assert.ok(entered&&tail);assert.equal(gate.state,'open');assert.ok(system.events.some(e=>e.type==='arrive'));
});

test('road users stop outside warning gates, occupants may leave, and overpasses remain open',()=>{
  const {system}=fixture(),gate=system.gates[0],c=Math.cos(gate.angle),s=Math.sin(gate.angle),car={x:gate.x-c*(gate.halfLength+84),y:gate.y-s*(gate.halfLength+84),kind:'compact'};
  gate.state='warning';assert.equal(system.roadSpeedLimit(car,gate.angle,150),0);assert.equal(car.blockedBy,gate.id);
  assert.equal(system.roadSpeedLimit({...car,x:gate.x,y:gate.y},gate.angle,150),150,'vehicles already across the stop line continue clearing');
  assert.equal(system.roadSpeedLimit({x:gate.x-c*(gate.halfLength+40),y:gate.y-s*(gate.halfLength+40)},gate.angle,150),150,'a vehicle committed past the stopping point clears the sensor instead of waiting inside it');
  assert.equal(system.roadSpeedLimit(car,gate.angle+Math.PI,150),150,'traffic heading away is free to clear');
  const person={x:gate.x-c*(gate.halfLength+34),y:gate.y-s*(gate.halfLength+34)};assert.equal(system.pedestrianBlocked(person,c,s),true);assert.equal(system.pedestrianBlocked({x:gate.x,y:gate.y},c,s),false);
  for(const bridge of layoutWorld.railway.crossings.filter(c=>c.kind==='overpass'))assert.equal(system.roadSpeedLimit({x:bridge.x,y:bridge.y},bridge.angle,150),150);
});

test('signals recover from a late obstruction and retain reservations while delayed',()=>{
  const {game,system}=fixture();for(const s of system.services.slice(1))s.next=1e8;const train=system.services[0],hit=system.routes[train.id].inbound.crossings[0],gate=system.gates.find(g=>g.id===hit.id);
  while(gate.state!=='closing')system.step(1/60);
  game.peds.push({x:gate.x,y:gate.y});system.step(1/60);assert.equal(gate.state,'warning');assert.equal(system.reservations.get('main-east'),train.id);
  advance(system,30);assert.ok(train.front<hit.start);game.peds.length=0;advance(system,300);assert.ok(train.completed>0);
});

test('queued opposing and shared-track movements never acquire partial reservations or starve departures',()=>{
  const {system}=fixture();for(const s of system.services)s.next=0;
  advance(system,1200);for(const service of system.services)assert.ok(service.completed>=1,service.id+' makes progress through shared tracks');
  assert.ok(system.events.some(e=>e.type==='wait'));
  for(const service of system.services.filter(s=>s.state==='queued'&&s.requestLeg==='inbound'))assert.equal([...system.reservations.values()].includes(service.id),false,'waiting arrival never holds a partial route');
});

test('train wheels follow ground below the road bridges, and pause/timestep changes do not advance the clock',()=>{
  const {system}=fixture(),second=fixture().system,third=fixture().system;
  for(let i=0;i<30*180;i++)system.step(1/30);for(let i=0;i<60*180;i++)second.step(1/60);for(let i=0;i<120*180;i++)third.step(1/120);
  assert.deepEqual(system.services.map(s=>[s.state,s.front,s.completed]),second.services.map(s=>[s.state,s.front,s.completed]));assert.deepEqual(third.services.map(s=>[s.state,s.front]),second.services.map(s=>[s.state,s.front]));
  const time=system.time;for(const dt of [0,-1,NaN,Infinity])system.step(dt);assert.equal(system.time,time);
  const train=system.services[0],route=system.routes[train.id].inbound,bridge=layoutWorld.railway.crossings.find(c=>c.kind==='overpass');train.route=route;train.leg='inbound';train.front=T.project(route,bridge)+train.cars[0].railModel.length/2;system._pose(train,1/60);
  const car=train.cars[0];assert.ok(car.elevation+car.railModel.height<layoutWorld.terrain.surfaceHeight(car.x,car.y),'the entire train clears the road deck');
});

test('replacement test worlds deactivate rail bodies and release the original layout',()=>{const {game,system}=fixture();advance(system,12);assert.ok(system.colliders.length);game.world={};system.step(1/60);assert.equal(system.colliders.length,0);assert.equal(system.reservations.size,0);});

test('successive crossing requests keep arms down until both complete consists have cleared',()=>{
  const {system}=fixture(),[first,second]=system.services,gate=system.gates.find(g=>g.roadId==='warehouse-road');
  for(const train of [first,second]){train.state='running';train.route=system.routes[train.id].inbound;const hit=train.route.crossings.find(c=>c.id===gate.id);train.front=hit.start+40;train.speed=40;}
  gate.state='closed';gate.progress=1;system._gates(1/60);assert.equal(gate.requested.length,2);
  first.front=first.route.crossings.find(c=>c.id===gate.id).end+first.length+100;system._gates(1/60);assert.equal(gate.state,'closed');assert.deepEqual(gate.requested,[second.id]);
  second.front=second.route.crossings.find(c=>c.id===gate.id).end+second.length+100;system._gates(1/60);assert.equal(gate.state,'clearing');assert.equal(gate.progress,1);
  for(let i=0;i<250;i++)system._gates(1/60);assert.equal(gate.state,'open');assert.equal(gate.progress,0);
});

test('curved road crossings use real road tangents and protect the ferry junction with outer arms',()=>{
  const {system}=fixture(),bend=system.gates.find(g=>g.roadIds?.includes('ferry-quay'));assert.ok(bend);assert.equal(bend.stopLines.length,2);assert.ok(bend.zonePoints.some(p=>p.x===8100&&p.y===5100));
  for(const gate of system.gates)for(const stop of gate.stopLines){
    const roads=layoutWorld.roads.filter(r=>(gate.roadIds||[gate.roadId]).includes(r.id));let best=Infinity,angle=0;
    for(const road of roads)for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((stop.x-a.x)*dx+(stop.y-a.y)*dy)/(dx*dx+dy*dy))),d=Math.hypot(stop.x-a.x-dx*t,stop.y-a.y-dy*t);if(d<best){best=d;angle=Math.atan2(dy,dx);}}
    assert.ok(best<.001);assert.ok(Math.abs(Math.sin(stop.angle-angle))<.001,'barrier follows the local road normal');
  }
});
