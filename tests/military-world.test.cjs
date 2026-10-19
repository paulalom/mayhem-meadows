'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const World=require('../world.js'),Railway=require('../railway.js'),North=require('../north-height-data.js');
const world=World.createWorld(),base=world.militaryBase;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

test('the northern district extends the map without moving seeded city streets, lots or parking',()=>{
  assert.equal(world.size,12000);assert.equal(world.mapMinY,-4000);assert.equal(world.mapHeight,12000);
  assert.deepEqual(world.bounds,{minX:0,minY:-4000,maxX:12000,maxY:8000});assert.equal(world.referenceMapHeight,8000);
  const city={roads:world.roads.filter(r=>!r.id.startsWith('base-')).map(r=>({id:r.id,a:r.a,b:r.b,points:r.points.map(p=>[p.x,p.y])})),
    buildings:world.buildings.filter(b=>b.district!=='military').map(b=>({id:b.id,x:b.x,y:b.y,w:b.w,h:b.h,angle:b.angle})),
    spawns:world.vehicleSpawns.filter(s=>!s.militaryModel).map(s=>({x:s.x,y:s.y,angle:s.angle,kind:s.kind,roadId:s.roadId}))};
  // Reserving the repair workshop and driveway intentionally updates the
  // nearby Docklands frontage; the northern extension keeps this layout fixed.
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(city)).digest('hex'),'7e946858cc18ed3cb9c39c9196e62a5d5b979b3bcc24622fac162f2e2fccb184');
  assert.equal(World.districtAt(4350,-1920).id,'military');assert.equal(World.districtAt(9000,-2000).id,'ridge');
  assert.equal(world.landscape.militaryBase,base);assert.equal(world.network.roadById.size,world.roads.length);
});

test('a navigable gate joins the city and military compound without clipping the perimeter',()=>{
  const {Game}=require('../core.js'),game=new Game({seed:42});
  for(const goal of game.world.missionAnchors.military)for(const lane of [-18,0,18]) {
    const route=game.network.route(game.world.start.player,goal,lane);
    assert.ok(route.length>250);assert.ok(distance(route.at(-1),goal)<=18.01);
    for(const point of route)assert.ok(game._vehicleFree({...point,kind:'van',elevation:game._ground(point)}),point.roadId+' leaves a full van clear of buildings and fencing');
  }
  assert.ok(base.fenceObjects.length>60);
  for(const object of base.fenceObjects) {
    assert.ok(world.staticObjects.includes(object));assert.equal(object.destructible,false);
    assert.ok(Number.isFinite(object.elevation));assert.ok(object.parts[0].half[0]<=4);
  }
  assert.ok(!base.fenceObjects.some(o=>o.y===base.gate.y&&Math.abs(o.x-base.gate.x)<base.gate.width/2));
  for(const ped of game.peds.filter(p=>p.district==='military'))assert.ok(game._personFree(ped.x,ped.y,6.02,ped));
  assert.equal(game.peds.filter(p=>p.district==='military').length,6);
  const junctions=new Map();
  for(const road of world.roads.filter(r=>r.id.startsWith('base-'))) {
    for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1],b=road.points[i];
      assert.ok(Math.abs(b.elevation-a.elevation)/(distance(a,b)/20)<.14,road.id+' retains a drivable physical grade');
    }
    for(const [id,p] of [[road.a,road.points[0]],[road.b,road.points.at(-1)]]) {
      if(junctions.has(id))assert.equal(p.elevation,junctions.get(id),id+' shares one physical junction');
      junctions.set(id,p.elevation);
    }
  }
});

test('base aircraft surfaces, solid buildings and utility vehicle bays share the level formation',()=>{
  for(const rect of [...base.runways,...base.taxiways,...base.aprons,base.motorPool]) {
    assert.equal(rect.elevation,14);
    for(const p of World.footprintCorners(rect))assert.ok(Math.abs(world.terrain.heightAt(p.x,p.y)-14)<.00001,rect.id+' has level corners');
  }
  for(const building of base.buildings) {
    assert.ok(world.buildings.includes(building));assert.equal(building.elevation,14);assert.ok(building.foundationBottom<14);
    assert.ok(building.militaryModel);assert.ok(building.height>3);
    const expected=building.militaryModel==='hangar'?-Math.PI/2:building.militaryModel==='gatehouse'?-Math.PI:Math.PI/2;
    assert.ok(Math.abs(Math.atan2(Math.sin(building.frontAngle-expected),Math.cos(building.frontAngle-expected)))<.00001,building.id+' uses the authored model door direction');
    for(const rect of [...base.runways,...base.taxiways,...base.aprons]) {
      // The hangar apron tucks half a metre under the closed door threshold.
      const pavement=rect.id==='military-hangar-apron'?{...rect,h:rect.h-10}:rect;
      assert.equal(World.boxesOverlap(building,pavement),false,building.id+' leaves usable pavement clear');
    }
  }
  for(const spawn of base.vehicleSpawns) {
    assert.ok(world.vehicleSpawns.includes(spawn));assert.equal(spawn.elevation,14);assert.equal(spawn.traffic,false);
    const bay=world.parkingBays.find(b=>b.id===spawn.parkingBayId);assert.ok(bay);assert.equal(bay.elevation,14);
    assert.ok(world.network.route(world.start.player,bay.accessPoint).length>200);
    for(const building of base.buildings)assert.equal(World.boxesOverlap(bay.access,building,3),false);
  }
  for(const p of [...base.stands,...base.helipads,...base.storageStands])assert.equal(p.elevation,14);
});

test('both railway mains reach dry northern portals while all original city rail points stay fixed',()=>{
  const original=Railway.createRailway();assert.equal(original.portalY,undefined);assert.equal(world.railway.portalY,-4000);
  for(const line of world.railway.tracks) {
    const city=original.tracks.find(track=>track.id===line.id),retained=line.points.filter(p=>p.y>=0);
    assert.equal(retained.length,city.points.length);
    for(let i=0;i<city.points.length;i++)assert.deepEqual([retained[i].x,retained[i].y,retained[i].elevation],[city.points[i].x,city.points[i].y,city.points[i].elevation]);
    if(line.role!=='main')continue;
    assert.equal(line.points[0].y,-4000);assert.ok(line.cityStartS>4000);assert.ok(line.length>city.length+4000);
    for(const p of line.points.filter(p=>p.y<0))assert.equal(North.isWaterRaw(p.x,p.y),false);
    for(const b of base.buildings)assert.equal(Railway.intersectsBox({tracks:[line]},b,50),false);
    for(const runway of base.runways)assert.equal(Railway.intersectsBox({tracks:[line]},runway,0),false);
  }
  const recrossings=Railway.crossings(Railway.extendNorth(original),world.roads.map(road=>({...road,railOverpasses:undefined})));
  assert.equal(recrossings.length,world.railway.crossings.length);assert.ok(recrossings.every(c=>!c.roadId.startsWith('base-')));
  const extended=Railway.extendNorth(original);assert.equal(Railway.extendNorth(extended),extended,'extension is idempotent');
});
