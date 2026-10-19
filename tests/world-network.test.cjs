'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const World = require('../world.js');
const world = World.createWorld();
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const angleDistance = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const centre = box => ({x:box.x+box.w/2,y:box.y+box.h/2});

function propParts(objects) {
  return objects.flatMap(object => object.parts.map(part => {
    const angle=object.angle||0,c=Math.cos(angle),s=Math.sin(angle);
    const x=object.x+(part.offset[0]*c-part.offset[2]*s)*20,y=object.y+(part.offset[0]*s+part.offset[2]*c)*20;
    return {object,bottom:part.offset[1]-part.half[1],top:part.offset[1]+part.half[1],
      box:{x:x-part.half[0]*20,y:y-part.half[2]*20,w:part.half[0]*40,h:part.half[2]*40,angle}};
  }));
}

test('the reference-map regions form a connected graph with city loops, suburban courts and mountain hairpins', () => {
  assert.equal(world.size,12000); assert.equal(World.SIZE,12000);
  assert.equal(world.mapWidth,12000); assert.equal(world.mapHeight,12000);assert.equal(world.referenceMapHeight,8000);
  assert.deepEqual(world.bounds,{minX:0,minY:-4000,maxX:12000,maxY:8000});
  assert.ok(world.roads.length>=60); assert.ok(world.nodes.length>=45);
  const visited=new Set(),queue=[world.nodes[0].id];
  while(queue.length) {
    const id=queue.shift(); if(visited.has(id)) continue;
    visited.add(id); for(const edge of world.network.adjacency.get(id)) queue.push(edge.to);
  }
  assert.equal(visited.size,world.nodes.length);
  assert.ok(world.nodes.filter(node=>world.network.adjacency.get(node.id).length===1).length>=6,'suburban courts are real graph dead ends');
  assert.ok(world.roads.length-world.nodes.length+1>=12,'the neighborhoods contain alternative loops');
  const curved=world.roads.filter(road=>{
    const start=road.points[0],end=road.points.at(-1),dx=end.x-start.x,dy=end.y-start.y,length=distance(start,end);
    return road.points.some(point=>Math.abs((point.x-start.x)*dy-(point.y-start.y)*dx)/length>20);
  });
  assert.ok(curved.length>world.roads.length*.55,'regional streets retain substantial curvature');
  assert.ok(world.roads.filter(road=>road.id.startsWith('ridge-hairpin')).length>=4);
  assert.ok(world.roads.filter(road=>road.bridge).length===2,'river crossings are explicit bridge roads');
  assert.ok(Math.max(...world.nodes.map(node=>node.x))>11000);
  assert.ok(Math.max(...world.nodes.map(node=>node.y))>6400);
  for(const road of world.roads) {
    assert.ok(distance(road.points[0],world.network.nodeById.get(road.a))<1e-9);
    assert.ok(distance(road.points.at(-1),world.network.nodeById.get(road.b))<1e-9);
    for(let i=1;i<road.points.length;i++) assert.ok(distance(road.points[i-1],road.points[i])<=24.001,'curves retain fine collision/render sampling');
  }
});

test('every visual road crossing belongs to an explicit shared graph junction', () => {
  const cross=(a,b)=>a.x*b.y-a.y*b.x;
  for(let i=0;i<world.roads.length;i++) for(let j=i+1;j<world.roads.length;j++) {
    const a=world.roads[i],b=world.roads[j];
    if([a.a,a.b].some(id=>id===b.a||id===b.b)) continue;
    for(let k=1;k<a.points.length;k++) for(let l=1;l<b.points.length;l++) {
      const p=a.points[k-1],q=a.points[k],u=b.points[l-1],v=b.points[l];
      if(Math.max(p.x,q.x)<Math.min(u.x,v.x)||Math.max(u.x,v.x)<Math.min(p.x,q.x)||Math.max(p.y,q.y)<Math.min(u.y,v.y)||Math.max(u.y,v.y)<Math.min(p.y,q.y)) continue;
      const r={x:q.x-p.x,y:q.y-p.y},s={x:v.x-u.x,y:v.y-u.y},offset={x:u.x-p.x,y:u.y-p.y},den=cross(r,s);
      if(Math.abs(den)<1e-8) continue;
      const t=cross(offset,s)/den,f=cross(offset,r)/den;
      assert.ok(!(t>1e-6&&t<1-1e-6&&f>1e-6&&f<1-1e-6),a.id+' crosses '+b.id+' without a graph node');
    }
    for(const endpoint of [a.points[0],a.points.at(-1)]) for(let l=1;l<b.points.length;l++) {
      const u=b.points[l-1],v=b.points[l],dx=v.x-u.x,dy=v.y-u.y,length2=dx*dx+dy*dy;
      const t=((endpoint.x-u.x)*dx+(endpoint.y-u.y)*dy)/length2;
      if(t<=0||t>=1) continue;
      assert.ok(Math.hypot(endpoint.x-u.x-dx*t,endpoint.y-u.y-dy*t)>0.01,a.id+' has an unconnected T junction on '+b.id);
    }
  }
});

test('projection and lane interpolation agree with arc length and routes follow actual streets', () => {
  for(const road of world.roads) for(const fraction of [.13,.47,.83]) {
    const point=world.network.pointOnRoad(road.id,road.length*fraction,14);
    const projected=world.network.nearestRoad(point);
    assert.ok(projected.distance<=14.05);
    const recovered=world.network.pointOnRoad(road.id,point.s,0);
    assert.ok(Math.abs(distance(point,recovered)-14)<1e-8);
    assert.ok(angleDistance(point.angle,recovered.angle)<1e-8);
  }
  const goals=[...world.missionAnchors.suburbs,...world.missionAnchors.dash,world.services[1]];
  for(const goal of goals) {
    const route=world.network.route(world.start.player,goal,18);
    assert.ok(route.length>1);
    for(let i=0;i<route.length;i++) {
      const point=route[i],projection=world.network.project(point);
      assert.ok(projection.distance<=projection.width/2-5,'lane joins stay inside actual road and junction corridors');
      assert.ok(point.roadId&&Number.isFinite(point.s)&&Number.isFinite(point.angle));
      if(i) assert.ok(distance(route[i-1],point)<27,'lane offsets meet smoothly at intersections');
    }
    assert.ok(distance(route.at(-1),world.network.project(goal))<=18.01);
  }
  assert.equal(world.network.project({x:NaN,y:0}),null);
  assert.equal(world.network.pointOnRoad('missing',0),null);
  assert.deepEqual(world.network.route({x:NaN,y:0},world.start.player),[]);
});

test('Dijkstra chooses the shortest projected graph route including same-edge travel', () => {
  const nodes=[{id:'a',x:0,y:0},{id:'b',x:100,y:0},{id:'c',x:100,y:100},{id:'d',x:0,y:100}];
  const roads=[['ab','a','b'],['bc','b','c'],['cd','c','d'],['da','d','a']].map(([id,a,b])=>({id,a,b,width:40,points:[nodes.find(node=>node.id===a),nodes.find(node=>node.id===b)]}));
  const graph=new World.RoadNetwork(roads,nodes),route=graph.route({x:20,y:0},{x:100,y:80});
  assert.deepEqual([...new Set(route.map(point=>point.roadId))],['ab','bc']);
  const length=route.slice(1).reduce((sum,point,i)=>sum+distance(route[i],point),0);
  assert.ok(Math.abs(length-160)<1e-8);
  const direct=graph.route({x:80,y:0},{x:20,y:0});
  assert.ok(direct.every(point=>point.roadId==='ab'));
  assert.ok(direct.every(point=>angleDistance(point.angle,Math.PI)<1e-8));
});

test('opposing lanes stay separate through straight junctions and sharp tangent joins', () => {
  const makeGraph=(end)=>{
    const nodes=[{id:'a',x:0,y:0},{id:'b',x:120,y:0},{id:'c',...end}];
    return new World.RoadNetwork([{id:'ab',a:'a',b:'b',width:84,points:[nodes[0],nodes[1]]},
      {id:'bc',a:'b',b:'c',width:84,points:[nodes[1],nodes[2]]}],nodes);
  };
  const straight=makeGraph({x:240,y:0}),forward=straight.route({x:20,y:0},{x:220,y:0},18),reverse=straight.route({x:220,y:0},{x:20,y:0},18);
  assert.ok(forward.every(point=>Math.abs(point.y-18)<1e-8));
  assert.ok(reverse.every(point=>Math.abs(point.y+18)<1e-8));
  for(const point of forward) assert.ok(Math.abs(point.y)>17.99,'intermediate junctions do not collapse onto the centre');
  for(const end of [{x:120,y:140},{x:20,y:100}]) {
    const graph=makeGraph(end),a=graph.route({x:0,y:0},end,18),b=graph.route(end,{x:0,y:0},18);
    for(const route of [a,b]) for(let i=0;i<route.length;i++) {
      const point=route[i],projected=graph.project(point);
      assert.ok(projected.distance<42,'rounded/miter joins fit the actual junction cap');
      if(i) assert.ok(distance(point,route[i-1])<=24.01,'join spacing remains bounded');
    }
    for(let i=1;i<a.length;i++) {
      const from=a[i-1],to=a[i],length=distance(from,to),cx=(from.x+to.x)/2,cy=(from.y+to.y)/2;
      const leg={x:cx-length/2,y:cy,w:length,h:0,angle:Math.atan2(to.y-from.y,to.x-from.x)};
      for(let j=1;j<b.length;j++) assert.ok(World.segmentBoxDistance(b[j-1],b[j],leg)>31.9,'full-width opposing vans retain distinct lanes');
    }
    assert.ok(distance(a.at(-1),end)<=18.01,'a traffic destination keeps its valid lane position');
    assert.ok(distance(graph.route({x:0,y:0},end,0).at(-1),end)<1e-8,'centre navigation endpoints stay exact');
  }
});

test('oriented buildings keep continuous sidewalks clear and preserve varied suburban gardens', () => {
  assert.ok(world.buildings.length>=140&&world.buildings.length<=190);
  for(const building of world.buildings) {
    for(const point of World.footprintCorners(building)) assert.ok(point.x>world.bounds.minX+100&&point.y>world.bounds.minY+100&&point.x<world.bounds.maxX-100&&point.y<world.bounds.maxY-100);
    for(const road of world.roads) for(let i=1;i<road.points.length;i++) {
      assert.ok(World.segmentBoxDistance(road.points[i-1],road.points[i],building)>=road.width/2+World.SIDEWALK_WIDTH+7.99,building.id+' crowds '+road.id);
    }
    const roadPoint=building.frontagePoint||world.network.pointOnRoad(building.roadId,building.roadS),front={x:Math.cos(building.frontAngle),y:Math.sin(building.frontAngle)},position=centre(building);
    assert.ok((roadPoint.x-position.x)*front.x+(roadPoint.y-position.y)*front.y>0,'each building faces its frontage');
  }
  for(let i=0;i<world.buildings.length;i++) for(let j=i+1;j<world.buildings.length;j++) assert.equal(World.boxesOverlap(world.buildings[i],world.buildings[j],11.99),false);
  assert.ok(world.buildings.filter(building=>Math.abs(Math.sin(building.angle*2))>.2).length>50,'footprints follow oblique streets');
  const average=id=>{const blocks=world.blocks.filter(block=>block.district===id);return blocks.reduce((sum,block)=>sum+block.density,0)/blocks.length;};
  assert.ok(average('market')>average('willow')+.1,'urban fronts are denser than garden lots');
  for(const id of ['willow']) {
    const buildings=world.buildings.filter(building=>building.district===id);
    assert.ok(buildings.length>=25);
    const setbacks=buildings.map(building=>{const road=world.network.pointOnRoad(building.roadId,building.roadS);return distance(road,centre(building))-building.h/2-road.width/2;});
    assert.ok(Math.max(...setbacks)-Math.min(...setbacks)>35,'suburban setbacks vary');
  }
  for(const green of world.landscape.greens) for(const building of world.buildings) assert.equal(World.boxesOverlap({x:green.x-green.w/2,y:green.y-green.h/2,w:green.w,h:green.h},building),false,'village greens remain open');
});

test('shared solid props keep full van footprints and sidewalk paths clear throughout curves', () => {
  const parts=propParts(world.staticObjects),groundParts=parts.filter(part=>part.bottom<2);
  for(const part of parts) for(const building of world.buildings) assert.equal(World.boxesOverlap(part.box,building),false,part.object.id+' intersects '+building.id);
  let poses=0;
  const checkPose=point=>{
    const van={x:point.x-27.5,y:point.y-16,w:55,h:32,angle:point.angle};
    for(const part of groundParts) {
      if(distance(centre(part.box),point)>Math.hypot(part.box.w,part.box.h)/2+35) continue;
      assert.equal(World.boxesOverlap(van,part.box),false,'van lane clips '+part.object.kind+' '+part.object.id+' at '+point.roadId+' s'+point.s);
    }
    poses++;
  };
  for(const road of world.roads) for(let s=0;s<=road.length;s+=15) for(const lane of [-18,0,18]) checkPose(world.network.pointOnRoad(road.id,s,lane));
  for(const goal of world.missionAnchors.suburbs) for(const point of world.network.route(world.start.player,goal,18)) checkPose(point);
  assert.ok(poses>world.roads.length*75,'clearance checks sample thousands of complete van footprints');
  for(const path of world.pedPaths) for(const point of path.points) {
    const person={x:point.x-6.02,y:point.y-6.02,w:12.04,h:12.04};
    for(const part of groundParts) if(distance(centre(part.box),point)<Math.hypot(part.box.w,part.box.h)/2+10) assert.equal(World.boxesOverlap(person,part.box),false,'sidewalk is blocked by '+part.object.id);
  }
});

test('services, varied lane spawns, and contracts use reachable road locations', () => {
  assert.equal(world.start.player.x,5984); assert.equal(world.start.player.y,3700);
  assert.equal(world.start.car.x,6016); assert.equal(world.start.car.y,3700);
  assert.equal(world.start.car.kind,'compact'); assert.equal(world.start.car.color,'#ffd15b');
  assert.ok(world.start.player.elevation>0&&world.start.car.elevation>0);
  const garage=world.staticObjects.find(object=>object.serviceId==='repair'),service=world.services.find(service=>service.id==='repair');
  assert.ok(distance(garage,service)<1e-8,'repair activation is inside the actual workshop');
  const road=world.network.project(service);
  assert.ok(road.distance>road.width/2+world.sidewalkWidth+garage.lot.h/2,'the whole workshop sits behind the sidewalk');
  assert.ok(angleDistance(garage.angle,road.angle+Math.PI)<.1,'the open bay faces the access road');
  assert.deepEqual([...new Set(world.vehicleSpawns.map(spawn=>spawn.kind))].sort(),['compact','sports','van']);
  assert.equal(new Set(world.vehicleSpawns.filter(spawn=>!spawn.militaryModel).map(spawn=>spawn.color)).size,6);
  for(const spawn of world.vehicleSpawns.filter(spawn=>spawn.traffic)) {
    const centreLine=world.network.pointOnRoad(spawn.roadId,spawn.s),cross=(spawn.x-centreLine.x)*-Math.sin(centreLine.angle)+(spawn.y-centreLine.y)*Math.cos(centreLine.angle);
    assert.ok(angleDistance(spawn.angle,centreLine.angle+(cross<0?Math.PI:0))<1e-8,'opposing lane traffic faces the opposite direction');
  }
  assert.ok(world.missionAnchors.dash.some(point=>World.districtAt(point).id==='willow'));
  assert.ok(world.missionAnchors.dash.some(point=>World.districtAt(point).id==='orchard'));
  for(const key of ['delivery','deliveryAlt','dash','party','partyAlt']) for(const point of world.missionAnchors[key]) assert.ok(world.network.route(world.start.player,point).length>0);
});

test('every nonstarter parked ride has a clear bay and an unobstructed full-width road approach', () => {
  const parked=world.vehicleSpawns.filter(spawn=>!spawn.traffic),parts=propParts(world.staticObjects);
  assert.ok(parked.length>=7,'the parked collection remains available');
  assert.equal(world.parkingBays.length,parked.length);
  const dimensions={compact:{length:46,width:27},sports:{length:49,width:28},van:{length:55,width:32}};
  for(const spawn of parked) {
    const type=dimensions[spawn.kind],car={x:spawn.x-type.length/2,y:spawn.y-type.width/2,w:type.length,h:type.width,angle:spawn.angle};
    const bay=world.parkingBays.find(bay=>bay.id===spawn.parkingBayId);
    assert.ok(bay); assert.ok(distance(centre(bay),spawn)<1e-8);
    assert.ok(angleDistance(bay.angle,spawn.angle)<1e-8);
    assert.ok(bay.w>=type.length+9.99&&bay.h>=type.width+9.99,'the drawn bay fits the actual vehicle');
    for(const road of world.roads) for(let i=1;i<road.points.length;i++) {
      assert.ok(World.segmentBoxDistance(road.points[i-1],road.points[i],bay)>=road.width/2+World.SIDEWALK_WIDTH+7.99,'parked footprint leaves both carriageway and sidewalk clear');
    }
    for(const building of world.buildings) {
      assert.equal(World.boxesOverlap(car,building),false);
      assert.equal(World.boxesOverlap(bay.access,building,2.99),false,'the driveway approach avoids buildings');
    }
    for(const part of parts.filter(part=>part.bottom<(spawn.kind==='van'?1.7:1.3))) {
      assert.equal(World.boxesOverlap(car,part.box),false);
      assert.equal(World.boxesOverlap(bay.access,part.box,2.99),false,'the driveway approach avoids physical props');
    }
    for(const other of world.parkingBays) if(other!==bay) {
      assert.equal(World.boxesOverlap(bay,other,4.99),false);
      assert.equal(World.boxesOverlap(bay.access,other,2.99),false,'another parked ride cannot block this exit');
    }
    assert.ok(world.network.route(world.start.player,bay.accessPoint).length>0,'each bay joins a reachable street');
    assert.ok(distance(bay.accessPoint,spawn)<(spawn.militaryModel?420:180),'city bays stay beside streets and the paved military motor pool has a reachable driveway');
  }
});

test('whole pedestrian path legs stay outside every carriageway at acute junctions', () => {
  let legs=0;
  for(const path of world.pedPaths) {
    assert.ok(path.points.length>=3);
    for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i],length=distance(a,b),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
      const walkingLeg={x:cx-length/2,y:cy,w:length,h:0,angle:Math.atan2(b.y-a.y,b.x-a.x)};
      for(const road of world.roads) for(let j=1;j<road.points.length;j++) {
        assert.ok(World.segmentBoxDistance(road.points[j-1],road.points[j],walkingLeg)>=road.width/2+6.02+1.99,
          path.id+' walking segment '+i+' crosses '+road.id);
      }
      legs++;
    }
  }
  assert.ok(legs>250,'many full walking legs are checked rather than spawn points alone');
  assert.ok(world.pedPaths.some(path=>path.district==='ridge')&&world.pedPaths.some(path=>path.district==='marsh'),'scenic regions have reachable walking paths');
});

test('world generation is deterministic and region density follows the reference geography', () => {
  const again=World.createWorld();
  assert.deepEqual(again.buildings,world.buildings);
  assert.deepEqual(again.staticObjects,world.staticObjects);
  assert.deepEqual(again.parkingBays,world.parkingBays);
  assert.equal(Object.keys(World.DISTRICTS).length,9);
  assert.equal(Object.values(World.DISTRICTS).filter(district=>district.id!=='military').reduce((sum,district)=>sum+district.pedCount,0),48);
  assert.equal(World.DISTRICTS.military.pedCount,6);
  const count=id=>world.buildings.filter(building=>building.district===id).length;
  assert.ok(count('market')>count('orchard')*4,'Downtown is denser than the airport');
  assert.ok(count('willow')>count('ridge')*6,'Northside has garden neighborhoods, the mountains stay open');
  assert.equal(count('marsh'),0,'the marsh has no urban infill');
  assert.ok(world.buildings.some(building=>building.style==='terminal'));
  assert.ok(world.buildings.some(building=>building.style==='control-tower'));
  assert.ok(world.buildings.some(building=>building.style==='hangar'));
  assert.equal(world.landscape.airport.runways[0].role,'runway');
  assert.ok(world.staticObjects.every(object=>['garage','rail-platform','military-fence'].includes(object.kind)?!object.destructible:object.destructible&&object.health===object.maxHealth));
});
