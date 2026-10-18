'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, SIZE, DISTRICTS } = require('../core.js');
const World = require('../world.js');
const { NPC_RADIUS, PLAYER_RADIUS } = require('../physics.js');
const makeGame = () => new Game({ seed: 42 });
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const pathDistance = (point,points) => {
  let best=Infinity;
  for(let i=0;i<points.length-1;i++) {
    const a=points[i],b=points[i+1],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy)));
    best=Math.min(best,Math.hypot(point.x-a.x-dx*t,point.y-a.y-dy*t));
  }
  return best;
};

test('the stable terrain world has connected city, northside, airport and mountain streets with a usable welcome', () => {
  const game=makeGame(),other=new Game({seed:999});
  assert.equal(SIZE,12000); assert.equal(Game.SIZE,SIZE); assert.equal(game.world.size,SIZE);
  assert.equal(game.world.mapWidth,12000); assert.equal(game.world.mapHeight,12000);assert.equal(game.world.referenceMapHeight,8000);
  assert.deepEqual(game.buildings,other.buildings); assert.deepEqual(game.staticObjects,other.staticObjects);
  assert.equal(Object.keys(DISTRICTS).length,9);
  assert.deepEqual([game.player.x,game.player.y],[5984,3700]);
  assert.deepEqual([game.cars[0].x,game.cars[0].y],[6016,3700]);
  const garage=game.services.find(service=>service.id==='garage');
  assert.deepEqual([garage.x,garage.y,garage.label],[6000,3500,'Sprinkle Garage']);
  assert.equal(garage.elevation,game._ground(garage)); assert.ok(garage.elevation>1);
  assert.ok(game._personFree(game.player.x,game.player.y,PLAYER_RADIUS)); assert.equal(game.interact(),true);
  for(const anchor of game.world.missionAnchors.suburbs) {
    assert.ok(['willow','orchard'].includes(game.districtAt(anchor).id));
    const route=game._roadRoute(game.current,anchor);
    assert.ok(route.length>70); assert.ok(route.length<600); assert.ok(distance(route.at(-1),anchor)<.01);
  }
});

test('navigation consumes bounded samples of real curved roads through every connected graph node', () => {
  const game=makeGame();
  assert.ok(game.roads.some(road=>road.width<=90)); assert.ok(new Set(game.roads.map(road=>road.width)).size>=4);
  assert.ok(game.nodes.some(node=>game.network.adjacency.get(node.id).length===1),'suburban courts have real dead ends');
  assert.ok(game.roads.some(road=>road.length>distance(road.points[0],road.points.at(-1))*1.02),'roads include actual bends');
  for(const node of game.nodes) {
    const route=game._roadRoute(game.player,node,18);
    assert.ok(route.length>0 && route.length<650,node.id+' has a bounded graph route');
    assert.ok(distance(route.at(-1),node)<=18.1,'a lane route ends beside its destination');
    for(let i=0;i<route.length;i++) {
      const point=route[i],road=game.network.roadById.get(point.roadId);
      assert.ok(road); assert.ok(point.s>=0 && point.s<=road.length);
      const bounds=game.world.bounds;assert.ok(point.x>=bounds.minX && point.y>=bounds.minY && point.x<=bounds.maxX && point.y<=bounds.maxY);
      if(i) assert.ok(distance(point,route[i-1])<30,'lane offsets join smoothly at junctions');
      if(i%5===0) assert.ok(game._vehicleFree({...point,kind:'van',elevation:game._ground(point)}),node.id+' route clears the actual fixed geometry');
    }
  }
});

test('rotated lots have varied physical footprints, open gardens and distinctly denser city frontage', () => {
  const game=makeGame(),average=id=>{
    const blocks=game.blocks.filter(block=>block.district===id);
    return blocks.reduce((sum,block)=>sum+block.density,0)/blocks.length;
  };
  assert.ok(game.buildings.length>=90);
  assert.ok(new Set(game.buildings.map(b=>Math.round(b.w)+'x'+Math.round(b.h))).size>35);
  assert.ok(game.buildings.filter(b=>Math.abs(Math.sin(2*b.angle))>.15).length>game.buildings.length*.75);
  assert.ok(average('market')>average('willow')*1.3); assert.ok(average('works')>average('willow')*1.5);
  assert.ok(game.buildings.filter(b=>b.district==='market').length>game.buildings.filter(b=>b.district==='orchard').length*3,'the airport reserves open runway and apron space');
  for(const building of game.buildings) {
    const block=game.blocks.find(b=>b.id===building.blockId);
    assert.equal(block.district,building.district); assert.ok(block.density<.8);
    const bounds=game.world.bounds;assert.ok(World.footprintCorners(building).every(p=>p.x>bounds.minX && p.y>bounds.minY && p.x<bounds.maxX && p.y<bounds.maxY));
    for(const other of game.buildings) if(other!==building) assert.equal(World.boxesOverlap(building,other),false);
  }
  assert.ok(game.buildings.some(b=>b.style==='tower' && b.height>12));
  assert.ok(game.staticObjects.some(o=>o.kind==='fence' && DISTRICTS[o.district].suburban));
});

test('mission gates, suburban destinations and services fit a van at every approach', () => {
  const game=makeGame(),destinations=[...game.services,...game.world.missionAnchors.suburbs];
  for(const type of ['delivery','dash','party']) {
    game.abandonMission(); assert.equal(game.acceptMission(type),true); destinations.push(...game.mission.targets);
    if(type==='dash') {
      assert.ok(game.mission.targets.some(p=>game.districtAt(p).id==='willow'));
      assert.ok(game.mission.targets.some(p=>game.districtAt(p).id==='orchard'));
    }
  }
  for(const point of destinations) for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI*3/4]) {
    assert.ok(game._vehicleFree({...point,kind:'van',angle}),point.x+','+point.y+' is accessible with the real van collider');
  }
  assert.ok(game.cars.length>=20); assert.ok(game.cars.filter(car=>car.traffic).length>=12);
  for(const car of game._vehicles()) assert.ok(game._vehicleFree(car));
});

test('forty-eight city residents and six base personnel start on safe paths', () => {
  const game=makeGame(); assert.equal(game.peds.filter(ped=>ped.district!=='military').length,48);assert.equal(game.peds.length,54);
  const count=id=>game.peds.filter(ped=>ped.district===id).length;
  assert.ok(count('market')>count('heights')); assert.ok(count('market')>count('works'));
  for(const district of Object.values(DISTRICTS))assert.equal(count(district.id),district.pedCount);
  for(const ped of game.peds) {
    assert.ok(game._personFree(ped.x,ped.y,NPC_RADIUS));
    const path=game.pedPaths.find(path=>path.id===ped.pathId),road=game.network.roadById.get(path.roadId);
    assert.ok(pathDistance(ped,path.points)<.01);
    const projection=game.network.project(ped);
    assert.ok(projection.distance>=projection.width/2+NPC_RADIUS,'residents start outside the carriageway');
    assert.equal(ped.elevation,game._ground(ped)); assert.equal(game._dry(ped),true);
    for(const other of game.peds) if(other!==ped) assert.ok(distance(ped,other)>NPC_RADIUS*2);
  }
});

test('ordinary residents follow curved sidewalks in both directions without entering fixed objects', () => {
  const game=makeGame(); game.cars=[]; game.police=[];
  const traveled=new Map(game.peds.map(ped=>[ped.id,0]));
  for(let frame=0;frame<240;frame++) {
    const before=game.peds.map(ped=>({x:ped.x,y:ped.y})); game._pedestrians(.1);
    game.peds.forEach((ped,index)=>traveled.set(ped.id,traveled.get(ped.id)+distance(before[index],ped)));
  }
  for(const ped of game.peds) {
    const path=game.pedPaths.find(path=>path.id===ped.pathId);
    assert.ok(game._isFree(ped.x,ped.y,NPC_RADIUS));
    assert.equal(ped.elevation,game._ground(ped));
    assert.ok(pathDistance(ped,path.points)<3.1,ped.id+' stays on its actual sidewalk');
    const pathLength=path.points.reduce((sum,point,index)=>sum+(index?distance(point,path.points[index-1]):0),0);
    // A short, busy frontage has frequent physical encounters and turnarounds;
    // residents still need sustained motion rather than a scenery deadlock.
    assert.ok(traveled.get(ped.id)>ped.pace*24*(pathLength<75?.75:.8),ped.id+' keeps walking instead of stalling against scenery');
  }
});

test('traffic consumes nearby samples and looks forward instead of repeatedly replacing its curved route', () => {
  const game=makeGame(),car=game.cars[0],start=game.network.pointOnRoad('willow-lake-road',60,18);
  Object.assign(car,start,{traffic:true,speed:80,route:game._roadRoute(start,game.world.missionAnchors.byName['willow-end'],18),wanderGoal:'willow-end'});
  game.cars=[car]; game.police=[]; const route=car.route,first=route[0];
  game._traffic(car,1/60);
  assert.equal(car.route,route); assert.equal(car.wanderGoal,'willow-end'); assert.notEqual(car.route[0],first);
  const target=game._routeTarget(car,car.route,65);
  assert.ok(distance(car,target)>45,'the steering target lies beyond the close sample');
  assert.ok(pathDistance(target,route)<.1,'lookahead remains on the selected curve');
});

test('real Cannon traffic completes consecutive suburban curves without orbiting a waypoint', () => {
  const game=makeGame(),car=game.cars[0],start=game.network.pointOnRoad('willow-lake-road',50,18),end=game.network.pointOnRoad('willow-bottom-road',450,18);
  game.cars=[car]; game.police=[]; game.peds=[];
  Object.assign(car,start,{traffic:true,speed:0,vx:0,vy:0,route:game._roadRoute(start,end,18),wanderGoal:'willow-end'});
  game.vehiclePhysics.reset(car,start);
  let traveled=0,closest=Infinity,previous={x:car.x,y:car.y};
  for(let frame=0;frame<1500;frame++) {
    game.vehiclePhysics.sync(); game._traffic(car,1/60); game.vehiclePhysics.step(1/60);
    traveled+=distance(previous,car); previous={x:car.x,y:car.y}; closest=Math.min(closest,distance(car,end));
    if(frame%30===0) {
      const road=game.network.project(car);
      assert.ok(road.distance<road.width/2-5,'the rigid body follows the road through curves and junctions');
      assert.equal(car.upright,true);
    }
  }
  assert.ok(closest<25,'the chosen northside endpoint was actually reached'); assert.ok(traveled>1300);
});

test('opposing real traffic passes in separate lanes without a false obstacle stop', () => {
  const game=makeGame(),a=game.cars[0],b=game.cars[1]; game.cars=[a,b]; game.police=[]; game.peds=[];
  const first=game.network.pointOnRoad('plaza-spine',40,18),second=game.network.pointOnRoad('plaza-spine',200,-18);
  Object.assign(a,first,{kind:'compact',speed:0,vx:0,vy:0,traffic:true,route:game._roadRoute(first,game.network.pointOnRoad('plaza-spine',235),18)});
  Object.assign(b,second,{kind:'compact',angle:second.angle+Math.PI,speed:0,vx:0,vy:0,traffic:true,route:game._roadRoute(second,game.network.pointOnRoad('plaza-spine',5),18)});
  game.vehiclePhysics.reset(a,a); game.vehiclePhysics.reset(b,b);
  let passing=false;
  for(let frame=0;frame<100;frame++) {
    game.vehiclePhysics.sync(); game._traffic(a,1/60); game._traffic(b,1/60); game.vehiclePhysics.step(1/60);
    if(Math.abs(a.y-b.y)<60) {
      passing=true; assert.ok(a.speed>65 && b.speed>65,'an adjacent opposing lane does not trigger braking');
    }
  }
  assert.equal(passing,true); assert.ok(a.y>b.y,'both rigid bodies passed each other');
});

test('blocking traffic pairs clear curved lanes and a shared junction with real Cannon bodies', () => {
  const fixtures=[
    {name:'garden-junction',incoming:'heights-lane',outgoing:'garden-lane',firstGoal:'garden',secondGoal:'heights'},
    {name:'northside-junction',incoming:'willow-lake-road',outgoing:'willow-bottom-road',firstGoal:'willow-end',secondGoal:'willow-bend'},
    {name:'docklands-junction',incoming:'warehouse-road',outgoing:'works-road',firstGoal:'worksyard',secondGoal:'quay'}
  ];
  for(const fixture of fixtures) {
    const game=makeGame(); game.police=[]; game.peds=[];
    const road=game.network.roadById.get(fixture.incoming),a=game.network.pointOnRoad(road.id,road.length-140,18),b=game.network.pointOnRoad(fixture.outgoing,140,-18);
    const poses=[{...a,goal:fixture.firstGoal},{...b,angle:b.angle+Math.PI,goal:fixture.secondGoal}];
    const cars=game.cars.slice(0,2); game.cars=cars;
    poses.forEach((pose,index)=>{
      const car=cars[index]; Object.assign(car,game._vehicleState('compact'),pose,{traffic:true,elevation:game._ground(pose),orientation:null,speed:0,vx:0,vy:0,verticalVelocity:0,upright:true});
      car.route=game._roadRoute(car,game.world.missionAnchors.byName[pose.goal],18); car.wanderGoal=pose.goal;
      game.vehiclePhysics.reset(car,car);
    });
    const traveled=[0,0]; let previous=cars.map(car=>({x:car.x,y:car.y}));
    for(let frame=0;frame<720;frame++) {
      game.vehiclePhysics.sync(); for(const car of cars) game._traffic(car,1/60); game.vehiclePhysics.step(1/60);
      cars.forEach((car,index)=>traveled[index]+=distance(previous[index],car)); previous=cars.map(car=>({x:car.x,y:car.y}));
      if(frame%30===0) for(const car of cars) {
        const road=game.network.project(car); assert.ok(road.distance<road.width/2+4,fixture.name+' stays inside its road/junction corridor');
        assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y)); assert.equal(car.upright,true);
      }
    }
    for(const length of traveled) assert.ok(length>500,fixture.name+' releases both cars from the blocking pair');
    assert.ok(distance(cars[0],cars[1])>100,fixture.name+' cars have cleared one another');
  }
});

test('a calm patrol follows the opposing lane and passes real civilian traffic', () => {
  const game=makeGame(),car=game.cars[0],cop=game.police[0],road='plaza-spine';
  game.cars=[car]; game.peds=[];
  const a=game.network.pointOnRoad(road,40,18),b=game.network.pointOnRoad(road,200,-18);
  Object.assign(car,a,{traffic:true,route:game._roadRoute(a,game.network.pointOnRoad(road,235),18)});
  Object.assign(cop,b,{angle:b.angle+Math.PI,route:game._roadRoute(b,game.network.pointOnRoad(road,5),18),routeTimer:99});
  game.vehiclePhysics.reset(car,car); game.vehiclePhysics.reset(cop,cop);
  const wander=game._wanderRoute(cop);
  assert.ok(wander.some(point=>game.network.project(point).distance>10),'calm patrol destinations use an actual lane');
  assert.ok(game.network.adjacency.get(cop.wanderGoal).length>1,'calm patrols avoid courts');
  for(let frame=0;frame<120;frame++) {
    game.vehiclePhysics.sync(); game._traffic(car,1/60); game._updatePolice(1/60); game.vehiclePhysics.step(1/60);
  }
  assert.ok(car.y>cop.y,'the patrol and civilian pass each other');
  assert.ok(car.speed>60 && cop.speed>50); assert.equal(game.heat,0);
});

test('recovery finds a free tangent placement on curved suburban roads and preserves progress', () => {
  const game=makeGame(),car=game.cars[0],point=game.network.pointOnRoad('orchard-pond-road',250);
  game.player.vehicleId=car.id; game.money=470; game.heat=2;
  Object.assign(car,point,{elevation:game._ground(point)+7,verticalVelocity:-5,orientation:{x:1,y:0,z:0,w:0},upright:false});
  const blocker=game.cars[1]; Object.assign(blocker,point,{elevation:game._ground(point),angle:point.angle,orientation:null});
  const save=game.exportSave(); game.recover();
  assert.equal(game.money,470); assert.equal(game.heat,2); assert.deepEqual(game.exportSave(),save);
  assert.ok(Math.abs(car.elevation-game._ground(car))<.2); assert.equal(car.upright,true); assert.equal(car.verticalVelocity,0);
  assert.ok(game._vehicleFree(car)); assert.equal(game._vehicleContact(car,blocker),null);
  assert.ok(game.network.project(car).distance<20); assert.ok(distance(car,point)<400);
});
